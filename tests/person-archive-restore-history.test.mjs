import test from 'node:test';
import assert from 'node:assert/strict';
import {domain,domainContext} from '../src/domain.js';

test('archive and restore preserve People attendance and audit history',async()=>{
 const person={id:10,first_name:'Test',last_name:'Person',archived_at:null};
 const data={
  people:[person],
  services:[{id:2,service_date:'2026-10-11'}],
  records:[{id:3,service_id:2,person_id:10,status:'present'}],
  audit:[{id:4,person_id:10}]
 };
 const state={data,dirty:false};
 await domainContext.run(state,async()=>{
  const archived=await domain.archivePerson(10);
  assert.ok(archived.archived_at);
  assert.equal(archived.sundays_attended,1);
  assert.equal(data.records.length,1);
  assert.equal(data.audit.length,1);
  assert.equal(state.dirty,true);
  state.dirty=false;
  const restored=await domain.restorePerson(10);
  assert.equal(restored.archived_at,null);
  assert.equal(restored.sundays_attended,1);
  assert.equal(data.records.length,1);
  assert.equal(data.audit.length,1);
  assert.equal(state.dirty,true);
 });
});

test('repeated archive and restore do not mutate records or audit history',async()=>{
 const data={people:[{id:11,first_name:'Synthetic',last_name:'Person',archived_at:null}],services:[],records:[{id:5,person_id:11}],audit:[{id:6,person_id:11}]};
 const state={data,dirty:false};
 await domainContext.run(state,async()=>{
  await domain.archivePerson(11);
  state.dirty=false;
  const archivedAt=data.people[0].archived_at;
  await domain.archivePerson(11);
  assert.equal(data.people[0].archived_at,archivedAt);
  assert.equal(state.dirty,false);
  await domain.restorePerson(11);
  state.dirty=false;
  await domain.restorePerson(11);
  assert.equal(state.dirty,false);
  assert.equal(data.records.length,1);
  assert.equal(data.audit.length,1);
 });
});
