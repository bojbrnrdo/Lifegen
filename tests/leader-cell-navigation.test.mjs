import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const view=readFileSync(new URL('../public/admin/js/views/lifegroups.js',import.meta.url),'utf8');
test('linked Cell leaders do not get misleading parent-network navigation',()=>{
 assert.match(view,/import \{ can, isLinkedLeader \} from '\.\.\/app\.js'/);
 assert.match(view,/g\.network_id && !isLinkedLeader\(\) \? html`<a href="#\/networks\//);
});
