import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('./lifegroup-integration.mjs',import.meta.url),'utf8');
const plan=readFileSync(new URL('../docs/linked-leader-integration-checklist.md',import.meta.url),'utf8');
test('integration harness rejects remote connection and direct database targets',()=>{
 assert.match(script,/LIFEGEN_INTEGRATION_DATABASE_URL must be local/);
 assert.match(script,/LIFEGEN_INTEGRATION_DIRECT_URL must be local/);
 assert.match(script,/localhost.*127\.0\.0\.1/);
});
test('leader release gate explicitly requires isolated sign-in and scope checks',()=>{
 for(const item of ['isolated','Network Leader','Cell Leader','Direct API','mobile','physical iPhone/Android touch-device verification'])
  assert.ok(plan.toLowerCase().includes(item.toLowerCase()),item);
});
