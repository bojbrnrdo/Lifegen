import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveLifeIdePath,verifyLifeIdePath} from '../src/lifeide.js';
test('temporary repository path rules prevent traversal and hidden files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lifeide-check-'));
 try{
  await fs.mkdir(path.join(dir,'src'));
  await fs.writeFile(path.join(dir,'src','valid.js'),'hello');
  assert.equal(await verifyLifeIdePath('src/valid.js',{workspace:dir}),path.join(dir,'src','valid.js'));
  assert.equal(await verifyLifeIdePath('src/fresh.js',{workspace:dir,create:true}),path.join(dir,'src','fresh.js'));
  for(const name of ['../outside','src/../../outside','.git/config','src/.env','src//bad','/etc/passwd','node_modules/x','src/\\bad']){
   assert.throws(()=>resolveLifeIdePath(name,dir),{status:400});
  }
  await assert.rejects(verifyLifeIdePath('src/missing.js',{workspace:dir}),{status:404});
  await fs.symlink(os.tmpdir(),path.join(dir,'src','outside'));
  await assert.rejects(verifyLifeIdePath('src/outside/data',{workspace:dir}),{status:403});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
