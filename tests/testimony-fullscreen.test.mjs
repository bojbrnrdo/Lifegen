import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const page = read('public/lifegen/index.html');
const css = read('public/lifegen/styles.css');
const scripts = read('public/lifegen/videos.js');
const manifest = JSON.parse(read('asset-versions.json'));

test('Janime Rivera testimony is the one featured, edge-to-edge video', () => {
  assert.match(page, /class="story-grid story-grid--testimonies"/);
  assert.match(page, /class="vcard vcard--testimony-featured reveal"/);
  assert.match(page, /class="vframe" data-fullscreen="true" data-video="https:\/\/docs\.google\.com\/videos\/d\//);
  assert.match(css, /#stories \.vcard--testimony-featured\{[\s\S]*?width:100vw/);
  assert.match(css, /#stories \.vcard--testimony-featured \.vframe\{[\s\S]*?aspect-ratio:16 \/ 9/);
  assert.match(css, /#stories \.vcard--testimony-featured \.vmeta/);
  assert.match(css, /#stories \.story-grid--testimonies > \.vcard:not\(\.vcard--testimony-featured\)/);
});

test('video is click-to-load and opens fullscreen from a direct user gesture', () => {
  assert.doesNotMatch(page, /<iframe/);
  assert.match(scripts, /const immersive = frame\.dataset\.fullscreen === "true"/);
  assert.match(scripts, /frame\.requestFullscreen\(\)/);
  assert.match(scripts, /document\.fullscreenElement === frame/);
  assert.match(scripts, /document\.exitFullscreen\?\.\(\)/);
  assert.match(scripts, /if \(immersive\) enterFullscreen\(\)/);
  assert.match(scripts, /aria-label", \(immersive \? "Play fullscreen video: "/);
});

test('fullscreen overlay has a visible keyboard-accessible exit control', () => {
  assert.match(scripts, /"Exit fullscreen video"/);
  assert.match(scripts, /button\.addEventListener\("click", enterFullscreen\)/);
  assert.match(scripts, /document\.addEventListener\("fullscreenchange", updateFullscreenButton\)/);
  assert.match(css, /vfullscreen-button:focus-visible/);
  assert.match(css, /:fullscreen/);
  assert.match(css, /height:100dvh/);
});

test('mobile fallback restores the original embed and page scroll', () => {
  assert.match(scripts, /function expandFallback\(/);
  assert.match(scripts, /function restoreFallback\(/);
  assert.match(scripts, /frame\.before\(marker\)/);
  assert.match(scripts, /marker\.replaceWith\(frame\)/);
  assert.match(scripts, /document\.body\.style\.overflow = overflow/);
  assert.match(scripts, /event\.key === "Escape"/);
  assert.match(css, /\.vframe\.vframe--fullscreen-fallback/);
});

test('other videos and immutable asset versioning remain intact', () => {
  const other = page.match(/data-label="Grand Campus Hangout"/g) || [];
  assert.equal(other.length,1);
  assert.match(page,/data-label="Testimony coming soon"/);
  assert.equal((page.match(/data-fullscreen="true"/g)||[]).length,1);
  assert.match(page,/\/lifegen\/styles\.css\?v=2\.4\.15/);
  assert.match(page,/\/lifegen\/videos\.js\?v=2\.4\.5/);
  assert.equal(manifest['/lifegen/styles.css'].version,'2.4.15');
  assert.equal(manifest['/lifegen/videos.js'].version,'2.4.5');
});
