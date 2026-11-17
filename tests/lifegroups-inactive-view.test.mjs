import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterTrackerView} from '../public/admin/js/views/hierarchy.js';

const view=readFileSync(new URL('../public/admin/js/views/lifegroups.js',import.meta.url),'utf8');

const networks=[
 {id:1,name:'Alpha',gender:'boys',is_active:true,leader_name:'Alpha Leader'},
 {id:2,name:'Beta',gender:'girls',is_active:true,leader_name:'Beta Leader'},
 {id:3,name:'Old Boys',gender:'boys',is_active:false,leader_name:'Old Leader'},
];
const groups=[
 {id:10,name:'Alpha Cell 1',network_id:1,gender:'boys',is_active:true,leads_network:false,member_count:4},
 {id:11,name:'Alpha Cell 2',network_id:1,gender:'boys',is_active:false,leads_network:false,member_count:2},
 {id:12,name:'Alpha Leaders',network_id:1,gender:'boys',is_active:true,leads_network:true,member_count:2},
 {id:13,name:'Beta Cell',network_id:2,gender:'girls',is_active:true,leads_network:false,member_count:3},
 {id:14,name:'Old Cell',network_id:3,gender:'boys',is_active:false,leads_network:false,member_count:0},
 {id:15,name:'Orphan Cell',network_id:null,gender:'boys',is_active:true,leads_network:false,member_count:1},
];
const ids=list=>list.map(r=>r.id).sort((a,b)=>a-b);

test('Active view shows only active Networks and their active Cells',()=>{
 const {networks:nets,cells}=filterTrackerView(networks,groups,{status:'active'});
 assert.deepEqual(ids(nets),[1,2]);
 assert.deepEqual(ids(cells),[10,13]);
});

test('All view keeps active and inactive records but still nests Cells under their Network',()=>{
 const {networks:nets,cells}=filterTrackerView(networks,groups,{status:'all'});
 assert.deepEqual(ids(nets),[1,2,3]);
 assert.deepEqual(ids(cells),[10,11,13,14]);
});

test('Inactive view lists a removed Cell Leader even when their Network is still active',()=>{
 const {networks:nets,cells}=filterTrackerView(networks,groups,{status:'inactive'});
 // Alpha is active but holds the removed Cell 11, so it must stay visible.
 assert.deepEqual(ids(nets),[1,3]);
 assert.deepEqual(ids(cells),[11,14]);
});

test('Inactive view never shows an active Cell or a Network Leader team Cell',()=>{
 const {cells}=filterTrackerView(networks,groups,{status:'inactive'});
 assert.equal(cells.some(g=>g.is_active!==false&&g.is_active!==0),false);
 assert.equal(cells.some(g=>g.leads_network),false);
});

test('gender filter applies to both Networks and Cells',()=>{
 const {networks:nets,cells}=filterTrackerView(networks,groups,{status:'all',gender:'girls'});
 assert.deepEqual(ids(nets),[2]);
 assert.deepEqual(ids(cells),[13]);
});

test('Cells without a Network are left to the Unassigned notice, not the directory',()=>{
 for(const status of ['active','all','inactive']){
  const {cells}=filterTrackerView(networks,groups,{status});
  assert.equal(cells.some(c=>c.id===15),false,status);
 }
});

test('the Lifegroups directory uses the shared view filter and marks removed Cells',()=>{
 assert.match(view,/import \{ findUnassignedGroups, filterTrackerView \} from '\.\/hierarchy\.js';/);
 const start=view.indexOf('const renderDirectory=()=>{');
 const stop=view.indexOf('function afterRemove()',start);
 const block=view.slice(start,stop);
 assert.match(block,/filterTrackerView\(cache\.nets,cache\.groups,filters\)/);
 assert.match(block,/badge--inactive/);
 // A removed Cell must not be a link at all, which would land on a page that
 // still renders the old roster as if it were active. The whole row is the tap
 // target for a live Cell; a removed one is plain text with a Removed badge.
 assert.match(block,/g\.is_active\s*\?\s*html`<a class="lifegroups-page__cell-row" href="#\/lifegroups\/\$\{g\.id\}"/);
 assert.match(block,/badge--inactive/);
});
