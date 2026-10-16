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
