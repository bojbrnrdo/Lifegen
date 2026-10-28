import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
test('linked leader navigation hides non-scoped pages and points brand home to Lifegroups',()=>{
 assert.match(src,/export const isLinkedLeader/);
 assert.match(src,/isLinkedLeader\(\)\?'':navLink\('#\/dashboard'/);
 assert.match(src,/isLinkedLeader\(\)\?'':navLink\('#\/calendar'/);
 assert.match(src,/isLinkedLeader\(\)\?'':navLink\('#\/settings'/);
 assert.match(src,/isLinkedLeader\(\)\?'#\/lifegroups':'#\/dashboard'/);
});
test('direct linked leader navigation stays within People and Lifegroups routes',()=>{
 assert.match(src,/isLinkedLeader\(\) && !\['lifegroups','people'\]\.includes\(r\.nav\)/);
 assert.match(src,/\['people:write','people:delete','lifegroups:manage','attendance:view'/);
});
