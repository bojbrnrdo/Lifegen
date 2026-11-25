import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { retireDevAssets } from '../scripts/retire-dev-assets.mjs';

test('retired LifeIDE assets are omitted from production builds only', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'lifegen-dev-removed-'));
 try {
  const dir = path.join(root, 'public', 'lifeide');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), 'retired');
  const views = path.join(root, 'public', 'admin', 'js', 'views');
  await mkdir(views, {recursive: true});
  for (const name of ['devWorkspace.js', 'developer.js']) await writeFile(path.join(views, name), 'retired');
  assert.equal(await retireDevAssets(root, false), false);
  await access(path.join(dir, 'index.html'));
  await access(path.join(views, 'devWorkspace.js'));
  assert.equal(await retireDevAssets(root, true), true);
  await assert.rejects(access(dir), {code: 'ENOENT'});
  for (const name of ['devWorkspace.js', 'developer.js']) await assert.rejects(access(path.join(views, name)), {code:'ENOENT'});
 } finally { await rm(root, {recursive: true, force: true}); }
});
