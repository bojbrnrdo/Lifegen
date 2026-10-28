import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {execFileSync} from 'node:child_process';
import {createLifeIdeRouter} from '../src/lifeide.js';

test('repository editing gate rejects requests when opt-in is disabled',async()=>{
 const previous=process.env.LIFEIDE_LOCAL_EDIT;
 delete process.env.LIFEIDE_LOCAL_EDIT;
 const app=express();
 app.use('/api/lifeide',createLifeIdeRouter({authenticate:(req,res,next)=>next(),checkRole:(req,res,next)=>next()}));
 const listener=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>listener.once('listening',resolve));
  const response=await fetch('http://127.0.0.1:'+listener.address().port+'/api/lifeide/tree');
  assert.equal(response.status,404);
 }finally{
  await new Promise(resolve=>listener.close(resolve));
  if(previous===undefined)delete process.env.LIFEIDE_LOCAL_EDIT;else process.env.LIFEIDE_LOCAL_EDIT=previous;
 }
});

test('repository editing remains disabled in production even with explicit opt-in',async()=>{
 const previousEdit=process.env.LIFEIDE_LOCAL_EDIT,previousNode=process.env.NODE_ENV;
 process.env.LIFEIDE_LOCAL_EDIT='true';process.env.NODE_ENV='production';
 const app=express();
 app.use('/api/lifeide',createLifeIdeRouter({authenticate:(req,res,next)=>next(),checkRole:(req,res,next)=>next()}));
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>server.once('listening',resolve));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/lifeide/tree');
  assert.equal(response.status,404);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  if(previousEdit===undefined)delete process.env.LIFEIDE_LOCAL_EDIT;else process.env.LIFEIDE_LOCAL_EDIT=previousEdit;
  if(previousNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousNode;
 }
});

test('real administrator role middleware denies non-admin actors',async()=>{
 const old=process.env.LIFEIDE_LOCAL_EDIT;
 const oldNode=process.env.NODE_ENV;
 process.env.LIFEIDE_LOCAL_EDIT='true';
 process.env.NODE_ENV='test';
 const app=express();
 app.use('/api/lifeide',createLifeIdeRouter({
  authenticate:(req,res,next)=>{req.actor={role_id:req.get('x-test-role')||'viewer'};next();}
 }));
 app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
 const listener=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>listener.once('listening',resolve));
  const base='http://127.0.0.1:'+listener.address().port+'/api/lifeide/tree';
  const denied=await fetch(base,{headers:{'x-test-role':'viewer'}});
  assert.equal(denied.status,403);
 }finally{
  await new Promise(resolve=>listener.close(resolve));
  if(old===undefined)delete process.env.LIFEIDE_LOCAL_EDIT;else process.env.LIFEIDE_LOCAL_EDIT=old;
  if(oldNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNode;
 }
});

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
  assert.equal((await call('/file',{method:'PUT',body:{path:'src/test.js',content:'bad\u0000value',version:first.data.version}})).status,415);
  assert.equal((await call('/file',{method:'PUT',body:{path:'src/test.js',content:'bad\ud800value',version:first.data.version}})).status,415);
  const latest=await call('/file?path=src%2Ftest.js');
  assert.equal((await call('/file',{method:'PUT',body:{path:'src/test.js',content:'a'.repeat(512*1024+1),version:latest.data.version}})).status,413);
  assert.equal((await call('/file',{method:'PUT',body:{path:'src/test.js',content:'valid 🌿 UTF-8',version:latest.data.version}})).status,200);
  assert.equal((await call('/file',{method:'PUT',body:{path:'src/test.js',content:'stale content',version:latest.data.version}})).status,409);
  assert.equal(await fs.readFile(path.join(workspace,'src/test.js'),'utf8'),'valid 🌿 UTF-8');
  await fs.writeFile(path.join(workspace,'src','binary.txt'),Buffer.from([0xff,0xfe]));
  const bad=await call('/file?path=src%2Fbinary.txt');
  assert.equal(bad.status,415);
  const invalidSave=await call('/file',{method:'PUT',body:{
   path:'src/binary.txt',content:'should not replace invalid text',
   version:(await import('node:crypto')).createHash('sha256').update(Buffer.from([0xff,0xfe])).digest('hex')
  }});
  assert.equal(invalidSave.status,415);
  assert.deepEqual(await fs.readFile(path.join(workspace,'src','binary.txt')),Buffer.from([0xff,0xfe]));
  const tree=await call('/tree?path=src');assert.ok(tree.data.items.some(x=>x.name==='test.js'));
  assert.equal((await call('/file?path=..%2Fetc%2Fpasswd')).status,400);
  execFileSync('git',['init','-q'],{cwd:workspace});
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','add','src/test.js'],{cwd:workspace});
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','baseline'],{cwd:workspace});
  execFileSync('git',['checkout','-qb','feature/test-lifeide'],{cwd:workspace});
  await fs.writeFile(path.join(workspace,'src/test.js'),'changed');
  const status=await call('/git/status');
  assert.equal(status.status,200);
  assert.ok(status.data.entries.some(x=>x.path==='src/test.js'));
  const diff=await call('/git/diff?path=src%2Ftest.js');
  assert.equal(diff.status,200);
  assert.match(diff.data.diff,/changed/);
  await fs.writeFile(path.join(workspace,'src/other.js'),'unrelated');
  assert.equal((await call('/git/commit',{method:'POST',body:{paths:['src/test.js'],message:'x'}})).status,400);
  assert.equal((await call('/git/commit',{method:'POST',body:{paths:['src/test.js'],message:'Change test file'},token:false})).status,403);
  execFileSync('git',['checkout','-q','-b','release/test'],{cwd:workspace});
  assert.equal((await call('/git/commit',{method:'POST',body:{paths:['src/test.js'],message:'Blocked on release branch'}})).status,409);
  execFileSync('git',['checkout','-q','feature/test-lifeide'],{cwd:workspace});
  execFileSync('git',['add','src/other.js'],{cwd:workspace});
  assert.equal((await call('/git/commit',{method:'POST',body:{paths:['src/test.js'],message:'Blocked with staged files'}})).status,409);
  execFileSync('git',['reset','-q','--','src/other.js'],{cwd:workspace});
  assert.equal((await call('/git/commit',{method:'POST',body:{paths:['src/test.js','src/test.js'],message:'Duplicate path attempt'}})).status,400);
  assert.equal((await call('/git/commit',{method:'POST',body:{paths:['src/other.js'],message:'Untracked file commit'}})).status,200);
  await fs.writeFile(path.join(workspace,'src/other.js'),'another change');
  const committed=await call('/git/commit',{method:'POST',body:{paths:['src/test.js'],message:'Update test file'}});
  assert.equal(committed.status,200,JSON.stringify(committed.data));
  assert.ok(committed.data.commit);
  const finalStatus=await call('/git/status');
  await fs.writeFile(path.join(workspace,'src','name with spaces.js'),'export default 1;');
  const spaced=await call('/git/status');
  assert.ok(spaced.data.entries.some(x=>x.path==='src/name with spaces.js'));
  assert.ok(finalStatus.data.entries.some(x=>x.path==='src/other.js'));
  assert.ok(!finalStatus.data.entries.some(x=>x.path==='src/test.js'));

 }finally{await new Promise(resolve=>listener.close(resolve));await fs.rm(workspace,{recursive:true,force:true});}
});
