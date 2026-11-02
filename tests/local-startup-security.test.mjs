import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const launcher=fileURLToPath(new URL('../scripts/start-local-demo.mjs',import.meta.url));
async function probe(values, overrides={}){
 const cwd=await mkdtemp(path.join(tmpdir(),'lifegen-launcher-test-'));
 try{
  if(values!==null)await writeFile(path.join(cwd,'.env.lifeide.local'),values);
  const env={...process.env,DATABASE_URL:'',DATABASE_DIRECT_URL:'',LOCAL_DEMO:'',NODE_ENV:'test',VERCEL_ENV:'',PORT:'',...overrides};
  return spawnSync(process.execPath,[launcher],{cwd,env,encoding:'utf8',timeout:5000});
 }finally{await rm(cwd,{recursive:true,force:true});}
}
test('local launcher rejects missing private configuration',async()=>{
 const result=await probe(null);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Missing .env.lifeide.local/);
});
test('local launcher refuses remote or production database addresses before Docker access',async()=>{
 for(const host of ['db.example.com','192.168.1.10']){
  const result=await probe(`DATABASE_URL=postgres://demo:demo@${host}:5432/lifegen\nLOCAL_DEMO=true\n`);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Refusing to connect to a non-local database/);
 }
});
test('local launcher rejects production environment and missing demo opt-in',async()=>{
 const config='DATABASE_URL=postgres://demo:demo@127.0.0.1:55449/lifegen\nLOCAL_DEMO=true\n';
 const prod=await probe(config,{VERCEL_ENV:'production'});
 assert.notEqual(prod.status,0);assert.match(prod.stderr,/cannot run in production/);
 const missingDemo=await probe(config.replace('LOCAL_DEMO=true','LOCAL_DEMO=false'));
 assert.notEqual(missingDemo.status,0);assert.match(missingDemo.stderr,/LOCAL_DEMO=true is required/);
});
