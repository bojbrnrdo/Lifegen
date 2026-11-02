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

test('archived People profiles do not offer editing or status modification controls', () => {
 assert.match(source, /can\('people:write'\) && !archived \? html`<div class="page-actions">/);
});

test('restricted People profiles hide self-reported age and privacy consent timestamp', () => {
 const ageLine = source.split('\n').find(x => x.includes("row('Age', p.age"));
 assert.match(ageLine, /, true\)/);
 assert.match(source, /locked \? html`<span class="locked">/);
});

test('People edit view refuses archived records', () => {
 const formSource = readFileSync(new URL('../public/admin/js/views/personForm.js', import.meta.url), 'utf8');
 assert.match(formSource, /if \(person\.archived_at\)/);
 assert.match(formSource, /Restore the record before editing/);
});
