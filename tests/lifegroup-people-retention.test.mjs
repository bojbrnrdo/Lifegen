import test from 'node:test';
import assert from 'node:assert/strict';
import {domain,domainContext} from '../src/domain.js';
import {flushState} from '../src/db.js';

test('hard deletion rejects and retains People and attendance history',async()=>{
 const data={people:[{id:15,first_name:'Test',last_name:'Person'}],records:[{id:2,person_id:15}],audit:[{id:3,person_id:15}]};
 const state={data,dirty:false};
 await domainContext.run(state,async()=>{
  await assert.rejects(domain.deletePerson(15),err=>err.status===409);
  assert.equal(data.people.length,1);
  assert.equal(data.records.length,1);
  assert.equal(data.audit.length,1);
 });
});

test('state sync rejects deleting a person before any SQL',async()=>{
 const before={people:[{id:15}],records:[],audit:[],services:[]};
 const after={people:[],records:[],audit:[],services:[]};
 let queries=0;
 await assert.rejects(flushState({query:async()=>{queries++;}},before,after,null),err=>err.status===409);
 assert.equal(queries,0);
});
