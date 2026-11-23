import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const seed = readFileSync(new URL('../preview-db/seed-pastoral-hierarchy.mjs', import.meta.url), 'utf8');

// The demo hierarchy is the thing people judge the product by, so its shape is
// pinned: six Cell Leaders under every Network Leader, six people in every Cell.
test('every Network Leader in the demo seed has six Cell Leaders', () => {
  const block = seed.slice(seed.indexOf('const CELL_LEADERS'), seed.indexOf('const PER_CELL'));
  const entries = [...block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)];
  assert.equal(entries.length, 6, 'six Network Leaders are defined');
  for (const [, leader, list] of entries) {
    const names = list.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    assert.equal(names.length, 6, `${leader} must lead 6 Cell Leaders, found ${names.length}`);
    assert.equal(new Set(names).size, 6, `${leader} has no duplicate Cell Leader names`);
  }
  // No name may be shared between Networks either.
  const all = entries.flatMap(([, , list]) => list.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean));
  assert.equal(new Set(all).size, all.length, 'Cell Leader names are unique across all Networks');
});

test('a Cell still holds six people, and the app cap is not exceeded', () => {
  assert.match(seed, /const PER_CELL = 6;/);
  // Six Cell Leaders per Network is well inside the product's own limit.
  const src = readFileSync(new URL('../src/lifegroups.js', import.meta.url), 'utf8');
  const limit = Number(src.match(/NETWORK_CELL_LEADER_LIMIT = (\d+)/)[1]);
  assert.ok(6 <= limit, `six per Network must fit inside the ${limit} Cell Leader limit`);
});

test('re-running the seed tops up instead of skipping or rebuilding', () => {
  assert.match(seed, /topUpToSix/, 'a top-up path exists for an existing hierarchy');
  assert.match(seed, /Already complete|already complete/, 'a completed hierarchy is reported as such');
  assert.match(seed, /const alreadyThere =/, 'the fresh-build and top-up paths are mutually exclusive');
  // A Cell that already exists must never be recreated.
  assert.match(seed, /haveNames\.has|!haveNames/, 'only missing Cells are created');
});
