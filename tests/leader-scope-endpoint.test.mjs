import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../public/admin/js/api.js',import.meta.url),'utf8');
test('leader scope is a server-derived read-only tracker operation',()=>{
 assert.match(app,/leaderScope:\['lifegroups:view',false\]/);
 assert.match(app,/if\(name==='leaderScope'\)return res\.json\(await resolveLeaderScope\(\{query\},req\.actor\)\)/);
 assert.match(api,/const methods=\['leaderScope','people'/);
});
test('leader scope is handled ahead of linked leader deny-by-default guard',()=>{
 const scope=app.indexOf("if(name==='leaderScope')return res.json");
 const guard=app.indexOf('await authorizeLinkedLeaderTrackerMethod');
 assert.ok(scope>0&&guard>scope);
});
