import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {leaderHierarchyProblem, validateNetworkInput} from '../src/lifegroups.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const view=read('../public/admin/js/views/lifegroups.js');
const addNew=read('../public/admin/js/views/unifiedAddNew.js');
const db=read('../src/db.js');
const server=read('../src/lifegroups.js');

// Bishop / Pastora -> Network Leaders -> Cell Leaders -> Members -> VIP
test('a Network Leader may be a member of their pastor’s cell',()=>{
  const problem=leaderHierarchyProblem({
    networks:[{id:1}],
    cells:[{id:10,network_id:1}],
    memberships:[{role:'member',lifegroup_id:99}], // 99 = the pastor's own cell
  });
  assert.equal(problem,null,'being a plain member elsewhere is the whole point');
});

test('a Network Leader still cannot lead a Cell outside their Network',()=>{
  const problem=leaderHierarchyProblem({
    networks:[{id:1}],
    cells:[{id:10,network_id:1}],
    memberships:[{role:'leader',lifegroup_id:99}],
  });
  assert.match(problem,/lead only Cells inside their own Network/);
});

test('a Network Leader’s Cells must sit in their own Network',()=>{
  const problem=leaderHierarchyProblem({networks:[{id:1}],cells:[{id:10,network_id:2}],memberships:[]});
  assert.match(problem,/must belong to their own Network/);
});

test('a Cell Leader with no Network is not treated as misplaced',()=>{
  assert.equal(leaderHierarchyProblem({networks:[],cells:[{id:10,network_id:5}],memberships:[{role:'leader',lifegroup_id:10}]}),null);
});

test('Networks nest exactly one level under a pastor',()=>{
  const under=validateNetworkInput({name:'Roxxane Network',gender:'boys',parent_network_id:7},null,null);
  assert.equal(under.parent_network_id,7);
  const flat=validateNetworkInput({name:'Standalone',gender:'girls'},null,null);
  assert.equal(flat.parent_network_id,null);
  assert.throws(()=>validateNetworkInput({name:'Self',gender:'boys',parent_network_id:4},null,4),/cannot be under itself/);
});

test('the server refuses a grandchild Network',()=>{
  assert.match(server,/Only a pastor can hold other Networks/);
});

test('the directory puts pastors first and names the level in plain words',()=>{
  assert.match(view,/const isPastor = n =>/);
  assert.match(view,/Bishop/);
  assert.match(view,/Pastora/);
  assert.match(view,/lifegroups-page__pastor-card/);
  assert.match(view,/Who leads whom/);
  // A pastor card lists Network Leaders as tappable rows, each opening its Network.
  assert.match(view,/const networkRow = \(n, extra = ''\) =>/);
  assert.match(view,/href="#\/networks\/\$\{n\.id\}"/);
});

test('a pastor’s page lists the Network Leaders under them',()=>{
  assert.match(view,/Network Leaders under \$\{n\.leader_name \|\| 'this pastor'\}/);
  assert.match(server,/const child_networks = networks\.filter/);
  assert.match(server,/child_networks,/);
});

test('Add New can start a pastor Network as the top level',()=>{
  assert.match(addNew,/const modes=\['pastor','network','cell','member','vip'\]/);
  assert.match(addNew,/pastor:'Start a pastor Network'/);
  assert.match(addNew,/gender==='girls'\?'pastora':'bishop'/);
  assert.match(addNew,/await api\.ensureNetworkLeaderGroup\(result\.id\)/);
  assert.match(addNew,/Under which pastor\?/);
});

test('the pastor level is a real column in the database',()=>{
  const sql=read('../database/016_network_parent.sql');
  assert.match(sql,/ADD COLUMN IF NOT EXISTS parent_network_id bigint REFERENCES networks\(id\)/);
  assert.match(sql,/networks_not_own_parent/);
});
