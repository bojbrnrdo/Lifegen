import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNotLeaderMembership} from '../src/leader-member-guard.js';
const mock=(leads,role='member')=>({query:async(sql)=>({rows:sql.includes('leads_structure')?[{leads_structure:leads}]:[{role}]})});
test('ordinary membership can be changed',async()=>assert.doesNotReject(assertNotLeaderMembership(mock(false),5,10)));
test('network or Cell leadership cannot be removed or reclassified by linked staff',async()=>assert.rejects(assertNotLeaderMembership(mock(true),5,10),{status:403}));
test('leader or assistant membership is protected',async()=>{
 for(const role of ['leader','assistant'])await assert.rejects(assertNotLeaderMembership(mock(false,role),5,10),{status:403});
});
