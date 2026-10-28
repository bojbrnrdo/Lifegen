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

 if(realAuth){
  const credentials=JSON.stringify({username:process.env.LIFEIDE_TEST_USERNAME,password:process.env.LIFEIDE_TEST_PASSWORD});
  const loginStatus=await evaluate("(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:location.origin},body:JSON.stringify("+credentials+")});return r.status})()");
  assert.equal(loginStatus,200,'Real database-backed admin login should succeed');
 }
 await evaluate("document.getElementById('repositoryMode').click()");
 for(let i=0;i<50;i++){if(await evaluate("document.getElementById('modeLabel').textContent==='REPOSITORY'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate("document.getElementById('modeLabel').textContent"),'REPOSITORY');
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
 await (await import('node:fs/promises')).writeFile(path.join(workspace,'browser-repository.js'),'const externalChange = true;');
 await evaluate("document.getElementById('editor').value='const staleBrowserEdit = true;';document.getElementById('editor').dispatchEvent(new Event('input',{bubbles:true}))");
 await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true,cancelable:true}))");
 await new Promise(r=>setTimeout(r,450));
 assert.equal(await readFile(path.join(workspace,'browser-repository.js'),'utf8'),'const externalChange = true;','Stale editor must not overwrite external changes');
 console.log('PASS LifeIDE repository browser: stale-version save blocked');
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
