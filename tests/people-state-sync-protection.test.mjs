import test from 'node:test';
import assert from 'node:assert/strict';
import {flushState} from '../src/db.js';

test('state sync fails closed before issuing SQL for a missing People row',async()=>{
 const people=[{id:7,first_name:'Retain'}];
 const before={people,records:[],audit:[],services:[]};
 const after={people:[],records:[],audit:[],services:[]};
 const sql=[];
 const client={query:async(...args)=>{sql.push(args);return {rows:[]};}};
 await assert.rejects(flushState(client,before,after,null),err=>err.status===409 && /Archive/.test(err.message));
 assert.equal(sql.length,0);
});
