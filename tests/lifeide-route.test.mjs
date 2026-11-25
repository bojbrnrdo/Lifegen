import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

test('retired Dev tools, APIs and static assets cannot be opened directly',async()=>{
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const paths=[
   '/lifeide','/lifeide/','/lifeide/index.html','/lifeide/app.js',
   '/lifeide/styles.css','/api/lifeide/tree','/api/lifeide/remote/index',
   '/api/admin/dev/status','/api/admin/dev/branches','/api/admin/dev/package-runs'
  ];
  for(const route of paths)assert.equal((await fetch(base+route)).status,404,route);
  for(const route of ['/api/lifeide/entry','/api/admin/dev/branch','/api/admin/dev/package']){
   const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   assert.equal(r.status,404,route);
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});
