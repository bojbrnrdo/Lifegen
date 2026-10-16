import test from 'node:test';
import assert from 'node:assert/strict';
import {hasOutOfNetworkCellLeadership} from '../src/lifegroups.js';

test('a Network Leader may also lead a Cell in their own active Network',()=>{
 assert.equal(hasOutOfNetworkCellLeadership([{id:4}],[{id:3,network_id:4}]),false);
 assert.equal(hasOutOfNetworkCellLeadership([{id:4},{id:5}],[{id:3,network_id:4},{id:7,network_id:5}]),false);
});
test('cross-network or unassigned Cell leadership is not valid for Network Leader',()=>{
 assert.equal(hasOutOfNetworkCellLeadership([{id:4}],[{id:3,network_id:1}]),true);
 assert.equal(hasOutOfNetworkCellLeadership([{id:4}],[{id:3,network_id:null}]),true);
 assert.equal(hasOutOfNetworkCellLeadership([],[{id:3,network_id:4}]),true);
});
