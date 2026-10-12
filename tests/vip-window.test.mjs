import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('VIP follow-up is provided by the Lifegroup queue, not a one-month outcome export', async () => {
  const app = await readFile(path.join(root, 'src/app.js'), 'utf8');
  const registrations = await readFile(path.join(root, 'public/admin/js/views/registrations.js'), 'utf8');
  const api = await readFile(path.join(root, 'public/admin/js/api.js'), 'utf8');
  const domain = await import(pathToFileURL(path.join(root, 'src/domain.js')));

  assert.doesNotMatch(app, /lifegroupOutcomes|vip_window_outcome_exported/);
  assert.doesNotMatch(registrations, /lifegroupOutcomes|4-week window since invitation|tracker export|exportCsv|Export CSV|downloadBlob/i);
  assert.doesNotMatch(api, /lifegroupOutcomes/);
  assert.equal('vipWindowResult' in domain, false);
});
