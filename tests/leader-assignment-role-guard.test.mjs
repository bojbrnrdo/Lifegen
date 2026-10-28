import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/lifegroups.js',import.meta.url),'utf8');
test('member assignment rejects inherited leadership role for linked leaders',()=>{
 const start=src.indexOf('async function assignMember(');
 const end=src.indexOf('async function autoAssignMember(',start);
 const body=src.slice(start,end>start?end:undefined);
 assert.match(body,/leaderScope && \(current\?\.role && current\.role!=='member'\)/);
 assert.match(body,/leaderScope && \(group\.leader_person_id===personId \|\| networkLeadership\)/);
 assert.ok(body.indexOf('current.role!==\'member\'')<body.indexOf('const role = roleInput'));
});
