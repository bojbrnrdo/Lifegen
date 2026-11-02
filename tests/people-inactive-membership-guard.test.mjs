import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/lifegroups.js',import.meta.url),'utf8');
const assignment=source.slice(source.indexOf("const person = (await client.query('SELECT id,first_name,last_name,person_code,sex,status,archived_at FROM people"),source.indexOf("const selectedSex = clean(extra.sex);"));
test('both manual and automatic Cell placements reject inactive People before membership mutations',()=>{
 const inactive=assignment.indexOf("if (person.status === 'inactive')");
 const auto=assignment.indexOf('if (extra.auto_assign)');
 assert.ok(inactive>=0 && auto>inactive);
 assert.match(assignment,/Reactivate this person before assigning them to a Cell/);
});
