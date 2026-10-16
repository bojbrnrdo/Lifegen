import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The Reports view offers Week, Month, Quarter, Year and Custom. Week used to be
// part of the picker, was removed once, and is now back — this locks it in so it
// cannot silently disappear again, and pins the Sunday-only rule of the picker.
//
// The onchange code is executed EXACTLY as written in reports.js (extracted from
// the file), against the real date helpers from ui.js, so this is not a copy of
// the logic living in the test.
const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/admin/js/views/reports.js'), 'utf8');

// ui.js touches document/window at import time (toasts, modals); stub the few
// globals it needs so the real helpers can be imported in Node.
const noop = () => {};
globalThis.document ??= {
  addEventListener: noop, removeEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, setAttribute: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] }),
  body: { appendChild: noop, classList: { add: noop, remove: noop } },
  documentElement: { classList: { add: noop, remove: noop } },
};
globalThis.window ??= { addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }), location: { hash: '' } };
globalThis.location ??= { hash: '', href: 'http://localhost/' };

const { toISODate, lastSunday } = await import(path.join(root, 'public/admin/js/ui.js'));

const extract = (re, what) => {
  const m = source.match(re);
  assert.ok(m, `${what} not found in public/admin/js/views/reports.js`);
  return m[0];
};

test('the Reports period picker offers Week first, then Month, Quarter, Year, Custom', () => {
  const list = source.match(/\$\{\[([^\]]*)\]\.map\(\(m\) =>/);
  assert.ok(list, 'the period picker (data-m buttons) was not found');
  const modes = list[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(modes, ['week', 'month', 'quarter', 'year', 'range']);
});

test('Week mode renders its own Sunday picker and hides the year select', () => {
  assert.match(source, /id="pWeek"/);
  assert.match(source, /id="pWeek"[^`]*aria-label="Sunday"/);
  assert.match(source, /m !== 'range' && m !== 'week' \? html`<select id="pYear"/);
});

test('Week mode asks the API for exactly that Sunday', () => {
  assert.match(source, /if \(sel\.mode === 'week'\) return \{ from: sel\.week, to: sel\.week \};/);
  // The old fallback that turned ?mode=week into the month view must be gone.
  assert.doesNotMatch(source, /query\.mode === 'week' \? 'month'/);
});

test('the Sunday picker keeps any date inside the week of the chosen Sunday', () => {
  const line = extract(/if \(el\.id === 'pWeek'\)[^\n]*/, 'the pWeek onchange handler');
  const run = new Function('el', 'sel', 'toISODate', 'lastSunday', `${line}\nreturn sel.week;`);
  const pick = (value) => run({ id: 'pWeek', value }, { week: '' }, toISODate, lastSunday);

  assert.equal(pick('2026-10-11'), '2026-10-11'); // Sunday stays
  assert.equal(pick('2026-10-14'), '2026-10-11'); // Wednesday snaps back
  assert.equal(pick('2026-10-12'), '2026-10-11'); // Monday snaps back
  assert.equal(pick('2026-10-18'), '2026-10-18'); // next Sunday stays
});

test('clearing the date field falls back to the latest Sunday instead of NaN', () => {
  const line = extract(/if \(el\.id === 'pWeek'\)[^\n]*/, 'the pWeek onchange handler');
  const run = new Function('el', 'sel', 'toISODate', 'lastSunday', `${line}\nreturn sel.week;`);
  const out = run({ id: 'pWeek', value: '' }, { week: '' }, toISODate, lastSunday);
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(out, toISODate(lastSunday()));
});
