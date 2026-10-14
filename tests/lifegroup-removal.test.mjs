import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const server=read('../src/lifegroups.js');
const app=read('../src/app.js');
const api=read('../public/admin/js/api.js');
const view=read('../public/admin/js/views/lifegroups.js');
const graph=read('../public/admin/js/views/hierarchy.js');
const dialog=read('../public/admin/js/views/removeFromLifegroups.js');
const css=read('../public/admin/styles.css');

function execute(name,end,queryHandler) {
 const start=server.indexOf('async function '+name+'(');
 const stop=server.indexOf(end,start+25);
 assert.ok(start>=0&&stop>start,'Could not isolate '+name);
 const actions=[],sql=[];
 const client={query:async (text,args)=>{sql.push({text,args});return queryHandler(text,args)}};
 const context={
   transaction:async fn=>fn(client),
   logAction:async(_client,actor,entity,id,action,detail)=>actions.push({entity,id,action,detail}),
   today:()=> '2026-10-14',
   httpError:(status,message)=>Object.assign(new Error(message),{status}),
   Number,
 };
 const fn=runInNewContext('('+server.slice(start,stop).trim()+')',context);
 return {fn,sql,actions};
}

test('three history-preserving API methods are permission-gated mutations',()=>{
 for(const name of ['removeNetworkFromTree','removeCellLeaderFromTree','removeMemberFromTree']){
   assert.ok(app.includes(name+":['lifegroups:manage',true]"));
   assert.ok(api.includes("'"+name+"'"));
   assert.match(server,new RegExp("if \\(name === '"+name+"'\\) return "+name+"\\("));
 }
 assert.doesNotMatch(server.slice(server.indexOf('async function removeNetworkFromTree('),server.indexOf('async function meetingRows(')),/DELETE FROM (networks|lifegroups|people|lifegroup_memberships|records)/);
});

test('removing a Network deactivates it, deactivates its Cells, ends active memberships, and audits the change',async()=>{
 const {fn,sql,actions}=execute('removeNetworkFromTree','async function removeCellLeaderFromTree',
  (stmt,args)=>{
   if(stmt.startsWith('SELECT id,name,is_active FROM networks'))return {rows:[{id:11,name:'Sample Network',is_active:true}]};
   if(stmt.startsWith('SELECT id FROM lifegroups'))return {rows:[{id:21},{id:22}]};
   if(stmt.startsWith('UPDATE lifegroup_memberships'))return {rows:[{id:101},{id:102},{id:103}]};
   return {rows:[]};
  });
 const result=await fn(11,{id:5});
 assert.equal(result.archived_groups,2);
 assert.equal(result.ended_memberships,3);
 assert.deepEqual(JSON.parse(JSON.stringify(sql.find(x=>x.text.startsWith('UPDATE lifegroup_memberships')).args[0])),[21,22]);
 assert.ok(sql.some(x=>x.text.includes('UPDATE lifegroups SET is_active=false')));
 assert.ok(sql.some(x=>x.text.includes('UPDATE networks SET is_active=false')));
 assert.ok(sql.some(x=>x.text.includes('GREATEST(joined_at,$2::date)')));
 assert.equal(actions[0].action,'remove_from_tree');
 assert.equal(actions[0].detail.retained_history,true);
});

test('removing a Network already archived does not modify memberships',async()=>{
 const {fn,sql}=execute('removeNetworkFromTree','async function removeCellLeaderFromTree',
  ()=>({rows:[{id:11,name:'Old',is_active:false}]}));
 await assert.rejects(()=>fn(11,null),e=>e.status===409);
 assert.equal(sql.length,1);
});

test('removing a Cell Leader archives the Cell and disconnects its parent-team assignment',async()=>{
 const {fn,sql,actions}=execute('removeCellLeaderFromTree','async function removeMemberFromTree',
  stmt=>{
   if(stmt.startsWith('SELECT id,name,network_id,leader_person_id,is_active FROM lifegroups'))
      return {rows:[{id:20,name:'Cell',network_id:2,leader_person_id:40,is_active:true}]};
   if(stmt.startsWith('SELECT id,leader_person_id FROM networks'))
      return {rows:[{id:2,leader_person_id:35}]};
   if(stmt.startsWith('UPDATE lifegroup_memberships SET'))return {rows:[{id:81},{id:82}]};
   if(stmt.includes('UPDATE lifegroup_memberships m'))return {rows:[{id:83}]};
   return {rows:[]};
  });
 const out=await fn(20,{id:5});
 assert.equal(out.ended_memberships,2);
 assert.equal(out.ended_leader_links,1);
 assert.ok(sql.some(x=>x.text.includes('UPDATE lifegroups SET is_active=false')));
 assert.ok(sql.some(x=>x.text.includes('other.id<>$5 AND other.is_active')));
 assert.equal(actions[0].detail.retained_history,true);
});

