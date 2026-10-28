import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import app from '../src/app.js';

const chromePath=process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=await mkdtemp(path.join(os.tmpdir(),'lifeide-browser-'));
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
}finally{
 ws?.close();chrome?.kill();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
