import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eligibleVipAssignmentCell} from '../src/lifegroups.js';

const source=readFileSync(new URL('../src/lifegroups.js',import.meta.url),'utf8');
const group={id:4,is_active:true,is_demo:false,leader_person_id:4,gender:'boys'};
const network={id:4,is_active:true,is_demo:false,gender:'boys'};
const leader={id:4,archived_at:null,status:'leader'};

test('eligible active Cell, parent Network and leader pass together',()=>{
 assert.equal(eligibleVipAssignmentCell(group,network,leader),true);
});
test('invalid Cell, Network or leader fails closed',()=>{
 for(const changes of [{is_active:false},{is_demo:true},{leader_person_id:null}])
  assert.equal(eligibleVipAssignmentCell({...group,...changes},network,leader),false);
 for(const changes of [{is_active:false},{is_demo:true},{gender:'girls'}])
  assert.equal(eligibleVipAssignmentCell(group,{...network,...changes},leader),false);
 for(const changes of [{archived_at:'2026-10-01'},{status:'inactive'},{id:null}])
  assert.equal(eligibleVipAssignmentCell(group,network,{...leader,...changes}),false);
 assert.equal(eligibleVipAssignmentCell(group,null,leader),false);
 assert.equal(eligibleVipAssignmentCell(group,network,null),false);
});
test('transaction locks and validates parent Network and leader before assignment',()=>{
 const start=source.indexOf('async function assignMember(');
 const end=source.indexOf('async function ',start+20);
 const body=source.slice(start,end);
 assert.match(body,/SELECT id,is_active,gender,is_demo FROM networks WHERE id=\$1 FOR SHARE/);
 assert.match(body,/SELECT id,archived_at,status FROM people WHERE id=\$1 FOR SHARE/);
 assert.match(body,/eligibleVipAssignmentCell\(group,parentNetwork,activeLeader\)/);
});
