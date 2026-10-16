import test from 'node:test';
import assert from 'node:assert/strict';
import {domain,domainContext} from '../src/domain.js';

test('deletePerson rejects destructive deletion and leaves records untouched',async()=>{
 const data={people:[{id:10,first_name:'Test',last_name:'Person'}],records:[{id:2,person_id:10}],audit:[{id:3,person_id:10}]};
 const state={data,dirty:false};
 await domainContext.run(state,async()=>{
  await assert.rejects(domain.deletePerson(10),err=>err.status===409 && /Archive/.test(err.message));
  assert.equal(data.people.length,1);
  assert.equal(data.records.length,1);
  assert.equal(data.audit.length,1);
  assert.equal(state.dirty,false);
  await assert.rejects(domain.deletePerson(404),err=>err.status===404);
 });
});
