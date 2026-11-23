import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const seed = readFileSync(new URL('../preview-db/seed-pastoral-hierarchy.mjs', import.meta.url), 'utf8');
const rename = readFileSync(new URL('../preview-db/rename-demo-people.mjs', import.meta.url), 'utf8');

// The demo seed once wrote `Friend1 Kai` and `Demo Person 01`. Both must be
// recognised as placeholders, or a rename pass leaves rows behind: the first
// version of that script checked only the Friend pattern and skipped 24 rows.
test('the seeder no longer writes placeholder names', () => {
  assert.doesNotMatch(seed, /`Friend\$\{/, 'no FriendN first names');
  assert.match(seed, /nextName\(sex\)/, 'Cell members get generated names');
  assert.match(seed, /const usedNames = new Set\(\)/, 'names are not reused');
});

test('the rename tool recognises every placeholder shape the seeders wrote', () => {
  // Rebuild the predicate from the shipped source and exercise it.
  const body = rename.slice(rename.indexOf('const isPlaceholder'), rename.indexOf('async function run()'));
  const isPlaceholder = new Function(`${body}; return isPlaceholder;`)();
  const cases = [
    [{ first_name: 'Friend1', last_name: 'Kai' }, true, 'Cell members'],
    [{ first_name: 'Friend12', last_name: 'Bea' }, true, 'two-digit member index'],
    [{ first_name: 'Demo', last_name: 'Person 01' }, true, 'seeded demo crowd'],
    [{ first_name: 'Demo', last_name: 'Person 24' }, true, 'last demo person'],
    [{ first_name: 'Test', last_name: 'VIP' }, true, 'QA record'],
    [{ first_name: 'Ramon', last_name: 'Castillo' }, false, 'a real name must never be rewritten'],
    [{ first_name: 'Arsie', last_name: 'Borromeo' }, false, 'the pastor is left alone'],
  ];
  for (const [person, expected, why] of cases)
    assert.equal(isPlaceholder(person), expected, why);
});

test('renaming only ever sends the name fields', () => {
  const call = rename.match(/await call\('updatePerson'[^;]*;/g) || [];
  assert.ok(call.length >= 1, 'the tool updates people');
  for (const line of call)
    assert.match(line, /updatePerson', Number\(person\.id\), \{ first_name: first, last_name: last \}/,
      'a rename must not send status, sex, code or dates');
});