test('Network Leader parent team is protected from Cell Leader removal',async()=>{
 const {fn,sql}=execute('removeCellLeaderFromTree','async function removeMemberFromTree',
  stmt=>{
   if(stmt.startsWith('SELECT id,name,network_id,leader_person_id,is_active FROM lifegroups'))
     return {rows:[{id:20,name:'Leader Team',network_id:2,leader_person_id:35,is_active:true}]};
   if(stmt.startsWith('SELECT id,leader_person_id FROM networks'))
     return {rows:[{id:2,leader_person_id:35}]};
   return {rows:[]};
  });
 await assert.rejects(()=>fn(20,null),e=>e.status===409&&/Network Leader/.test(e.message));
 assert.ok(!sql.some(x=>x.text.trim().startsWith('UPDATE')));
});

test('removing a Member ends only the selected active Cell assignment',async()=>{
 const {fn,sql,actions}=execute('removeMemberFromTree','async function meetingRows',
  stmt=>{
   if(stmt.startsWith('SELECT g.id,g.name,g.leader_person_id,g.is_active'))
     return {rows:[{id:20,name:'Cell',leader_person_id:40,is_active:true,network_id:2}]};
   if(stmt.startsWith('SELECT leader_person_id FROM networks'))
     return {rows:[{leader_person_id:35}]};
   if(stmt.includes('SELECT m.id,m.joined_at'))return {rows:[{id:100,joined_at:'2026-10-01'}]};
   return {rows:[]};
  });
 const out=await fn(20,42,{id:5});
 assert.equal(out.person_id,42);
 assert.ok(sql.some(x=>x.text.startsWith('UPDATE lifegroup_memberships SET left_at=')));
 assert.ok(!sql.some(x=>x.text.includes('UPDATE lifegroups SET')));
 assert.equal(actions[0].action,'leave');
 assert.equal(actions[0].detail.retained_history,true);
});

test('Lifegroups displays Remove alongside Add New; tree and detail pages also offer contextual actions',()=>{
 assert.match(view,/id="addNew"/);
 assert.match(view,/id="removeFromLifegroups"/);
 assert.match(view,/openRemoveFromLifegroups/);
 assert.match(view,/id="removeCellLeader"/);
 assert.match(view,/id="removeNetwork"/);
 assert.match(view,/onRemoved:afterRemove/);
 assert.match(view,/__lifegenTree\?\.members\.clear\(\)/);
 assert.match(view,/onRemove:can\('lifegroups:manage'\)\?/);
 assert.match(graph,/typeof options\.onRemove==='function'/);
 assert.match(graph,/data-remove-node/);
 assert.match(graph,/aria-label="Interactive Lifegroup network/);
 assert.match(graph,/profileAvatar\(n\)/);
});

test('removal dialog offers a three-tab, cascading selector with strong confirmation and safe output',()=>{
 assert.match(dialog,/role="tabpanel"/);
 assert.match(dialog,/const labels=\{network:'Network',cell:'Cell Leader',member:'Member'\}/);
 assert.match(dialog,/role="tablist"/);
 assert.match(dialog,/api\.networks\(\{status:'active'\}\)/);
 assert.match(dialog,/api\.lifegroups\(\{status:'active'\}\)/);
 assert.match(dialog,/api\.lifegroup\(id\)/);
 assert.match(dialog,/api\.removeNetworkFromTree\(network\.id\)/);
 assert.match(dialog,/api\.removeCellLeaderFromTree\(group\.id\)/);
 assert.match(dialog,/api\.removeMemberFromTree\(group\.id,member\)/);
 assert.match(dialog,/confirmWord:mode==='network'\?'REMOVE':undefined/);
 assert.match(dialog,/cancel or failure/);
 assert.match(dialog,/escapeHTML\(target\)/);
 assert.match(dialog,/Unassigned Cells \(no Network yet\)/);
 assert.match(css,/\.lf-remove__tabs/);
 assert.match(css,/@media\(max-width:620px\)/);
});
