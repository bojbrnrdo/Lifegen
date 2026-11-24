import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lifegroups.js', import.meta.url), 'utf8');
const networkBlock = source.slice(source.indexOf('async function listNetworks('), source.indexOf('async function activeMembers('));

test('Network listing remains readable before the optional parent-network migration is applied', () => {
 // to_jsonb(record)->>'field' safely returns NULL when an older deployed table
 // does not yet have the additive parent_network_id column.
 assert.match(networkBlock,/to_jsonb\(n\)->>'parent_network_id'/);
 assert.match(networkBlock,/to_jsonb\(c\)->>'parent_network_id'/);
 assert.doesNotMatch(networkBlock,/n\.parent_network_id|c\.parent_network_id/);
});

test('Network People counts use unique IDs and only their Network membership', () => {
 const lines=networkBlock.split('\n');
 const indices=lines.flatMap((line,i) => line.includes('SELECT count(DISTINCT m.person_id)::int FROM lifegroup_memberships') ? [i] : []);
 // people / boys / girls plus the leaders-in-this-Network count added for the
 // Bishop -> Network Leader hierarchy.
 assert.equal(indices.length,4);
 for(const i of indices){
  const sql=lines.slice(i,i+2).join(' ');
  assert.match(sql,/g\.network_id=n\.id/);
  assert.match(sql,/m\.left_at IS NULL/);
  assert.match(sql,/p\.archived_at IS NULL/);
 }
});
