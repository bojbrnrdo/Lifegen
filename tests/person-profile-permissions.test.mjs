import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/admin/js/views/person.js',import.meta.url),'utf8');
test('archive/restore controls use people:delete and never offer hard delete',()=>{
 assert.match(source,/can\('people:delete'\) \? html`<button[^>]+id="archiveBtn"/);
 assert.match(source,/can\('people:delete'\) \? html` <button[^>]+id="restoreBtn"/);
 assert.doesNotMatch(source,/id="deleteBtn"|api\.deletePerson\(/);
});
test('status controls remain scoped to people:write',()=>{
 assert.match(source,/can\('people:write'\) \? html`<button[^>]+id="toggleActive"/);
});
