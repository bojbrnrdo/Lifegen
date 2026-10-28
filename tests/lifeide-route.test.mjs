import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

test('LifeIDE application routes serve editor assets while repository API stays off',async()=>{
 const previous=process.env.LIFEIDE_LOCAL_EDIT;
 delete process.env.LIFEIDE_LOCAL_EDIT;
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  for(const route of ['/lifeide','/lifeide/','/lifeide/index.html']){
   const response=await fetch(base+route);
   assert.equal(response.status,200,route);
   assert.match(await response.text(),/LifeIDE/);
  }
  for(const route of ['/lifeide/app.js','/lifeide/styles.css'])
   assert.equal((await fetch(base+route)).status,200,route);
  assert.equal((await fetch(base+'/api/lifeide/tree')).status,404);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  if(previous===undefined)delete process.env.LIFEIDE_LOCAL_EDIT;
  else process.env.LIFEIDE_LOCAL_EDIT=previous;
 }
});

test('real application requires a staff session when local repository editing is opted in',async()=>{
 const old=process.env.LIFEIDE_LOCAL_EDIT,oldNode=process.env.NODE_ENV;
 process.env.LIFEIDE_LOCAL_EDIT='true';process.env.NODE_ENV='test';
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/lifeide/tree');
  assert.equal(response.status,401);
  const write=await fetch(base+'/api/lifeide/entry',{
   method:'POST',headers:{'content-type':'application/json',origin:base},
   body:JSON.stringify({path:'test.js',type:'file'})
  });
  assert.equal(write.status,401);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  if(old===undefined)delete process.env.LIFEIDE_LOCAL_EDIT;else process.env.LIFEIDE_LOCAL_EDIT=old;
  if(oldNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNode;
 }
});
