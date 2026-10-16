import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendEligibleCells, validateVipPriorityOrder } from '../src/lifegroup-match.js';

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

test('administrator priority order changes deterministic choice',()=>{
 const base={is_active:true,leads_network:false,leader_person_id:5,slots:2,is_demo:false};
 const groups=[{...base,id:1,schedule_day:'sun',area:'South'},
               {...base,id:2,schedule_day:'mon',area:'North'}];
 assert.deepEqual(recommendEligibleCells(groups,{day:'sun',area:'north'}).map(g=>g.id),[1,2]);
 assert.deepEqual(recommendEligibleCells(groups,{day:'sun',area:'north',
   priority_order:['area','day','category','capacity']}).map(g=>g.id),[2,1]);
});
test('priority validation rejects duplicates and unknown keys',()=>{
 assert.throws(()=>validateVipPriorityOrder(['day','day','category','capacity']));
 assert.throws(()=>validateVipPriorityOrder(['day','area','category','random']));
 assert.deepEqual(validateVipPriorityOrder('day,area,category,capacity'),['day','area','category','capacity']);
});

test('equally ranked cells have stable ID ordering regardless of input order',()=>{
 const base={is_active:true,leads_network:false,leader_person_id:5,slots:3,is_demo:false};
 const cells=[{...base,id:31},{...base,id:7},{...base,id:19}];
 assert.deepEqual(recommendEligibleCells(cells).map(c=>c.id),[7,19,31]);
 assert.deepEqual(recommendEligibleCells([...cells].reverse()).map(c=>c.id),[7,19,31]);
});
test('single preference does not accidentally award matches for blank fields',()=>{
 const base={is_active:true,leads_network:false,leader_person_id:5,slots:2,is_demo:false};
 const cells=[{...base,id:1,schedule_day:'sun'},{...base,id:2,schedule_day:'mon',slots:10}];
 assert.deepEqual(recommendEligibleCells(cells,{day:'sun'}).map(c=>c.id),[1,2]);
 assert.deepEqual(recommendEligibleCells(cells,{}).map(c=>c.id),[2,1]);
});
test('capacity and inactive filters reject zero and negative free slots',()=>{
 const base={is_active:true,leads_network:false,leader_person_id:5,is_demo:false};
 const cells=[{...base,id:1,slots:-1},{...base,id:2,slots:0},{...base,id:3,slots:1}];
 assert.deepEqual(recommendEligibleCells(cells).map(c=>c.id),[3]);
});
