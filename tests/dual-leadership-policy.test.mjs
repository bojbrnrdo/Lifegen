import test from 'node:test';
import assert from 'node:assert/strict';
import {hasOutOfNetworkCellLeadership,canDeactivateNetwork} from '../src/lifegroups.js';

test('a Network Leader may also lead a Cell in their own active Network',()=>{
 assert.equal(hasOutOfNetworkCellLeadership([{id:4}],[{id:3,network_id:4}]),false);
 assert.equal(hasOutOfNetworkCellLeadership([{id:4},{id:5}],[{id:3,network_id:4},{id:7,network_id:5}]),false);
});
test('cross-network or unassigned Cell leadership is not valid for Network Leader',()=>{
 assert.equal(hasOutOfNetworkCellLeadership([{id:4}],[{id:3,network_id:1}]),true);
 assert.equal(hasOutOfNetworkCellLeadership([{id:4}],[{id:3,network_id:null}]),true);
 assert.equal(hasOutOfNetworkCellLeadership([],[{id:3,network_id:4}]),true);
});

test('auto-placement and Cell editing share the same in-network eligibility policy',()=>{
 const leaderNetworks=[{id:4}];
 assert.equal(hasOutOfNetworkCellLeadership(leaderNetworks,[{id:3,network_id:4}]),false);
 assert.equal(hasOutOfNetworkCellLeadership(leaderNetworks,[{id:3,network_id:1}]),true);
 assert.equal(hasOutOfNetworkCellLeadership(leaderNetworks,[{id:3,network_id:null}]),true);
});

test('Network deactivation is forbidden while active Cells remain',()=>{
 assert.equal(canDeactivateNetwork(0),true);
 for(const activeCount of [1,2,12,-1,NaN,Infinity,'0',null])
  assert.equal(canDeactivateNetwork(activeCount),false);
});
