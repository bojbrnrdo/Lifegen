import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeLinkedLeaderTrackerMethod as authorize} from '../src/leader-tracker-policy.js';
import {assertGlobalExportAccess} from '../src/leader-export-policy.js';
const actor={id:10,role_id:'staff'};
const db={query:async(sql,params=[])=>({rows:sql.includes('FROM staff_users')?[{person_id:2}]:sql.includes('FROM people WHERE')?[{status:'active',archived_at:null}]:sql.includes('WHERE network_id=ANY')?[{id:22}]:sql.includes('FROM networks')?[{id:4}]:sql.includes('FROM lifegroups g')?[]:sql.includes('FROM lifegroup_memberships')?(params[0]===99?[{ok:true}]:[]):[]})};
test('linked Network Leader direct API denies out-of-scope reads and writes',async()=>{
 for(const [method,args] of [['network',[5]],['lifegroup',[23]],['person',[100]],['setTier',[23,99,'solid']],['leaveLifegroup',[23,99]],['assignLifegroup',[23,99]],['reportSummary',[]],['search',['test']]]){
  await assert.rejects(authorize(db,actor,method,args),{status:403},method);
 }
});
test('linked Network Leader direct API permits only scoped operations',async()=>{
 for(const [method,args] of [['network',[4]],['lifegroup',[22]],['person',[99]],['people',[{}]],['setTier',[22,99,'solid']]]){
  await assert.doesNotReject(authorize(db,actor,method,args),method);
 }
});
test('linked Network Leader cannot bypass scope using global export routes',async()=>{
 await assert.rejects(assertGlobalExportAccess(db,actor),{status:403});
});
