// The progress card fetches its data after it starts rendering, while the page
// around it can be rebuilt at any moment (a live update after saving a meeting
// report). A late response used to throw on a detached card, or paint yesterday's
// numbers over newer ones. createProgressGuard() is what makes that impossible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProgressGuard, progressCardIsCurrent } from '../public/admin/js/views/progressGuard.js';

const card = (connected = true) => ({ dataset: {}, isConnected: connected });

test('the first render owns the card', () => {
  const el = card();
  const guard = createProgressGuard(el);
  assert.equal(guard.current(), true);
  assert.equal(progressCardIsCurrent(el, guard.token), true);
});

test('a card the page has replaced (a stale async card) is never painted', () => {
  assert.equal(createProgressGuard(null).current(), false, 'no card at all is safe');
  const el = card(false);                       // detached: page navigated away
  assert.equal(createProgressGuard(el).current(), false);
});

test('a newer render takes the card over and the older response is dropped', () => {
  const el = card();
  const first = createProgressGuard(el);
  const second = createProgressGuard(el);
  assert.notEqual(first.token, second.token);
  assert.equal(first.current(), false, 'the older render must not paint');
  assert.equal(second.current(), true, 'the newest render paints');
});

test('tokens keep advancing so two rapid opens cannot share one', () => {
  const el = card();
  const tokens = new Set();
  for (let i = 0; i < 5; i++) tokens.add(createProgressGuard(el).token);
  assert.equal(tokens.size, 5);
});

test('the card view asks the guard before and after its fetch', () => {
  const view = readFileSync(new URL('../public/admin/js/views/progress.js', import.meta.url), 'utf8');
  assert.match(view, /import \{ createProgressGuard \} from '\.\/progressGuard\.js';/);
  assert.match(view, /if \(!card\) return;/, 'a missing card is a no-op, not a crash');
  const start = view.indexOf('export async function renderProgressCard');
  const body = view.slice(start, view.indexOf('const draw = () => {', start));
  assert.match(body, /const guard = createProgressGuard\(card\);/);
  assert.match(body, /if \(!current\(\)\) return;/, 'the response is checked after the await');
  assert.match(body, /const current = guard\.current;/, 'it uses the shared guard');
  const draw = view.slice(view.indexOf('const draw = () => {', start), view.indexOf('const draw = () => {', start) + 200);
  assert.match(draw, /if \(!current\(\)\) return;/, 'drawing checks it too');
});

test('the Cell page reads its card before awaiting, not after', () => {
  const view = readFileSync(new URL('../public/admin/js/views/lifegroups.js', import.meta.url), 'utf8');
  assert.match(view, /const progressCard=main\.querySelector\('#progressCard'\);\n\s*if\(!progressCard\)return;/);
  assert.match(view, /renderProgressCard\(progressCard, g\.id/);
  assert.doesNotMatch(view, /renderProgressCard\(main\.querySelector\('#progressCard'\)/);
});
