import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLifegroupTree, arrangeLifegroupTree } from '../public/admin/js/views/hierarchy.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const view = read('../public/admin/js/views/lifegroups.js');
const detail = read('../public/admin/js/views/networkDetailUI.js');
const nav = read('../public/admin/js/app.js');
const treeSource = read('../public/admin/js/views/hierarchy.js');
const network = {id: 1, name:'Network A', leader_name:'Network Leader', leader_person_id:10, gender:'boys', is_active:true};
const group = {id:21, name:'Hidden backend cell record', leader_name:'Cell Leader', leader_person_id:11, network_id:1, gender:'boys', is_active:true, member_count:2};
const expanded = new Set(['network:1','group:21']);
const members = new Map([['group:21',[
 {id:31,first_name:'A',last_name:'Member',role:'member',status:'regular'},
 {id:32,first_name:'B',last_name:'Member',role:'member',status:'member'},
]]]);

test('hierarchy is strictly Network Leader → Cell Leader → Member, with no extra Lifegroup node',()=>{
 const roots=buildLifegroupTree([network],[group],{},expanded,members,new Set());
 assert.equal(roots.length,1);
 assert.equal(roots[0].name,'Network Leader');
 assert.equal(roots[0].children.length,1);
 const cell=roots[0].children[0];
 assert.equal(cell.name,'Cell Leader');
 assert.equal(cell.subtitle,'Cell Leader');
 assert.equal(cell.children.length,2);
 assert.ok(cell.children.every(p=>p.kind==='member' && p.children.length===0));
 assert.equal(arrangeLifegroupTree(roots).nodes.length,4);
 assert.ok(!JSON.stringify(roots).includes('kind:"lifegroup"'));
});

test('network starts collapsed; expands Cell Leaders and then Members only on click',()=>{
 const initial=buildLifegroupTree([network],[group],{},new Set(),new Map(),new Set());
 assert.equal(initial[0].children.length,0);
 const first=buildLifegroupTree([network],[group],{},new Set(['network:1']),members,new Set());
 assert.equal(first[0].children.length,1);
 assert.equal(first[0].children[0].children.length,0);
 const complete=buildLifegroupTree([network],[group],{},expanded,members,new Set());
 assert.equal(complete[0].children[0].children.length,2);
});

test('no separate Lifegroup title appears in the interactive diagram',()=>{
 assert.match(treeSource,/Network Leader → Cell Leader → Member/);
 assert.match(treeSource,/subtitle:'Cell Leader'/);
 assert.doesNotMatch(treeSource,/subtitle:g\.name\|\|'Lifegroup'/);
});

test('new Cell Leader creation links a registered person to the Network',()=>{
 const start=view.indexOf('async function groupForm(');
 const end=view.indexOf('export async function findLifegroup(',start);
 const form=view.slice(start,end);
 assert.match(form,/title: g \? 'Edit Cell Leader' : 'Add Cell Leader'/);
 assert.match(form,/type="hidden" name="name"/);
 assert.doesNotMatch(form,/<label>Group name/);
 assert.match(form,/name="network_id" required/);
 assert.match(form,/if \(!d\.network_id \|\| !d\.gender \|\| !d\.leader_person_id\)/);
 assert.match(form,/d\.name = \(modal\.querySelector\('#leaderPick'\)/);
 assert.match(form,/api\.createLifegroup\(d\)/);
});

test('navigation and actions show Cell Leaders and Members without a separate group step',()=>{
 assert.match(nav,/'Discipleship Tree'/);
 assert.match(view,/id="newGroup"[^\n]+Add Cell Leader/);
 assert.match(detail,/quickButton\('netCreateGroup', 'Add Cell Leader'/);
 assert.match(detail,/Add member/);
 assert.doesNotMatch(detail,/Add Lifegroup/);
 assert.match(detail,/Meetings this week/);
});

test('existing database operations and history are retained',()=>{
 assert.match(view,/api\.updateLifegroup\(g\.id, d\)/);
 assert.match(view,/api\.assignLifegroup\(g\.id, pid/);
 assert.match(view,/renderNetworkCalendar\(/);
 assert.match(view,/api\.setTier\(/);
 assert.match(view,/#\/lifegroups\/\$\{g\.id\}/);
});
