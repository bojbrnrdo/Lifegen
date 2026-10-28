import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {execFileSync} from 'node:child_process';
import {createLifeIdeRouter} from '../src/lifeide.js';

test('isolated HTTP API: access, creation, save, conflict and Git review',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'lifegen-ide-http-'));
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>req.get('x-test-user')==='admin'?next():res.status(401).json({message:'Unauthorized'});
 const origin=(req)=>{if(req.get('origin')!=='http://localhost')throw Object.assign(new Error('Origin'),{status:403});};
 const csrf=(req)=>{if(req.get('x-csrf-token')!=='test-csrf')throw Object.assign(new Error('CSRF'),{status:403});};
 app.use('/api/lifeide',createLifeIdeRouter({workspace,authenticate:auth,access:(req,res,next)=>next(),checkRole:(req,res,next)=>next(),origin,csrf}));
 app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
 const listener=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>listener.once('listening',resolve));
  const base='http://127.0.0.1:'+listener.address().port+'/api/lifeide';
  async function call(url,{method='GET',body,admin=true,token=true}={}){
   const r=await fetch(base+url,{method,headers:{...(admin?{'x-test-user':'admin'}:{}),...(body?{'content-type':'application/json','origin':'http://localhost',...(token?{'x-csrf-token':'test-csrf'}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:r.status,data:await r.json()};
  }
  assert.equal((await call('/tree',{admin:false})).status,401);
  assert.equal((await call('/entry',{method:'POST',body:{path:'src',type:'folder'},token:false})).status,403);
  assert.equal((await call('/entry',{method:'POST',body:{path:'src',type:'folder'}})).status,201);
  assert.equal((await call('/entry',{method:'POST',body:{path:'src/test.js',type:'file'}})).status,201);
  assert.equal((await call('/entry',{method:'POST',body:{path:'src/test.js',type:'file'}})).status,409);
  const first=await call('/file?path=src%2Ftest.js');
  assert.equal(first.status,200);
  assert.equal((await call('/file',{method:'PUT',body:{path:'src/test.js',content:'hello',version:first.data.version}})).status,200);
  assert.equal((await call('/file',{method:'PUT',body:{path:'src/test.js',content:'overwrite',version:first.data.version}})).status,409);
  assert.equal(await fs.readFile(path.join(workspace,'src/test.js'),'utf8'),'hello');
  const tree=await call('/tree?path=src');assert.equal(tree.data.items[0].name,'test.js');
  assert.equal((await call('/file?path=..%2Fetc%2Fpasswd')).status,400);
  execFileSync('git',['init','-q'],{cwd:workspace});
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','add','src/test.js'],{cwd:workspace});
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','baseline'],{cwd:workspace});
  await fs.writeFile(path.join(workspace,'src/test.js'),'changed');
  const status=await call('/git/status');
  assert.equal(status.status,200);
  assert.ok(status.data.entries.some(x=>x.path==='src/test.js'));
  const diff=await call('/git/diff?path=src%2Ftest.js');
  assert.equal(diff.status,200);
  assert.match(diff.data.diff,/changed/);
 }finally{await new Promise(resolve=>listener.close(resolve));await fs.rm(workspace,{recursive:true,force:true});}
});
