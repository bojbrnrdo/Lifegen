import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
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
await mkdir(path.join(workspace,'src','components'),{recursive:true});
await writeFile(path.join(workspace,'src','components','Example.js'),'export const example = true;');
git('add','README.md','src/components/Example.js');git('commit','-qm','baseline');git('checkout','-qb','feature/browser-acceptance');
const realAuth=process.env.LIFEIDE_BROWSER_REAL_AUTH==='true';
if(realAuth&&(!process.env.LIFEIDE_TEST_USERNAME||!process.env.LIFEIDE_TEST_PASSWORD||!process.env.DATABASE_URL))throw Error('Real-auth browser test requires disposable DATABASE_URL and LIFEIDE_TEST_USERNAME/PASSWORD');
if(realAuth){
 const db=new URL(process.env.DATABASE_URL);
 if(!['127.0.0.1','localhost','::1'].includes(db.hostname)||process.env.LOCAL_DEMO!=='true')
  throw Error('Real-auth browser test requires LOCAL_DEMO=true and a loopback-only database');
}
let githubTreeRequests=0,githubIndexRequests=0,githubDirectoryRequests=0,githubFileRequests=0;
const originalGlobalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url).includes('/repos/bojbrnrdo/Lifegen/contents/')){
  githubFileRequests++;
  const requested=new URL(String(url)).pathname;
  const content=requested.endsWith('/README.md')?'# LIFEGEN source': 'export const example = true;';
  return new Response(JSON.stringify({type:'file',size:content.length,encoding:'base64',
   content:Buffer.from(content).toString('base64'),sha:requested.endsWith('/README.md')?'mock-readme':'mock-example'}),{status:200});
 }
 if(String(url).includes('/repos/bojbrnrdo/Lifegen/git/trees/main?recursive=1')){
  githubTreeRequests++;
  return new Response(JSON.stringify({
   sha:'smoke-tree',truncated:false,tree:[
    {path:'src',type:'tree'},{path:'src/components',type:'tree'},
    {path:'src/components/Example.js',type:'blob',size:28},{path:'README.md',type:'blob',size:16}
   ]
  }),{status:200});
 }
 return originalGlobalFetch(url,options);
};
const app=express();
app.use((req,res,next)=>{
 if(req.path==='/api/lifeide/remote/index')githubIndexRequests++;
 if(req.path==='/api/lifeide/remote/tree')githubDirectoryRequests++;
 next();
});
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
 const chromeArgs=['--headless','--no-first-run','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile];
 if(process.platform==='linux')chromeArgs.push('--no-sandbox','--disable-dev-shm-usage');
 chromeArgs.push(url);
 chrome=spawn(chromePath,chromeArgs,{stdio:['ignore','ignore','pipe']});
 let chromeErrors='';
 chrome.stderr.on('data',chunk=>{chromeErrors=(chromeErrors+chunk.toString()).slice(-4000);});
 let port;
 for(let i=0;i<100;i++){
  if(chrome.exitCode!==null)throw Error('Chrome exited before starting (code '+chrome.exitCode+'): '+chromeErrors);
  try{const info=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n');port=Number(info[0]);if(port)break;}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(port,'Chrome DevTools did not start: '+chromeErrors);
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let id=0;const pending=new Map();
 ws.onmessage=e=>{const message=JSON.parse(e.data);if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}};
 const evaluate=async expression=>{const n=++id;const result=new Promise(resolve=>pending.set(n,resolve));ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));const data=await result;if(data.result?.exceptionDetails)throw Error(JSON.stringify(data.result.exceptionDetails));return data.result?.result?.value;};
 for(let i=0;i<100;i++){
  if(await evaluate("document.documentElement?.dataset.lifeideReady==='true'"))break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(await evaluate("document.documentElement.dataset.lifeideReady"),'true','LifeIDE event listeners must be initialized before browser actions');
 assert.equal(await evaluate("Boolean(document.getElementById('newFile'))"),true);
 await evaluate("document.getElementById('newFile').click()");
 assert.equal(await evaluate("!document.getElementById('dialog').hidden"),true);
 await evaluate("document.getElementById('dialogInput').value='browser-smoke.js';document.getElementById('dialogForm').requestSubmit()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('fileTitle').textContent==='browser-smoke.js'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'browser-smoke.js');
 await evaluate("document.getElementById('editor').value='const smoke = true;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}))");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='browser-smoke.js')?.content"),'const smoke = true;');
 // The dialog submit and editor opening may settle on separate browser tasks.
 // Wait for the tab as we already do for the file title, instead of racing it.
 for(let i=0;i<50;i++){
  if(await evaluate("document.querySelectorAll('.tab-open').length===1"))break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(await evaluate("document.querySelectorAll('.tab-open').length"),1,'New file tab should become visible after creation');
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

 // Reference-style IDE: dark two-pane layout with working Explorer search and no AI panel.
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.main')).backgroundColor"),'rgb(255, 255, 255)','Main editor must retain the LIFEGEN light theme');
 assert.equal(await evaluate("document.querySelectorAll('.workspace > aside, .workspace > main').length"),2,'Workspace should use Explorer and editor panes only');
 assert.equal(await evaluate("!document.querySelector('[id*=aiAgent], .ai-agent, .agent-panel')"),true,'No AI panel should be displayed');
 await evaluate("document.getElementById('explorerSearch').value='root-note';document.getElementById('explorerSearch').dispatchEvent(new Event('input',{bubbles:true}))");
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].some(b=>b.textContent.includes('root-note.txt'))"),true,'Search should find matching files');
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].some(b=>b.textContent.includes('README.md'))"),false,'Search should hide nonmatching files');
 await evaluate("document.getElementById('explorerSearch').value='';document.getElementById('explorerSearch').dispatchEvent(new Event('input',{bubbles:true}))");
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].some(b=>b.textContent.includes('README.md'))"),true,'Clearing search should restore all files');
 console.log('PASS LifeIDE browser: dark two-pane layout and Explorer search');


 // Rebuilding the Explorer after opening a file must not strand keyboard focus.
 await evaluate("(()=>{const b=[...document.querySelectorAll('#tree .node')].find(b=>b.textContent.includes('root-note.txt'));b.focus();b.click();})()");
 assert.equal(await evaluate("document.activeElement?.dataset?.entryId===JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='root-note.txt')?.id"),true,'Explorer must retain focus on the opened file');
 console.log('PASS LifeIDE browser: file selection retains keyboard focus');

 // Deleting from a focused Explorer action must move focus to a surviving entry.
 await evaluate("(()=>{const b=[...document.querySelectorAll('.entry-delete')].find(b=>b.getAttribute('aria-label')==='Delete file root-note.txt');window.confirm=()=>true;b.focus();b.click();})()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).some(f=>f.name==='root-note.txt')"),false,'The chosen file should be removed');
 assert.equal(await evaluate("Boolean(document.activeElement?.closest?.('#tree')&&document.activeElement.matches('button.node'))"),true,'Focus should move to a remaining Explorer item');
 console.log('PASS LifeIDE browser: delete restores focus to remaining Explorer item');

 // QA: canceling folder removal must preserve all descendants; confirmation removes only the subtree.
 await evaluate("window.confirm=()=>false;[...document.querySelectorAll('.entry-delete')].find(b=>b.getAttribute('aria-label')==='Delete folder samples').click()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).some(f=>f.name==='samples')"),true,'Cancel must preserve the parent folder');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).some(f=>f.name==='hello.js')"),true,'Cancel must preserve descendant files');
 await evaluate("window.confirm=()=>true;[...document.querySelectorAll('.entry-delete')].find(b=>b.getAttribute('aria-label')==='Delete folder samples').click()");
 const subtree=await evaluate("(()=>{const files=JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1'));return {folder:files.some(f=>f.id==='examples'),file:files.some(f=>f.id==='sample'),nested:files.some(f=>f.name==='nested'),unrelated:files.some(f=>f.name==='renamed-smoke.ts'),root:files.some(f=>f.name==='root-level')}})()");
 assert.equal(subtree.folder,false,'Confirmed delete must remove the selected folder');
 assert.equal(subtree.file,false,'Confirmed delete must remove descendant files');
 assert.equal(subtree.nested,false,'Confirmed delete must remove descendant folders');
 assert.equal(subtree.unrelated,true,'Unrelated root files must survive folder deletion');
 assert.equal(subtree.root,true,'Unrelated root folders must survive folder deletion');
 await evaluate("document.getElementById('refresh').click()");
 assert.equal(await evaluate("[...document.querySelectorAll('#tree .node')].some(b=>b.textContent.includes('samples'))"),false,'Deleted folders must not return after reload');
 console.log('PASS LifeIDE browser: recursive folder deletion, cancel safety, and persistence');










 if(realAuth){
  const credentials=JSON.stringify({username:process.env.LIFEIDE_TEST_USERNAME,password:process.env.LIFEIDE_TEST_PASSWORD});
  const loginStatus=await evaluate("(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:location.origin},body:JSON.stringify("+credentials+")});return r.status})()");
  assert.equal(loginStatus,200,'Real database-backed admin login should succeed');
 }
 await evaluate("document.getElementById('repositoryMode').click()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('modeLabel').textContent==='REPOSITORY'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('modeLabel').textContent"),'REPOSITORY');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.workspace.v1')).find(f=>f.name==='renamed-smoke.ts')?.content"),'const second = 2;','Switching to repository must preserve browser-local files');

 // Folder expansion must not rebuild the Explorer or clear the active editor.
 await evaluate("window.__repoOriginalReadme=[...document.querySelectorAll('#tree .node')].find(b=>b.title==='README.md');window.__repoOriginalReadme.click()");
 for(let i=0;i<40;i++){if(await evaluate("document.getElementById('fileTitle').textContent==='README.md'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'README.md');
 await evaluate("[...document.querySelectorAll('#tree .node')].find(b=>b.title==='src').click()");
 for(let i=0;i<40;i++){if(await evaluate("Boolean(document.querySelector('#tree .node[title=\"src/components\"]'))"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("Boolean(document.querySelector('#tree .node[title=\"src/components\"]'))"),true,'Expanding src displays the immediate child folder');
 assert.equal(await evaluate("document.querySelector('#tree .node[title=\"src\"]').getAttribute('aria-expanded')"),'true');
 assert.equal(await evaluate("document.querySelector('#tree .node[title=\"README.md\"]')===window.__repoOriginalReadme"),true,'Expanding one folder must preserve sibling DOM nodes');
 await evaluate("document.querySelector('#tree .node[title=\"src/components\"]').click()");
 for(let i=0;i<40;i++){if(await evaluate("Boolean(document.querySelector('#tree .node[title=\"src/components/Example.js\"]'))"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("Boolean(document.querySelector('#tree .node[title=\"src/components/Example.js\"]'))"),true,'Nested files load under their parent');
 await evaluate("window.__repoOriginalNested=document.querySelector('#tree .node[title=\"src/components/Example.js\"]');document.querySelector('#tree .node[title=\"src\"]').click()");
 assert.equal(await evaluate("document.querySelector('#tree .node[title=\"src\"]').getAttribute('aria-expanded')"),'false');
 assert.equal(await evaluate("document.querySelector('#tree .node[title=\"src/components\"]').closest('.repo-children').hidden"),true,'Collapse should hide children');
 await evaluate("document.querySelector('#tree .node[title=\"src\"]').click()");
 assert.equal(await evaluate("document.querySelector('#tree .node[title=\"src/components/Example.js\"]')===window.__repoOriginalNested"),true,'Reopening a folder uses cached children without rebuilding');
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'README.md','Folder toggle must not change open editor file');
 // Simulate a slow first file response followed by a fast second selection.
 // The older response must not overwrite the last selected file or its highlight.
 await evaluate("window.__fileFetch=window.fetch;window.fetch=(url,opts)=>String(url).includes('/api/lifeide/file?path=README.md')?new Promise(resolve=>setTimeout(()=>resolve(window.__fileFetch(url,opts)),350)):window.__fileFetch(url,opts)");
 await evaluate("document.querySelector('#tree .node[title=\"README.md\"]').click();document.querySelector('#tree .node[title=\"src/components/Example.js\"]').click()");
 await new Promise(r=>setTimeout(r,650));
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'src/components/Example.js','Slow earlier request must not replace last opened file');
 assert.equal(await evaluate("document.querySelector('#tree .node[title=\"src/components/Example.js\"]').classList.contains('selected')"),true,'Last opened file retains selected highlight');
 await evaluate("window.fetch=window.__fileFetch");
 console.log('PASS LifeIDE repository browser: inline nested folder expansion, collapse, stable tree and editor');
 // Explicit refresh resets the creation destination to repository root.
 await evaluate("document.getElementById('refresh').click()");
 for(let i=0;i<40;i++){if(await evaluate("Boolean([...document.querySelectorAll('#tree .node')].find(b=>b.title==='README.md'))"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("Boolean([...document.querySelectorAll('#tree .node')].find(b=>b.title==='README.md'))"),true);



 await evaluate("document.getElementById('newFile').click()");
 await evaluate("document.getElementById('dialogInput').value='browser-repository.js';document.getElementById('dialogForm').requestSubmit()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('fileTitle').textContent==='browser-repository.js'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'browser-repository.js');
 await evaluate("document.getElementById('editor').value='const browserRepository = true;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}))");
 await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true,cancelable:true}))");
 for(let i=0;i<50;i++){if((await readFile(path.join(workspace,'browser-repository.js'),'utf8'))==='const browserRepository = true;')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await readFile(path.join(workspace,'browser-repository.js'),'utf8'),'const browserRepository = true;');
 // Disk writes can finish before the save handler clears its in-flight flag.
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('status').textContent==='Saved to local repository'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('status').textContent"),'Saved to local repository','Wait for repository save to settle before Git review');
 // Reviewing Git changes must invalidate an earlier, still-loading source file.
 await evaluate("window.__reviewFetch=window.fetch;window.fetch=(url,opts)=>String(url).includes('/api/lifeide/file?path=README.md')?new Promise(resolve=>setTimeout(()=>resolve(window.__reviewFetch(url,opts)),350)):window.__reviewFetch(url,opts)");
 await evaluate("document.querySelector('#tree .node[title=\"README.md\"]').click();document.getElementById('gitChanges').click()");
 await new Promise(r=>setTimeout(r,550));
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'No file selected','Pending file read must not replace Git review editor');
 assert.equal(await evaluate("document.getElementById('editor').disabled"),true,'Git review must keep editor disabled after pending open');
 await evaluate("window.fetch=window.__reviewFetch");

 await evaluate("document.getElementById('gitChanges').click()");
 for(let i=0;i<50;i++){if(await evaluate("document.querySelectorAll('#tabs input[type=checkbox]').length"))break;await new Promise(r=>setTimeout(r,100));}
 const gitReview=await evaluate("({checkboxes:document.querySelectorAll('#tabs input[type=checkbox]').length,status:document.getElementById('status').textContent})");
 assert.ok(gitReview.checkboxes,'Git status should show a selectable change: '+gitReview.status);
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

 // In GitHub source mode, the entire structure is fetched exactly once. Every
 // nested folder expands locally without another Vercel/GitHub request.
 await evaluate("location.href='/lifeide/?source=github'");
 for(let i=0;i<80;i++){
  if(await evaluate("document.getElementById('modeLabel')?.textContent==='GITHUB · MAIN'"))break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(await evaluate("document.getElementById('modeLabel').textContent"),'GITHUB · MAIN');
 assert.equal(githubIndexRequests,1,'GitHub Explorer startup should request one full tree');
 await evaluate("document.querySelector('#tree .node[title=\"src\"]').click()");
 assert.equal(await evaluate("document.querySelector('#tree .node[title=\"src\"]').getAttribute('aria-expanded')"),'true');
 assert.equal(await evaluate("Boolean(document.querySelector('#tree .node[title=\"src/components\"]'))"),true);
 await evaluate("document.querySelector('#tree .node[title=\"src/components\"]').click()");
 assert.equal(await evaluate("Boolean(document.querySelector('#tree .node[title=\"src/components/Example.js\"]'))"),true);
 await evaluate("document.querySelector('#tree .node[title=\"src\"]').click()");
 await evaluate("document.querySelector('#tree .node[title=\"src\"]').click()");
 assert.equal(githubDirectoryRequests,0,'Folder expansion must never request individual GitHub directories');
 assert.equal(githubIndexRequests,1,'Reopening folders must reuse browser-side tree index');
 assert.equal(githubTreeRequests,1,'A GitHub index should use only one upstream GitHub API call');
 console.log('PASS LifeIDE GitHub Explorer: one index request and instant nested folder toggles');
 // Prefetched GitHub files should open without making another upstream request,
 // including a second selection of the same file.
 for(let i=0;i<80;i++){
  if(githubFileRequests>=2)break;
  await new Promise(r=>setTimeout(r,50));
 }
 assert.equal(githubFileRequests,2,'Root and nested file contents were prefetched exactly once');
 await new Promise(r=>setTimeout(r,100));
 const upstreamBeforeOpen=githubFileRequests;
 await evaluate("document.querySelector('#tree .node[title=\"src/components/Example.js\"]').click()");
 for(let i=0;i<40;i++){
  if(await evaluate("document.getElementById('fileTitle').textContent==='src/components/Example.js'"))break;
  await new Promise(r=>setTimeout(r,50));
 }
 assert.equal(await evaluate("document.getElementById('editor').value"),'export const example = true;');
 await evaluate("document.querySelector('#tree .node[title=\"README.md\"]').click()");
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'README.md');
 await evaluate("document.querySelector('#tree .node[title=\"src/components/Example.js\"]').click()");
 assert.equal(await evaluate("document.getElementById('fileTitle').textContent"),'src/components/Example.js');
 assert.equal(githubFileRequests,upstreamBeforeOpen,'Opening prefetched and previously viewed files must not call GitHub again');
 assert.equal(await evaluate("document.getElementById('editor').disabled"),false,'GitHub source files should open editable');
 assert.equal(await evaluate("document.getElementById('editGithub').hidden"),true,'Legacy Edit source control is hidden');
 assert.equal(await evaluate("document.getElementById('saveGithubDraft').hidden"),true,'Legacy Save draft control is hidden');
 assert.equal(await evaluate("document.getElementById('saveFile').disabled"),false,'Save is enabled when a source file is open');
 assert.equal(await evaluate("document.getElementById('publishGithub').closest('.github-workflow')!==null"),true,'GitHub handoff is in advanced workflow');
 await evaluate("document.getElementById('editor').value='export const example = 42;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}))");
 await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))");
 const storedDraft=await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.github-draft.v1:src/components/Example.js'))");
 assert.equal(storedDraft.content,'export const example = 42;','Ctrl+S persists GitHub source draft in browser only');
 assert.equal(await evaluate("document.getElementById('status').textContent.includes('Not committed to GitHub')"),true);
 await evaluate("document.getElementById('editor').value='export const example = 43;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('saveFile').click()");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.github-draft.v1:src/components/Example.js')).content"),'export const example = 43;','Save button persists same draft as Ctrl+S');
 await evaluate("document.querySelector('#tree .node[title=\"README.md\"]').click()");
 await evaluate("document.querySelector('#tree .node[title=\"src/components/Example.js\"]').click()");
 assert.equal(await evaluate("document.getElementById('editor').value"),'export const example = 43;','Saved draft restores automatically when source file reopens');
 // Simulate upstream main changing after a browser draft was saved.
 await evaluate("(()=>{const key='lifegen.lifeide.github-draft.v1:src/components/Example.js';const draft=JSON.parse(localStorage.getItem(key));draft.base='old-github-sha';localStorage.setItem(key,JSON.stringify(draft));})()");
 await evaluate("document.querySelector('#tree .node[title=\"README.md\"]').click()");
 await evaluate("document.querySelector('#tree .node[title=\"src/components/Example.js\"]').click()");
 assert.equal(await evaluate("document.getElementById('editor').value"),'export const example = 43;','Old-version draft must remain recoverable after source changes');
 assert.equal(await evaluate("document.getElementById('status').textContent.includes('older browser draft')"),true,'Stale draft must display upstream-change warning');
 await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('lifegen.lifeide.github-draft.v1:src/components/Example.js')).base"),'old-github-sha','Ctrl+S must preserve stale draft provenance');
 assert.equal(await evaluate("document.getElementById('status').textContent.includes('GitHub source has changed')"),true,'Save must retain stale draft warning');
 await evaluate("document.querySelector('#tree .node[title=\"README.md\"]').click()");
 await evaluate("document.querySelector('#tree .node[title=\"src/components/Example.js\"]').click()");
 assert.equal(await evaluate("document.getElementById('status').textContent.includes('older browser draft')"),true,'Reopening after save must retain upstream-change warning');
 console.log('PASS LifeIDE simplified editor: editable on open; Save and Ctrl+S preserve safe GitHub drafts');
 console.log('PASS LifeIDE GitHub files: background prefetch, cached opening, no repeated source fetches');




}finally{
 ws?.close();chrome?.kill();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150});await rm(workspace,{recursive:true,force:true});if(realAuth)await closePool();globalThis.fetch=originalGlobalFetch;
}
