import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

test('LifeIDE browser script parses before any browser interaction', () => {
  const file = new URL('../public/lifeide/app.js', import.meta.url);
  const source = readFileSync(file, 'utf8');
  assert.doesNotThrow(() => new Script(source, { filename: file.pathname }));
});
