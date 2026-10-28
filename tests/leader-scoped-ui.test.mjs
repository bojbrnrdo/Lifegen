import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
const view=fs.readFileSync(new URL('../public/admin/js/views/lifegroups.js',import.meta.url),'utf8');
test('linked staff management buttons hidden without changing admin grants',()=>{
 assert.match(app,/state\.user\?\.person_id && state\.user\.role_id!=='admin'/);
 assert.match(app,/\['people:write','people:delete','lifegroups:manage','attendance:view'/);
});
test('linked leaders use their scoped directory rather than unrestricted map endpoints',()=>{
 assert.match(view,/const leader=await api\.leaderScope\(\)/);
 assert.match(view,/const people=leader\.kind==='unassigned'\?\[\]:await api\.people/);
 assert.match(view,/Only members in your assigned active Cells/);
});
