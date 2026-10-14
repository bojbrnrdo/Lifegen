import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/admin/js/views/lifegroups.js', import.meta.url), 'utf8');
const start = source.indexOf('export function addMemberDialog(');
const end = source.indexOf('/** Per-person edit menu', start);
const modal = source.slice(start, end);
const picker = source.slice(source.indexOf('function personPicker('), source.indexOf('// -----------------------------------------------------------', source.indexOf('function personPicker(')));

test('Add Member renders the matching autocomplete result element', () => {
  assert.ok(start >= 0 && end > start);
  assert.match(modal, /id="memberPick"/);
  assert.match(modal, /id="memberPickResults"/);
  assert.match(modal, /id="memberId"/);
  assert.match(modal, /personPicker\(modal, \{ inputId: 'memberPick', hiddenId: 'memberId'/);
});

test('Add Member requires a selected registered person before calling the API', () => {
  assert.match(modal, /const pid = Number\(modal\.querySelector\('#memberId'\)\.value\)/);
  assert.match(modal, /if \(!pid\) \{/);
  assert.match(modal, /pickerError\.hidden = false/);
  assert.match(modal, /pickInput\.focus\(\)/);
  assert.match(modal, /api\.assignLifegroup\(g\.id, pid/);
});

test('Typing a new search invalidates the previously selected Person ID', () => {
  assert.match(picker, /input\.addEventListener\('input', \(\) => \{ hidden\.value = ''/);
  assert.match(picker, /if \(input\.value\.trim\(\) !== q\) return/);
  assert.match(picker, /hidden\.value = b\.dataset\.id/);
  assert.match(picker, /onSelect\?\.\(\)/);
});

test('Result entries support mouse, touch, and keyboard-triggered clicks', () => {
  assert.match(picker, /addEventListener\('pointerdown'/);
  assert.match(picker, /addEventListener\('click', choose\)/);
  assert.match(picker, /Missing person search results element/);
});