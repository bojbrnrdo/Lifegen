import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertGlobalExportAccess} from '../src/leader-export-policy.js';
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
test('admin exports remain available',async()=>assert.doesNotReject(assertGlobalExportAccess({query:()=>{throw Error('unexpected')}},{id:1,role_id:'admin'})));
test('unlinked legacy staff retains report permission behavior',async()=>assert.doesNotReject(assertGlobalExportAccess({query:async()=>({rows:[{person_id:null}]})},{id:5,role_id:'staff'})));
test('linked staff global export denied regardless of active leadership',async()=>{
 const db={query:async(sql)=>{
  if(sql.includes('FROM staff_users'))return {rows:[{person_id:17}]};
  if(sql.includes('FROM people WHERE'))return {rows:[{archived_at:null,status:'active'}]};
  return {rows:[]};
 }};
 await assert.rejects(assertGlobalExportAccess(db,{id:5,role_id:'staff'}),{status:403});
});
test('both direct global export routes enforce same guard',()=>{
 assert.match(app,/reports:view'\);await assertGlobalExportAccess\(\{query\},req.actor\)/);
 assert.match(app,/settings:manage'\);await assertGlobalExportAccess\(\{query\},req.actor\)/);
});
