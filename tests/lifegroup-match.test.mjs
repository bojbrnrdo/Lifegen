import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendEligibleCells } from '../src/lifegroup-match.js';

test('excludes inactive, demo, leader-only, unled and full cells', () => {
 const base={is_active:true,leads_network:false,leader_person_id:42,slots:1,is_demo:false};
 const groups=[{...base,id:1},{...base,id:2,slots:0},{...base,id:3,leads_network:true},{...base,id:4,is_active:false},{...base,id:5,leader_person_id:null},{...base,id:6,is_demo:true}];
 assert.deepEqual(recommendEligibleCells(groups).map(g=>g.id),[1]);
});
test('matching day, area and category wins; ties sort by capacity then ID',()=>{
 const base={is_active:true,leads_network:false,leader_person_id:5,slots:2,is_demo:false};
 const groups=[{...base,id:12,schedule_day:'sun',area:'North',category:'youth'},{...base,id:9,slots:4,schedule_day:'sun',area:'north',category:'youth'},{...base,id:3,slots:8,schedule_day:'mon',area:'south'}];
 assert.deepEqual(recommendEligibleCells(groups,{day:'SUN',area:'North',category:'Youth'}).map(g=>g.id),[9,12,3]);
});
