import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');

test('People mutations preserve server-side permission separation',()=>{
 for(const method of ['archivePerson','restorePerson','deletePerson'])
  assert.match(server,new RegExp(method+":\\['people:delete',true\\]"));
 for(const method of ['createPerson','updatePerson','setPersonStatus'])
  assert.match(server,new RegExp(method+":\\['people:write',true\\]"));
});
