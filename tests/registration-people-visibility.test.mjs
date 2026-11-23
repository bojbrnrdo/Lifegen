import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const domain=readFileSync(new URL('../src/domain.js', import.meta.url),'utf8');
const view=readFileSync(new URL('../public/admin/js/views/people.js', import.meta.url),'utf8');
const publicApi=readFileSync(new URL('../src/public-api.js', import.meta.url),'utf8');
test('VIP registration creates the person and links by person ID in the transaction',()=>{
 assert.match(publicApi,/const p=await domain\.createPerson\(/);
 assert.match(publicApi,/INSERT INTO vip_registrations\(id,person_id,/);
 assert.match(publicApi,/\[id,p\.id,name,/);
});
test('People directory includes first timers by default and retains searchable status filters',()=>{
 assert.match(view,/status: query\.status \|\| 'active'/);
 assert.match(domain,/if \(status === 'active'\) rows = rows\.filter\(\(p\) => p\.status !== 'inactive'\)/);
 assert.match(view,/\['first_timer','First timers'\]/);
 assert.match(view,/api\.people\(\{ \.\.\.filters, paged: 1, limit: PAGE, offset \}\)/);
});
