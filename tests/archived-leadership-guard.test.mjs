import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
test('archive leadership is checked inside persistence transaction before domain mutation',()=>{
 const route=source.slice(source.indexOf('export const runDomain='));
 const guard=route.indexOf("if(method==='archivePerson')");
 const call=route.indexOf('domain[method](...args)');
 assert.ok(guard>=0 && guard<call);
 assert.match(route,/SELECT id FROM people WHERE id=\$1 FOR UPDATE/);
 assert.match(route,/FROM networks WHERE leader_person_id=\$1 AND is_active/);
 assert.match(route,/FROM lifegroups WHERE leader_person_id=\$1 AND is_active/);
 assert.match(route,/if\(roles.network_leader\|\|roles.cell_leader\)/);
});
