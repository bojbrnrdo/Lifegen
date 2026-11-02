import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLinkedPersonId,assertLinkablePerson} from '../src/leader-account-link.js';

test('accepts valid linked identity and explicit unlink',()=>{
 assert.equal(normalizeLinkedPersonId(7),7);
 assert.equal(normalizeLinkedPersonId('7'),7);
 assert.equal(normalizeLinkedPersonId(null),null);
 assert.equal(normalizeLinkedPersonId(''),null);
 assert.equal(normalizeLinkedPersonId(undefined),undefined);
});
test('rejects malformed, negative and unsafe identifiers',()=>{
 for(const v of ['1.2',-1,0,'1abc','01',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>normalizeLinkedPersonId(v));
});
test('rejects nonexistent and archived People records',async()=>{
 const client={query:async()=>({rows:[]})};
 await assert.rejects(assertLinkablePerson(client,2),{status:409});
 client.query=async()=>({rows:[{id:2,archived_at:'2026-01-01'}]});
 await assert.rejects(assertLinkablePerson(client,2),{status:409});
});
test('prevents linking a person to a second account',async()=>{
 const client={query:async(sql)=>({rows:sql.includes('FROM people')?[{id:2,archived_at:null}]:[{id:9}]})};
 await assert.rejects(assertLinkablePerson(client,2,1),{status:409});
});
test('permits an unlinked active person',async()=>{
 const client={query:async(sql)=>({rows:sql.includes('FROM people')?[{id:2,archived_at:null}]:[]})};
 await assert.doesNotReject(assertLinkablePerson(client,2));
});
