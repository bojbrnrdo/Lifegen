import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLeaderScope,assertLeaderScope} from '../src/leader-scope.js';
const actor=(role_id='staff')=>({id:7,role_id});
const client=(personId,networks=[],cells=[],networkCells=[])=>({query:async(sql)=>({rows:sql.includes('FROM staff_users')?[{person_id:personId}]:sql.includes('WHERE network_id=ANY')?networkCells:sql.includes('FROM networks')?networks:cells})});
test('admin scope is privileged and does not query leadership tables',async()=>{
 const scope=await resolveLeaderScope({query:()=>{throw Error('unnecessary lookup')}},actor('admin'));
 assert.equal(scope.kind,'admin');assert.doesNotThrow(()=>assertLeaderScope(scope,{networkId:999}));
});
test('unlinked staff fails closed',async()=>{
 const scope=await resolveLeaderScope(client(null),actor());
 assert.equal(scope.kind,'unassigned');assert.throws(()=>assertLeaderScope(scope,{networkId:1}),{status:403});
});
test('network leaders cannot cross networks',async()=>{
 const scope=await resolveLeaderScope(client(3,[{id:4}],[]),actor());
 assert.equal(scope.kind,'network_leader');assert.doesNotThrow(()=>assertLeaderScope(scope,{networkId:4}));
 assert.throws(()=>assertLeaderScope(scope,{networkId:5}),{status:403});
});
test('cell leaders cannot manage other cells or the parent network',async()=>{
 const scope=await resolveLeaderScope(client(2,[],[{id:10,network_id:4}]),actor());
 assert.equal(scope.kind,'cell_leader');assert.doesNotThrow(()=>assertLeaderScope(scope,{cellId:10}));
 assert.throws(()=>assertLeaderScope(scope,{cellId:11}),{status:403});
 assert.throws(()=>assertLeaderScope(scope,{networkId:4}),{status:403});
});
test('leaders with no active assignments fail closed',async()=>{
 const scope=await resolveLeaderScope(client(9),actor());
 assert.equal(scope.kind,'unassigned');assert.throws(()=>assertLeaderScope(scope,{cellId:1}),{status:403});
});

test('network leaders can access cells in their network, never other networks',async()=>{
 const scope=await resolveLeaderScope(client(3,[{id:4}],[],[{id:10},{id:11}]),actor());
 assert.deepEqual(scope.cellIds,[10,11]);
 assert.doesNotThrow(()=>assertLeaderScope(scope,{cellId:11}));
 assert.throws(()=>assertLeaderScope(scope,{cellId:12}),{status:403});
});
