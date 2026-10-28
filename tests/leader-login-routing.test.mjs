import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
test('linked non-admin accounts land on scoped Lifegroups instead of unscoped dashboard',()=>{
 assert.match(app,/state\.user\.person_id && state\.user\.role_id!=='admin' && \(!location\.hash \|\| location\.hash==='#\/dashboard'\)/);
 assert.match(app,/history\.replaceState\(null,'',location\.pathname\+location\.search\+'#\/lifegroups'\)/);
});
test('direct dashboard navigation by linked leaders redirects to scoped view',()=>{
 assert.match(app,/state\.user\?\.person_id && state\.user\.role_id!=='admin' && hashPath==='\/dashboard'/);
 assert.match(app,/location\.replace\('#\/lifegroups'\);return/);
});
