import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');

test('archive API rejects people with active Network or Cell leadership before state mutation',()=>{
 const route=api.slice(api.indexOf("app.post('/api/tracker/:method'"));
 const guard=route.indexOf("if(name==='archivePerson')");
 const domainCall=route.indexOf('runDomain(name,args,req.actor,write)');
 assert.ok(guard>=0&&guard<domainCall);
 assert.match(route,/FROM networks WHERE leader_person_id=\$1 AND is_active/);
 assert.match(route,/FROM lifegroups WHERE leader_person_id=\$1 AND is_active/);
 assert.match(route,/if\(active.network_leader\|\|active.cell_leader\)/);
 assert.match(route,/Reassign active Network and Cell leadership before archiving/);
});
