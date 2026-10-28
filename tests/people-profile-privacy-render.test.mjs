import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/admin/js/views/person.js', import.meta.url), 'utf8');

test('restricted People profiles mask contact, email, birthdate and address even if supplied by API', () => {
 assert.match(source, /locked && \(sensitive \|\| value === undefined\)/);
 for (const name of ['Contact number','Email','Birthday','Address']) {
  const line = source.split('\n').find(x => x.includes("row('"+name+"'"));
  assert.ok(line, name + ' field exists');
  assert.match(line, /, true\)/, name + ' uses privacy guard');
 }
});

test('People contact links use escaped HTML templates rather than raw HTML strings', () => {
 const phone = source.split('\n').find(x => x.includes("row('Contact number'"));
 const email = source.split('\n').find(x => x.includes("row('Email'"));
 for (const line of [phone,email]) {
  assert.match(line, /=> html`/);
  assert.doesNotMatch(line, /=> raw`/);
 }
});
