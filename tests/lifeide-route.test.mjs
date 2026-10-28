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
