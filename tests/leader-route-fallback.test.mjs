import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
test('unknown routes for linked leaders fall back to scoped directory',()=>{
 assert.match(source,/if \(!match\) \{ location\.replace\(isLinkedLeader\(\)\?'#\/lifegroups':'#\/dashboard'\); return; \}/);
});
test('restricted-page recovery link does not return linked leaders to dashboard',()=>{
 assert.match(source,/isLinkedLeader\(\)\?'Back to My Lifegroups':'Back to dashboard'/);
});
