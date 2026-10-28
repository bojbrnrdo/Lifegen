import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lifegroups.js', import.meta.url), 'utf8');
const networkBlock = source.slice(source.indexOf('async function listNetworks('), source.indexOf('async function activeMembers('));

test('Network people, boys, and girls totals count unique Person IDs, not membership rows', () => {
 const statements = [...networkBlock.matchAll(/SELECT count\(DISTINCT m\.person_id\)::int FROM lifegroup_memberships m JOIN lifegroups g ON g\.id=m\.lifegroup_id JOIN people p ON p\.id=m\.person_id/g)];
 assert.equal(statements.length, 3);
});
test('Network unique People counts are restricted to their own active Cells and nonarchived active memberships', () => {
 for (const fragment of networkBlock.match(/\(SELECT count\(DISTINCT m\.person_id\)::int[^)]*\)/g) || []) {
  assert.match(fragment, /g\.network_id=n\.id/);
  assert.match(fragment, /m\.left_at IS NULL/);
  assert.match(fragment, /p\.archived_at IS NULL/);
 }
});
