import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createLifeIdeRouter} from '../src/lifeide.js';

test('admin-only GitHub source browsing returns real folders and readable files without write access',async()=>{
 const previous=globalThis.fetch;
 let upstreamCalls=0;
 globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://api.github.com/'))return previous(url,options);
  upstreamCalls++;
  if(String(url).includes('/git/trees/main?recursive=1'))return new Response(JSON.stringify({
   sha:'tree123',truncated:false,tree:[
    {path:'src',type:'tree'},{path:'src/components',type:'tree'},
    {path:'src/components/Example.js',type:'blob'},{path:'README.md',type:'blob'},
    {path:'.env',type:'blob'},{path:'node_modules/pkg.js',type:'blob'}
   ]
  }),{status:200});
  if(String(url).includes('/contents/src/hello.js'))return new Response(JSON.stringify({type:'file',size:21,encoding:'base64',content:Buffer.from('export const life = 1;').toString('base64'),sha:'abc'}),{status:200});
  return new Response(JSON.stringify([{name:'src',type:'dir'},{name:'README.md',type:'file'},{name:'.env',type:'file'}]),{status:200});
 };
 const app=express();
 app.use('/api/lifeide',createLifeIdeRouter({
  authenticate:(req,res,next)=>{if(req.headers['x-test-admin']!=='true')return res.status(401).json({message:'Unauthorized'});req.actor={role_id:'admin'};next();},
  access:(req,res)=>res.status(404).json({message:'Local editing disabled'})
 }));
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const noAuth=await previous(base+'/api/lifeide/remote/tree');
  assert.equal(noAuth.status,401);
  const headers={'x-test-admin':'true'};
  const unauthorizedIndex=await previous(base+'/api/lifeide/remote/index');
  assert.equal(unauthorizedIndex.status,401);
  const fullIndex=await previous(base+'/api/lifeide/remote/index',{headers});
  assert.equal(fullIndex.status,200);
  assert.deepEqual((await fullIndex.json()).paths,[
   {path:'src',type:'folder',size:0},{path:'src/components',type:'folder',size:0},
   {path:'src/components/Example.js',type:'file',size:0},{path:'README.md',type:'file',size:0}
  ]);
  const repeatedIndex=await previous(base+'/api/lifeide/remote/index',{headers});
  assert.equal(repeatedIndex.status,200,'Cached index remains available');
  const root=await previous(base+'/api/lifeide/remote/tree',{headers});
  assert.equal(root.status,200);
  assert.deepEqual((await root.json()).items,[{name:'src',type:'folder'},{name:'README.md',type:'file'}]);
  const file=await previous(base+'/api/lifeide/remote/file?path=src%2Fhello.js',{headers});
  assert.equal(file.status,200);
  assert.equal((await file.json()).content,'export const life = 1;');
  const traversal=await previous(base+'/api/lifeide/remote/file?path=..%2F.env',{headers});
  assert.equal(traversal.status,400);
  const write=await previous(base+'/api/lifeide/remote/file',{method:'PUT',headers});
  assert.equal(write.status,404);
  assert.equal(upstreamCalls,3,'Whole-tree index should require only one upstream request, including repeat reads');
 }finally{server.close();globalThis.fetch=previous;}
});
