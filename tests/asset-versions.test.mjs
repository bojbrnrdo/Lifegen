import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Versioned public assets are served "immutable" for a year, so a file whose
// contents changed while its ?v= stayed the same is invisible to every browser
// that already cached it. This guards the case that shipped the letterboxed
// banner twice: the CSS was fixed, the version was not bumped, and visitors kept
// the old bytes. See scripts/version-assets.mjs.
const root = path.resolve(import.meta.dirname, '..');
const REF = /(?:src|href)="(\/[^"?]+\.(?:css|js))\?v=(\d+\.\d+\.\d+)"/g;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-versions.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('every versioned asset matches the contents recorded for its version', () => {
  const refs = [];
  for (const page of ['public/lifegen/index.html', 'public/vip-announce/index.html', 'public/admin/index.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const [, url, version] of html.matchAll(REF)) refs.push({ page, url, version });
  }
  assert.ok(refs.length >= 8, `Expected the pages to version their assets (found ${refs.length})`);
  for (const { page, url, version } of refs) {
    const asset = path.join(root, 'public', url);
    assert.ok(fs.existsSync(asset), `${page} references missing asset ${url}`);
    const recorded = manifest[url];
    assert.ok(recorded, `${url} is not recorded in asset-versions.json — run: npm run assets:version`);
    const hash = sha(fs.readFileSync(asset));
    assert.equal(recorded.sha256, hash,
      `${url} changed but its version is still ${version}. Browsers cache this URL immutably for a year, ` +
      'so the change will not reach anyone who already loaded the site. Run: npm run assets:version');
    assert.equal(recorded.version, version,
      `${page} references ${url}?v=${version} but asset-versions.json records ${recorded.version}. Run: npm run assets:version`);
  }
});

test('the stale-cache trap itself is covered: a content change forces a version change', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/version-assets.mjs'), 'utf8');
  assert.match(script, /recorded\.sha256 !== hash/);
  assert.match(script, /Number\(patch\) \+ 1/);
  // Both the one-year cache and the version it keys on must stay in the server.
  const server = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  assert.match(server, /max-age=31536000, immutable/);
  assert.match(server, /\^\\d\+\\\.\\d\+\\\.\\d\+\$/);
});
