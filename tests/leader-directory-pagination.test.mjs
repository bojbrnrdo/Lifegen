import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../public/admin/js/views/lifegroups.js',import.meta.url),'utf8');
test('leader directory requests paged scoped results rather than silently truncating after 2000',()=>{
 assert.match(ui,/paged:1,limit:perPage,offset:\(page-1\)\*perPage/);
 assert.match(ui,/const people=listing\.rows/);
 assert.match(ui,/My People \(\$\{listing\.total\}\)/);
});
test('leader directory has previous and next navigation',()=>{
 assert.match(ui,/#\/lifegroups\?page=\$\{page-1\}/);
 assert.match(ui,/#\/lifegroups\?page=\$\{page\+1\}/);
});
