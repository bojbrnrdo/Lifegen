import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { validateNetworkStructureInput, NETWORK_CELL_LEADER_LIMIT, CELL_MEMBER_LIMIT } from '../src/lifegroups.js';

const reader=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const ui=reader('../public/admin/js/views/networkFourField.js');
const parent=reader('../public/admin/js/views/lifegroups.js');
const app=reader('../src/app.js');
const api=reader('../public/admin/js/api.js');
const backend=reader('../src/lifegroups.js');

const sample=(leaders,membersPerLeader)=>({
 gender:'boys',leader_person_id:1,
 cell_leaders:Array.from({length:leaders},(_,i)=>({
  person_id:i+2,
  members:Array.from({length:membersPerLeader},(_,k)=>1000+i*12+k)
 }))
});

test('both role capacities are exactly twelve',()=>{
 assert.equal(NETWORK_CELL_LEADER_LIMIT,12);
 assert.equal(CELL_MEMBER_LIMIT,12);
 const twelve=validateNetworkStructureInput(sample(12,12));
 assert.equal(twelve.cell_leaders.length,12);
 assert.equal(twelve.cell_leaders[11].members.length,12);
 assert.equal(twelve.person_ids.length,157);
});

test('server rejects a thirteenth Cell Leader',()=>{
 assert.throws(()=>validateNetworkStructureInput(sample(13,0)),/up to 12 Cell Leaders/);
});

test('server rejects a thirteenth Member under one Cell Leader',()=>{
 assert.throws(()=>validateNetworkStructureInput(sample(1,13)),/up to 12 Members/);
});

test('a person cannot be a Network Leader, Cell Leader, or Member twice',()=>{
 const dup=sample(1,1);
 dup.cell_leaders[0].members=[1];
 assert.throws(()=>validateNetworkStructureInput(dup),/only once/);
 dup.cell_leaders[0].members=[2];
 assert.throws(()=>validateNetworkStructureInput(dup),/only once/);
 dup.cell_leaders[0].members=[88,88];
 assert.throws(()=>validateNetworkStructureInput(dup),/only once/);
});

test('invalid IDs, gender, or malformed roles fail before a write',()=>{
 assert.throws(()=>validateNetworkStructureInput({...sample(0,0),gender:'any'}),/Select a gender/);
 assert.throws(()=>validateNetworkStructureInput({...sample(0,0),leader_person_id:0}),/Invalid Network Leader/);
 assert.throws(()=>validateNetworkStructureInput({...sample(0,0),cell_leaders:'many'}),/up to 12/);
 assert.throws(()=>validateNetworkStructureInput({...sample(1,1),cell_leaders:[{person_id:2,members:'x'}]}),/up to 12/);
});

test('new Network form contains exactly four visible sections and no Network name',()=>{
 for(const name of ['Network Leader','Gender','Cell Leader','Member'])assert.match(ui,new RegExp(name));
 assert.doesNotMatch(ui,/name="name"/);
 assert.match(ui,/api\.createNetworkStructure\(payload\)/);
 assert.match(ui,/id="netFourError"/);
 assert.match(ui,/state\.cells\.length>=LIMIT/);
 assert.match(ui,/cell\.members\.length<LIMIT/);
 assert.match(parent,/if \(!n\) return createFourFieldNetwork/);
});

test('atomic operation has an authenticated permission gate and no partial network writes',()=>{
 assert.match(app,/createNetworkStructure:\['lifegroups:manage',true\]/);
 assert.match(api,/'createNetworkStructure'/);
 assert.match(backend,/return transaction\(async client =>/);
 assert.match(backend,/createNetworkStructure\(args\[0\] \|\| \{\},actor\)/);
 assert.match(backend,/Network has reached its 12 Cell Leader limit/);
 assert.match(backend,/Cell Leader has reached the 12-member limit/);
 assert.match(backend,/SELECT id,first_name,last_name,sex,archived_at FROM people WHERE id=ANY/);
});
