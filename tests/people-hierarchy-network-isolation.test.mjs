import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifegroupTree } from '../public/admin/js/views/hierarchy.js';

test('People hierarchy retains a Cell led by its Network Leader without leaking Cells from other Networks', () => {
 const networks=[
  {id:10,name:'Network A',leader_person_id:1,is_active:true},
  {id:20,name:'Network B',leader_person_id:2,is_active:true},
 ];
 const groups=[
  {id:101,network_id:10,leader_person_id:1,leader_name:'Leader A',member_count:3,is_active:true},
  {id:202,network_id:20,leader_person_id:2,leader_name:'Leader B',member_count:5,is_active:true},
 ];
 const tree=buildLifegroupTree(networks,groups,{status:'active'},new Set(['network:10','network:20']),new Map(),new Set());
 assert.equal(tree.length,2);
 assert.deepEqual(tree[0].children.map(c=>c.record.id),[101]);
 assert.deepEqual(tree[1].children.map(c=>c.record.id),[202]);
 assert.equal(tree[0].children[0].count,3);
 assert.equal(tree[1].children[0].count,5);
});
