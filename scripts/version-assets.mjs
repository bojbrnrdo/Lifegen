// Bump the ?v= version of every versioned public asset whose contents changed.
//
// public assets referenced as "/x/y.css?v=1.2.3" are served with
// "Cache-Control: public, max-age=31536000, immutable" (see src/app.js), so the
// version string IS the cache key: if a file changes without the version
// changing, browsers keep the old bytes for a year and the change is invisible.
// Run this after editing public CSS/JS:
//
//   npm run assets:version
//
// It records each asset's sha256 in asset-versions.json and raises the patch
// version of anything whose bytes differ, then rewrites the HTML. npm test
// fails when the recorded hash no longer matches, so a forgotten bump cannot
// reach a deploy unnoticed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const manifestPath = path.join(root, 'asset-versions.json');
const pages = ['public/lifegen/index.html', 'public/vip-announce/index.html', 'public/admin/index.html'];
// src/href="/path/file.ext?v=x.y.z" — the exact shape src/app.js treats as immutable.
const REF = /((?:src|href)=")(\/[^"?]+\.(?:css|js))\?v=(\d+)\.(\d+)\.(\d+)(")/g;

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const changes = [];

for (const page of pages) {
  const file = path.join(root, page);
  if (!fs.existsSync(file)) continue;
  let html = fs.readFileSync(file, 'utf8');
  const rewritten = html.replace(REF, (match, pre, url, major, minor, patch, post) => {
    const asset = path.join(root, 'public', url);
    if (!fs.existsSync(asset)) return match;
    const hash = sha(fs.readFileSync(asset));
    const version = `${major}.${minor}.${patch}`;
    const recorded = manifest[url];
    if (recorded && recorded.version === version && recorded.sha256 !== hash) {
      // Contents changed but the version did not: that is exactly the stale-cache
      // trap. Raise the patch number, keeping major.minor meaning intact.
      const next = `${major}.${minor}.${Number(patch) + 1}`;
      manifest[url] = { version: next, sha256: hash };
      changes.push(`${url}: ${version} -> ${next}`);
      return `${pre}${url}?v=${next}${post}`;
    }
    manifest[url] = { version, sha256: hash };
    if (recorded && recorded.version !== version && recorded.sha256 === hash) {
      changes.push(`${url}: version ${version} recorded (bytes unchanged since ${recorded.version})`);
    }
    return match;
  });
  if (rewritten !== html) fs.writeFileSync(file, rewritten);
  html = rewritten;
}

const ordered = Object.fromEntries(Object.keys(manifest).sort().map(k => [k, manifest[k]]));
fs.writeFileSync(manifestPath, JSON.stringify(ordered, null, 2) + '\n');
console.log(changes.length ? `Versioned ${changes.length} asset(s):\n  ${changes.join('\n  ')}` : 'All versioned assets already match asset-versions.json.');
