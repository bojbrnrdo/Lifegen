import test from 'node:test';
import assert from 'node:assert/strict';
import { hierarchyEasing, hierarchyCurve, buildLifegroupTree, arrangeLifegroupTree } from '../public/admin/js/views/hierarchy.js';

const leader = {id:1,name:'Alpha',leader_name:'Network Leader',gender:'boys',is_active:true};
const cells = [
 {id:10,name:'Joshua',network_id:1,leader_name:'Cell Leader 1',member_count:2,gender:'boys',is_active:true},
 {id:11,name:'Caleb',network_id:1,leader_name:'Cell Leader 2',member_count:1,gender:'boys',is_active:true}
];
const tree=(expanded=new Set(),members=new Map())=>
 buildLifegroupTree([leader],cells,{status:'active'},expanded,members,new Set());

test('easing starts at zero, finishes at one, and advances smoothly',()=>{
 assert.equal(hierarchyEasing(0),0);
 assert.equal(hierarchyEasing(1),1);
 assert.equal(hierarchyEasing(-5),0);
 assert.equal(hierarchyEasing(5),1);
 assert.ok(hierarchyEasing(.25)>.25);
 assert.ok(hierarchyEasing(.6)>hierarchyEasing(.4));
});

test('curved SVG connector joins parent node and child node',()=>{
 const p={x:100,y:90},c={x:365,y:280};
 const d=hierarchyCurve(p,c);
 assert.ok(d.startsWith('M100 165'));
 assert.ok(d.endsWith('365 251'));
 assert.match(d,/ C/);
});

test('only network leader is initially visible, and expanding reveals cells',()=>{
 const closed=arrangeLifegroupTree(tree());
 assert.equal(closed.nodes.length,1);
 assert.equal(closed.lines.length,0);
 const expanded=arrangeLifegroupTree(tree(new Set(['network:1'])));
 assert.equal(expanded.nodes.length,3);
 assert.equal(expanded.lines.length,2);
 assert.ok(expanded.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
 assert.equal(expanded.nodes.find(n=>n.key==='group:10').parentKey,'network:1');
 const root=expanded.nodes.find(n=>n.kind==='network');
 const groupOne=expanded.nodes.find(n=>n.key==='group:10');
 const groupTwo=expanded.nodes.find(n=>n.key==='group:11');
 assert.ok(root.y<groupOne.y,'Network Leader must be above Cell Leaders');
 assert.equal(groupOne.y,groupTwo.y,'Cell Leaders must share a row');
 assert.ok(groupOne.x<root.x&&root.x<groupTwo.x,'Network Leader centers above both cells');
});

test('expanding a cell adds third-level members with correct ancestry',()=>{
 const members=new Map([['group:10',[
  {id:50,full_name:'Example Attendee',status:'regular',role:'member'},
  {id:51,full_name:'Example Assistant',status:'member',role:'assistant'}
 ]]]);
 const expanded=arrangeLifegroupTree(tree(new Set(['network:1','group:10']),members));
 assert.equal(expanded.nodes.length,5);
 assert.equal(expanded.lines.length,4);
 assert.equal(expanded.nodes.find(n=>n.key==='person:50').parentKey,'group:10');
 const cell=expanded.nodes.find(n=>n.key==='group:10');
 const member=expanded.nodes.find(n=>n.key==='person:50');
 assert.ok(member.y>cell.y,'Members must appear below their Cell Leader');
});

test('collapsed branch resets to network-only layout without data mutation',()=>{
 const original=structuredClone(cells);
 const closed=arrangeLifegroupTree(tree());
 assert.equal(closed.nodes.length,1);
 assert.deepEqual(cells,original);
});

test('multiple Network Leaders stay top-aligned and have non-overlapping horizontal positions',()=>{
 const first=tree();
 const second=structuredClone(first[0]);
 second.key='network:2';second.name='Another Network Leader';
 const layout=arrangeLifegroupTree([...first,second]);
 assert.equal(layout.nodes.length,2);
 assert.equal(layout.nodes[0].y,layout.nodes[1].y);
 assert.ok(Math.abs(layout.nodes[0].x-layout.nodes[1].x)>=200);
});
