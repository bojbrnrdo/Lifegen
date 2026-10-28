import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const view=readFileSync(new URL('../public/admin/js/views/person.js',import.meta.url),'utf8');
test('linked leader profile back link returns to scoped directory',()=>{
 assert.match(view,/import \{ can, isLinkedLeader \} from '\.\.\/app\.js'/);
 assert.match(view,/isLinkedLeader\(\)\?'#\/lifegroups':'#\/people'/);
 assert.match(view,/isLinkedLeader\(\)\?'My Lifegroups':'People'/);
});
