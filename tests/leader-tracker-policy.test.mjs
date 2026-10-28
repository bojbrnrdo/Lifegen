import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeLinkedLeaderTrackerMethod as authorize} from '../src/leader-tracker-policy.js';
const actor={id:10,role_id:'staff'};
const mock=(linked,networks=[],cells=[],networkCells=[])=>({query:async(sql)=>({rows:sql.includes('FROM staff_users')?[{person_id:linked}]:sql.includes('WHERE network_id=ANY')?networkCells:sql.includes('FROM networks')?networks:cells})});
test('admin remains unrestricted',async()=>assert.doesNotReject(authorize({query:()=>{throw Error('unexpected query')}},{id:1,role_id:'admin'},'network',[999])));
test('unlinked staff retains legacy permission-based routing',async()=>assert.doesNotReject(authorize(mock(null),actor,'people',[{}])));
test('network leader sees only assigned network and its cells',async()=>{
 const c=mock(2,[{id:4}],[],[{id:22}]);
 await assert.doesNotReject(authorize(c,actor,'network',[4]));
 await assert.doesNotReject(authorize(c,actor,'lifegroup',[22]));
 await assert.rejects(authorize(c,actor,'network',[6]),{status:403});
 await assert.rejects(authorize(c,actor,'lifegroup',[23]),{status:403});
});
test('cell leader cannot read parent network or other cells',async()=>{
 const c=mock(7,[],[{id:22,network_id:4}]);
 await assert.doesNotReject(authorize(c,actor,'lifegroup',[22]));
 await assert.rejects(authorize(c,actor,'network',[4]),{status:403});
 await assert.rejects(authorize(c,actor,'lifegroup',[23]),{status:403});
});
test('linked leaders cannot access unscoped operations including all writes',async()=>{
 const c=mock(2,[{id:4}],[],[{id:22}]);
 for(const method of ['search','networks','lifegroups','createPerson','updatePerson','assignLifegroup','createNetwork','reportSummary','saveMeeting'])
  await assert.rejects(authorize(c,actor,method,[]),{status:403});
});
test('linked people without leadership have no tracker access',async()=>{
 await assert.rejects(authorize(mock(9),actor,'lifegroup',[1]),{status:403});
});
test('missing or malformed detail identifiers never authorize collection access',async()=>{
 const c=mock(2,[{id:4}],[],[{id:22}]);
 for(const value of [undefined,null,'',0,-1,'01','4x',{},[],Number.MAX_SAFE_INTEGER+1]) {
  await assert.rejects(authorize(c,actor,'network',[value]),{status:403});
  await assert.rejects(authorize(c,actor,'lifegroup',[value]),{status:403});
 }
});

test('linked leader People query is constrained to assigned cells',async()=>{
 const result=await authorize(mock(2,[{id:4}],[],[{id:22},{id:23}]),actor,'people',[{}]);
 assert.deepEqual(result,{allowedCellIds:[22,23]});
});

test('individual profile denies out-of-scope People and permits active assigned membership',async()=>{
 const c=mock(2,[{id:4}],[],[{id:22}]);
 const original=c.query;
 c.query=async(sql,params)=>sql.includes('FROM lifegroup_memberships')?{rows:params[0]===100?[{one:1}]:[]}:original(sql,params);
 await assert.doesNotReject(authorize(c,actor,'person',[100]));
 await assert.rejects(authorize(c,actor,'person',[101]),{status:403});
 for(const bad of [null,undefined,{},'01',0])await assert.rejects(authorize(c,actor,'person',[bad]),{status:403});
});

test('linked leader can update tier only within assigned Cell',async()=>{
 const c=mock(2,[{id:4}],[],[{id:22}]);
 await assert.doesNotReject(authorize(c,actor,'setTier',[22,100,'solid']));
 await assert.rejects(authorize(c,actor,'setTier',[23,100,'solid']),{status:403});
 await assert.rejects(authorize(c,actor,'setTier',[22,{},'solid']),{status:403});
});
