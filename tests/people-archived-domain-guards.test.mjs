import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/domain.js', import.meta.url), 'utf8');

test('archived People are protected in domain update and status methods', () => {
 for (const [method, next] of [['updatePerson:', 'duplicates:'], ['setPersonStatus:', 'deletePerson:']]) {
  const start = source.indexOf(method);
  const end = source.indexOf(next, start + method.length);
  assert.ok(start >= 0 && end > start, method + ' exists');
  const body = source.slice(start, end);
  assert.match(body, /if \(p\.archived_at\) throw httpError\(409,/);
  assert.ok(body.indexOf('if (p.archived_at)') < body.indexOf('save()'), method + ' rejects before mutation');
 }
});
