import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/domain.js',import.meta.url),'utf8');
const archive=source.slice(source.indexOf('  archivePerson:'),source.indexOf('  restorePerson:'));
test('archiving a People record refuses active Network or Cell leadership before mutation',()=>{
 assert.match(archive,/d\.networks\.some\(n => Number\(n\.leader_person_id\) === p\.id && Boolean\(n\.is_active\)\)/);
 assert.match(archive,/d\.lifegroups\.some\(g => Number\(g\.leader_person_id\) === p\.id && Boolean\(g\.is_active\)\)/);
 assert.match(archive,/throw httpError\(409,/);
 assert.ok(archive.indexOf('throw httpError(409') < archive.indexOf('p.archived_at = nowSql()'));
});
