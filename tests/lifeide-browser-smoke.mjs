import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {execFileSync} from 'node:child_process';
import {createLifeIdeRouter} from '../src/lifeide.js';
import {login,readStaff,setStaffCookie,requireStaff,checkOrigin,rateLimit} from '../src/auth.js';
import {rateLimit as expressRateLimit} from 'express-rate-limit';
import {closePool} from '../src/db.js';

const chromePath=process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=await mkdtemp(path.join(os.tmpdir(),'lifeide-browser-'));
const workspace=await mkdtemp(path.join(os.tmpdir(),'lifeide-repo-'));
const git=(...args)=>execFileSync('git',args,{cwd:workspace,encoding:'utf8'}).trim();
git('init','-q');git('config','user.name','LifeIDE Browser Test');git('config','user.email','lifeide@example.invalid');
await (await import('node:fs/promises')).writeFile(path.join(workspace,'README.md'),'LifeIDE browser repository test');
git('add','README.md');git('commit','-qm','baseline');git('checkout','-qb','feature/browser-acceptance');
const realAuth=process.env.LIFEIDE_BROWSER_REAL_AUTH==='true';
if(realAuth&&(!process.env.LIFEIDE_TEST_USERNAME||!process.env.LIFEIDE_TEST_PASSWORD||!process.env.DATABASE_URL))throw Error('Real-auth browser test requires disposable DATABASE_URL and LIFEIDE_TEST_USERNAME/PASSWORD');
if(realAuth){
 const db=new URL(process.env.DATABASE_URL);
 if(!['127.0.0.1','localhost','::1'].includes(db.hostname)||process.env.LOCAL_DEMO!=='true')
  throw Error('Real-auth browser test requires LOCAL_DEMO=true and a loopback-only database');
}
const app=express();
app.use(express.json());
app.use(expressRateLimit({windowMs:60_000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
if(realAuth){
 app.use((req,res,next)=>{
  const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('lg_staff='));
  req.cookies=cookie?{lg_staff:decodeURIComponent(cookie.slice('lg_staff='.length))}:{};
  next();
 });
}
if(realAuth){
 app.post('/api/auth/login',async(req,res)=>{try{checkOrigin(req);await rateLimit(req,'lifeide-browser-login',10);const result=await login(req.body);setStaffCookie(req,res,result.token);res.json({user:result.user,csrf_token:result.csrf_token});}catch(e){res.status(e.status||500).json({message:e.message});}});
 app.get('/api/auth/status',async(req,res)=>{const actor=await readStaff(req);res.json({user:actor,csrf_token:actor?.csrf_token});});
 app.use('/api/lifeide',createLifeIdeRouter({workspace,authenticate:requireStaff}));
}else{
 app.get('/api/auth/status',(req,res)=>res.json({user:{role_id:'admin'},csrf_token:'test-csrf'}));
 app.use('/api/lifeide',createLifeIdeRouter({workspace,access:(req,res,next)=>next(),authenticate:(req,res,next)=>{req.actor={role_id:'admin',csrf_token:'test-csrf'};next();},origin:(req)=>{},csrf:(req)=>{if(req.get('x-csrf-token')!=='test-csrf')throw Error('Missing test CSRF');}}));
}
app.use('/lifeide',express.static(new URL('../public/lifeide/',import.meta.url).pathname));
app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
const server=app.listen(0,'127.0.0.1');
let chrome,ws;
try {
 await new Promise(resolve=>server.once('listening',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/lifeide/';
 chrome=spawn(chromePath,['--headless','--no-first-run','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,url],{stdio:'ignore'});
 let port;
 for(let i=0;i<100;i++){
  if(chrome.exitCode!==null)throw Error('Chrome exited before starting');
  try{const info=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n');port=Number(info[0]);if(port)break;}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(port,'Chrome DevTools did not start');
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let id=0;const pending=new Map();
 ws.onmessage=e=>{const message=JSON.parse(e.data);if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}};
 const evaluate=async expression=>{const n=++id;const result=new Promise(resolve=>pending.set(n,resolve));ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));const data=await result;if(data.result?.exceptionDetails)throw Error(JSON.stringify(data.result.exceptionDetails));return data.result?.result?.value;};
 for(let i=0;i<50;i++){if(await evaluate("Boolean(document.getElementById('newFile'))"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("Boolean(document.getElementById('newFile'))"),true);
 await evaluate("document.getElementById('newFile').click()");
 assert.equal(await evaluate("!document.getElementById('dialog').hidden"),true);
 await evaluate("document.getElementById('dialogInput').value='browser-smoke.js';document.getElementById('dialogForm').requestSubmit()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('fileTitle').textContent==='browser-smoke.js'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'browser-smoke.js');
 await evaluate("document.getElementById('editor').value='const smoke = true;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}))");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='browser-smoke.js')?.content"),'const smoke = true;');
 assert.equal(await evaluate("document.querySelectorAll('.tab-open').length"),1);
 console.log('PASS LifeIDE browser: create, open, save, accessible file tab');
 await evaluate("document.getElementById('newFile').click()");
 await evaluate("document.getElementById('dialogInput').value='second-smoke.js';document.getElementById('dialogForm').requestSubmit()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('fileTitle').textContent==='second-smoke.js'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'second-smoke.js');
 await evaluate("document.getElementById('editor').value='const second = 2;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}))");
 await evaluate("[...document.querySelectorAll('.tab-open')].find(b=>b.textContent==='browser-smoke.js').click()");
 assert.equal(await evaluate("document.getElementById('editor').value"),'const smoke = true;');
 await evaluate("[...document.querySelectorAll('.tab-open')].find(b=>b.textContent==='second-smoke.js').click()");
 assert.equal(await evaluate("document.getElementById('editor').value"),'const second = 2;');
 await evaluate("[...document.querySelectorAll('#tabs .close')].find(b=>b.getAttribute('aria-label')==='Close second-smoke.js').click()");
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'browser-smoke.js');
 assert.equal(await evaluate("document.getElementById('editor').value"),'const smoke = true;');
 console.log('PASS LifeIDE browser: tab switching and closing preserve saved files');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='second-smoke.js')?.content"),'const second = 2;','Closing a tab must not delete the file');
 await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('second-smoke.js')).click()");
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'second-smoke.js');
 assert.equal(await evaluate("document.getElementById('editor').value"),'const second = 2;');
 await evaluate("location.reload()");
 for(let i=0;i<50;i++){if(await evaluate("Boolean(document.getElementById('newFile'))"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='second-smoke.js')?.content"),'const second = 2;','File content must survive page reload');
 console.log('PASS LifeIDE browser: closed files reopen and persist after reload');
 await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('second-smoke.js')).click()");
 assert.equal(await evaluate("document.getElementById('editor').value"),'const second = 2;');



 await evaluate("window.confirm=()=>false;[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('browser-smoke.js')).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).filter(f=>f.name==='browser-smoke.js').length"),1,'Cancelled delete must preserve file');
 await evaluate("window.confirm=()=>true;[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('browser-smoke.js')).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).filter(f=>f.name==='browser-smoke.js').length"),0,'Confirmed delete must remove selected file');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='second-smoke.js')?.content"),'const second = 2;','Other files must be preserved');
 assert.equal(await evaluate("document.getElementById('editor').value"),'const second = 2;');
 console.log('PASS LifeIDE browser: cancelled and targeted file deletion');
 await evaluate("document.getElementById('renameFile').click()");
 assert.equal(await evaluate("document.getElementById('dialogInput').value"),'second-smoke.js');
 await evaluate("document.getElementById('dialogInput').value='README.md';document.getElementById('dialogForm').requestSubmit()");
 assert.equal(await evaluate("!document.getElementById('dialog').hidden"),true,'Duplicate rename must be rejected');
 assert.match(await evaluate("document.getElementById('dialogError').textContent"),/already exists/);
 await evaluate("document.getElementById('dialogInput').value='renamed-smoke.ts';document.getElementById('dialogForm').requestSubmit()");
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'renamed-smoke.ts');
 assert.equal(await evaluate("document.getElementById('editor').value"),'const second = 2;');
 assert.equal(await evaluate("document.querySelector('.tab-open').textContent"),'renamed-smoke.ts');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='renamed-smoke.ts')?.content"),'const second = 2;');
 console.log('PASS LifeIDE browser: rename preserves content and rejects duplicates');
 await evaluate("[...document.querySelectorAll('.folder-rename')].find(b=>b.getAttribute('aria-label')==='Rename folder examples').click()");
 await evaluate("document.getElementById('dialogInput').value='samples';document.getElementById('dialogForm').requestSubmit()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.id==='examples')?.name"),'samples');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.id==='sample')?.content"),'// LifeIDE example\nconsole.log("Hello LIFEGEN!");\n');
 await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('hello.js')).click()");
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'samples/hello.js');
 console.log('PASS LifeIDE browser: folder rename preserves descendants and updates paths');

 // A selected Explorer folder must be the parent for new files and subfolders.
 await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('samples')).click()");
 await evaluate("document.getElementById('newFolder').click()");
 await evaluate("document.getElementById('dialogInput').value='nested';document.getElementById('dialogForm').requestSubmit()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='nested')?.parent"),'examples','New subfolder should use the selected folder');
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].some(b=>b.textContent.includes('nested'))"),true,'Parent folder should be expanded after creating nested folder');
 await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('nested')).click()");
 await evaluate("document.getElementById('newFile').click()");
 await evaluate("document.getElementById('dialogInput').value='inside.txt';document.getElementById('dialogForm').requestSubmit()");
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'samples/nested/inside.txt');
 const nestedResult=await evaluate("(()=>{const files=JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1'));return files.find(f=>f.name==='inside.txt')?.parent===files.find(f=>f.name==='nested')?.id})()");
 assert.equal(nestedResult,true,'New file should use the selected nested folder');
 console.log('PASS LifeIDE browser: selected folders are creation destinations');

 // Touch and keyboard delete actions must confirm, preserve cancelled work, and remove only the target.
 assert.equal(await evaluate("Boolean([...document.querySelectorAll('.entry-delete')].find(b=>b.getAttribute('aria-label')==='Delete file samples/nested/inside.txt'))"),true);
 await evaluate("window.confirm=()=>false;[...document.querySelectorAll('.entry-delete')].find(b=>b.getAttribute('aria-label')==='Delete file samples/nested/inside.txt').click()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).some(f=>f.name==='inside.txt')"),true,'Cancelled delete should preserve the file');
 await evaluate("window.confirm=()=>true;[...document.querySelectorAll('.entry-delete')].find(b=>b.getAttribute('aria-label')==='Delete file samples/nested/inside.txt').click()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).some(f=>f.name==='inside.txt')"),false,'Confirmed delete should remove the selected file');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).some(f=>f.name==='nested')"),true,'Deleting a file must preserve its folder');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).some(f=>f.name==='renamed-smoke.ts')"),true,'Other files must be preserved');
 console.log('PASS LifeIDE browser: touch and keyboard delete controls confirm before removing');

 // Explorer keyboard traversal should preserve focus when folders rerender.
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('samples')).getAttribute('aria-expanded')"),'true','Expanded folder must announce its state');
 await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('samples')).focus()");
 await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))");
 assert.equal(await evaluate("document.activeElement.textContent.includes('samples')"),true,'Collapsing should retain focus on folder');
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].some(b=>b.textContent.includes('hello.js'))"),false,'ArrowLeft should collapse the folder');
 assert.equal(await evaluate("document.activeElement.getAttribute('aria-expanded')"),'false','Collapsed folder must announce its state');
 await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))");
 assert.equal(await evaluate("document.activeElement.textContent.includes('samples')"),true,'Expanding should retain focus on folder');
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].some(b=>b.textContent.includes('hello.js'))"),true,'ArrowRight should expand the folder');
 assert.equal(await evaluate("document.activeElement.getAttribute('aria-expanded')"),'true','Expanded folder must update its accessible state');
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('hello.js')).getAttribute('aria-label')"),'File samples/hello.js','File name should include its location');
 await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))");
 assert.equal(await evaluate("document.activeElement.textContent.includes('nested')"),true,'ArrowDown should focus the next visible folder');
 await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))");
 await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))");
 assert.equal(await evaluate("document.activeElement.textContent.includes('samples')"),true,'ArrowLeft on a collapsed child should focus its parent');
 console.log('PASS LifeIDE browser: Explorer arrow-key navigation and focus preservation');

 // Root destination remains available after selecting a nested file or folder.
 await evaluate("document.getElementById('workspaceRoot').click()");
 assert.equal(await evaluate("document.getElementById('workspaceRoot').getAttribute('aria-pressed')"),'true','Root selection must be announced');
 await evaluate("document.getElementById('newFolder').click()");
 await evaluate("document.getElementById('dialogInput').value='root-level';document.getElementById('dialogForm').requestSubmit()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='root-level')?.parent"),null,'New folder must be at workspace root');
 await evaluate("document.getElementById('newFile').click()");
 await evaluate("document.getElementById('dialogInput').value='root-note.txt';document.getElementById('dialogForm').requestSubmit()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='root-note.txt')?.parent"),null,'New file must be at workspace root');
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'root-note.txt');
 console.log('PASS LifeIDE browser: root selection creates files and folders at workspace root');







 if(realAuth){
  const credentials=JSON.stringify({username:process.env.LIFEIDE_TEST_USERNAME,password:process.env.LIFEIDE_TEST_PASSWORD});
  const loginStatus=await evaluate("(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:location.origin},body:JSON.stringify("+credentials+")});return r.status})()");
  assert.equal(loginStatus,200,'Real database-backed admin login should succeed');
 }
 await evaluate("document.getElementById('repositoryMode').click()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('modeLabel').textContent==='REPOSITORY'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('modeLabel').textContent"),'REPOSITORY');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='renamed-smoke.ts')?.content"),'const second = 2;','Switching to repository must preserve browser-local files');

 await evaluate("document.getElementById('newFile').click()");
 await evaluate("document.getElementById('dialogInput').value='browser-repository.js';document.getElementById('dialogForm').requestSubmit()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('fileTitle').textContent==='browser-repository.js'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'browser-repository.js');
 await evaluate("document.getElementById('editor').value='const browserRepository = true;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}))");
 await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true,cancelable:true}))");
 for(let i=0;i<50;i++){if((await readFile(path.join(workspace,'browser-repository.js'),'utf8'))==='const browserRepository = true;')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await readFile(path.join(workspace,'browser-repository.js'),'utf8'),'const browserRepository = true;');
 await evaluate("document.getElementById('gitChanges').click()");
 for(let i=0;i<50;i++){if(await evaluate("document.querySelectorAll('#tabs input[type=checkbox]').length"))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate("document.querySelector('#tabs input[type=checkbox]').click()");
 assert.equal(await evaluate("document.getElementById('commit').disabled"),false);
 await evaluate("window.prompt=()=> 'Verify browser commit';window.confirm=()=>true;document.getElementById('commit').click()");
 for(let i=0;i<50;i++){if(git('ls-tree','--name-only','HEAD').split('\n').includes('browser-repository.js'))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(git('show','HEAD:browser-repository.js'),'const browserRepository = true;');
 console.log('PASS LifeIDE repository browser: mode, create, save, Git selection and commit ('+(realAuth?'database-backed admin':'mock admin')+')');
 await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('browser-repository.js')).click()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('fileTitle').textContent==='browser-repository.js'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'browser-repository.js');
 await (await import('node:fs/promises')).writeFile(path.join(workspace,'browser-repository.js'),'const externalChange = true;');
 await evaluate("document.getElementById('editor').value='const staleBrowserEdit = true;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}))");
 await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true,cancelable:true}))");
 await new Promise(r=>setTimeout(r,450));
 assert.equal(await readFile(path.join(workspace,'browser-repository.js'),'utf8'),'const externalChange = true;','Stale editor must not overwrite external changes');
 console.log('PASS LifeIDE repository browser: stale-version save blocked');
 await evaluate("window.confirm=()=>false;[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('README.md')).click()");
 await new Promise(r=>setTimeout(r,150));
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'browser-repository.js','Cancel file-switch must retain the current file');
 assert.equal(await evaluate("document.getElementById('editor').value"),'const staleBrowserEdit = true;','Cancel file-switch must retain the unsaved edit');
 console.log('PASS LifeIDE repository browser: cancelled file switch preserves unsaved text');

 await evaluate("window.confirm=()=>false;document.getElementById('refresh').click()");
 assert.equal(await evaluate("document.getElementById('editor').value"),'const staleBrowserEdit = true;','Cancel refresh must preserve unsaved text');
 assert.equal(await evaluate("document.getElementById('modeLabel').textContent"),'REPOSITORY');
 await evaluate("document.getElementById('repositoryMode').click()");
 assert.equal(await evaluate("document.getElementById('modeLabel').textContent"),'REPOSITORY','Cancel workspace switch must preserve repository mode');
 assert.equal(await evaluate("document.getElementById('editor').value"),'const staleBrowserEdit = true;');
 console.log('PASS LifeIDE repository browser: unsaved refresh and mode-switch cancellation');


 await new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method:'Emulation.setDeviceMetricsOverride',params:{width:390,height:844,deviceScaleFactor:3,mobile:true}}));});
 const mobile=await evaluate("({viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,editorWidth:document.getElementById('editor').getBoundingClientRect().width})");
 assert.equal(mobile.viewport,390);
 assert.equal(mobile.overflow,false,'Mobile view has horizontal page overflow');
 assert.ok(mobile.editorWidth>80,'Mobile editor must remain usable');
 assert.equal(await evaluate("[...document.querySelectorAll('.explorer-entry')].every(el=>el.scrollWidth<=el.clientWidth+1)"),true,'Explorer entries must not overflow their own width');
 console.log('PASS LifeIDE mobile viewport: 390px, no page overflow, editor visible');
 await new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method:'Emulation.setDeviceMetricsOverride',params:{width:320,height:700,deviceScaleFactor:2,mobile:true}}));});
 const narrow=await evaluate("({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,editor:document.getElementById('editor').getBoundingClientRect().width})");
 assert.equal(narrow.width,320,'Small phones must use their real viewport width');
 assert.equal(narrow.overflow,false,'Small phones must not overflow horizontally');
 assert.ok(narrow.editor>80,'Editor must remain visible on small phones');
 console.log('PASS LifeIDE narrow mobile viewport: 320px');



}finally{
 ws?.close();chrome?.kill();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150});await rm(workspace,{recursive:true,force:true});if(realAuth)await closePool();
}
