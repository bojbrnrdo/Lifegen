import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sniffImage } from '../src/vip-designs.js';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const page = read('public/lifegen/index.html');
const manifest = JSON.parse(read('public/brand/gallery/drive/manifest.json'));
const assets = url => fs.readFileSync(path.join(root, 'public', url));
// The gallery's lossless WebP has a VP8L bitstream (signature at byte 20).
const imageSize = bytes => {
  if (bytes.toString('ascii', 12, 16) === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return sniffImage(bytes);
};
const sha = b => createHash('sha256').update(b).digest('hex');

test('all 48 supplied photos and the artwork occupy the photo/poster deck exactly once', () => {
  assert.equal(manifest.items.length, 49);
  assert.equal(new Set(manifest.items.map(e => e.source)).size, 49);
  assert.equal((page.match(/class="deck-card"/g) || []).length, 49);
  for (const item of manifest.items) {
    assert.equal(page.split(`data-img="${item.preview}"`).length - 1, 1);
    assert.equal(page.split(`data-full="${item.full}"`).length - 1, 1);
  }
  assert.doesNotMatch(page, /Your poster here|Your photo here|lifegen-moment-/);
});

test('full-size photos retain their exact source bytes and resolution', () => {
  for (const item of manifest.items) {
    const bytes = assets(item.full);
    assert.equal(sha(bytes), item.fullSha256, item.full);
    assert.equal(bytes.length, item.fullBytes);
    if (item.full.endsWith('.jpg')) assert.equal(item.fullSha256, item.sourceSha256);
    const dimensions = imageSize(bytes);
    assert.equal(dimensions.width, item.width);
    assert.equal(dimensions.height, item.height);
  }
});

test('deck previews are small WebP files, separate from the full-size lightbox assets', () => {
  let previewBytes = 0, sourceBytes = 0;
  for (const item of manifest.items) {
    const bytes = assets(item.preview);
    const dimensions = sniffImage(bytes);
    assert.equal(dimensions.mime, 'image/webp');
    assert.ok(dimensions.width <= 512 && dimensions.height <= 512);
    assert.equal(bytes.length, item.previewBytes);
    assert.notEqual(item.preview, item.full);
    previewBytes += bytes.length;
    sourceBytes += item.sourceBytes;
  }
  assert.ok(previewBytes < sourceBytes * 0.2, 'Preview payload is reduced by more than 80%');
  const code = read('public/lifegen/videos.js');
  assert.match(code, /loading="lazy"/);
  assert.match(code, /card\.dataset\.full \|\| src/);
});

test('Grand Campus Hangout is in the widescreen highlight frame with a direct fallback', () => {
  const highlight = page.match(/<article class="vcard reveal vcard-feature"[^>]*>(.*?)<\/article>/s)[1];
  const url = 'https://drive.google.com/file/d/1rZt48LpaSTRQM3dvfbxkb-ta7cwtSAUb/view';
  assert.ok(highlight.includes(`data-video="${url}"`));
  assert.ok(highlight.includes(`href="${url}"`));
  assert.match(highlight, /data-ratio="16\/9"/);
  assert.match(highlight, /<h4>Grand Campus Hangout<\/h4>/);
  const poster = highlight.match(/data-poster="([^"]+)"/)[1];
  assert.equal(poster, '/brand/gallery/drive/grand-campus-hangout-cover.webp');
  assert.doesNotMatch(page, /<iframe/); // No eager third-party player request.
  assert.equal((page.match(/data-label="Testimony coming soon"/g) || []).length, 2);
});

test('the highlight thumbnail is a 16:9 crop of the supplied title card', () => {
  const highlight = page.match(/<article class="vcard reveal vcard-feature"[^>]*>(.*?)<\/article>/s)[1];
  const poster = highlight.match(/data-poster="([^"]+)"/)[1];
  const cover = assets(poster);
  const size = sniffImage(cover);
  assert.equal(size.mime, 'image/webp');
  // Drop-in shape for the 16:9 frame, and for a 1280 × 720 video thumbnail.
  assert.deepEqual([size.width, size.height], [1280, 720]);
  // The supplied title card is the only artwork; the deck poster is untouched.
  assert.notEqual(sha(cover), manifest.items[0].fullSha256);
  assert.equal(assets('/brand/gallery/drive/lifegen-artwork-preview.webp').length,
               manifest.items[0].previewBytes);
  assert.doesNotMatch(page, /lifegen-highlight-cover/);
});

test('landing banner and logos use the supplied LIFEGEN artwork, without duplicate overlays', () => {
  const hero = page.match(/<section class="hero" id="home">(.*?)<div class="container hero-lower">/s)[1];
  assert.match(hero, /class="hero-banner-image"/);
  assert.match(hero, /fetchpriority="high"/);
  assert.match(hero, /srcset="\/brand\/lifegen-banner-960.webp 960w, \/brand\/lifegen-banner-1920.webp 1920w"/);
  assert.match(hero, /<h1 class="hero-banner-title">LIFEGEN/);
  assert.doesNotMatch(hero, /hs-tint|hs-bg|hero-brand/);
  assert.doesNotMatch(page, /lifegen-logo\.jpg|lifegen-hero\.jpg|lifegen-favicon\.jpg/);
  assert.equal((page.match(/src="\/brand\/lifegen-emblem.webp"/g) || []).length, 2);
  for (const width of [960, 1920]) {
    const size = imageSize(assets(`/brand/lifegen-banner-${width}.webp`));
    assert.equal(size.width, width);
    assert.equal(size.height, Math.round(2400 * width / 4269));
  }
  assert.equal(imageSize(assets('/brand/lifegen-emblem.webp')).width, 320);
  assert.equal(imageSize(assets('/brand/lifegen-icon.webp')).width, 64);
});


test('the banner fills the width with no side bars and never taller than the first screen', () => {
  const styles = read('public/lifegen/styles.css');
  const page = read('public/lifegen/index.html');
  // The 16:9 artwork at 100vw was a whole screen tall on a laptop. It is still
  // edge to edge — cropped to a band, not letterboxed: no column caps, no matte
  // behind it, so nothing shows beside the artwork at any width.
  assert.doesNotMatch(styles, /\.hero-banner-art\{[^}]*max-width/);
  assert.doesNotMatch(styles, /banner-blur|background-image:url\("\/brand/);
  assert.match(styles, /\.hero-strip\.hero-strip--artwork\{padding:0;background:#062b19\}/);
  assert.ok(!fs.existsSync(path.join(root, 'public/brand/lifegen-banner-blur.webp')), 'No matte asset ships');
  // The band is the artwork's 26.3vw emblem plus clearance for the fixed nav,
  // capped against viewport height; cover-cropping keeps the emblem whole.
  assert.match(styles, /\.hero-banner-image\{height:min\(calc\(26\.3vw \+ 120px\),70vh\);object-fit:cover;object-position:center\}/);
  // Phones keep the uncropped 16:9 artwork and its 960 px source.
  assert.match(styles, /\.hero-banner-image\{height:auto\}/);
  assert.match(page, /<source media="\(max-width:640px\)" srcset="\/brand\/lifegen-banner-960\.webp"\/>/);
});

test('navigation overlays the banner without a colored strip or reserved space', () => {
  const styles = read('public/lifegen/styles.css');
  assert.match(styles, /\.nav\{position:fixed;top:0\}/);
  assert.match(styles, /\.hero-strip\.hero-strip--artwork\{padding:0;/);
  assert.match(styles, /\.nav:not\(\.scrolled\)\{background:transparent;/);
  assert.doesNotMatch(styles, /max-height:680px/);
  const backend = read('public/lifegen/backend.js');
  assert.match(backend, /document.querySelector\('\.hero-lower'\)/);
  assert.doesNotMatch(backend, /document.body.prepend\(note\)/);
  assert.doesNotMatch(styles, /\.hero-strip\.hero-strip--artwork\{[^}]*padding(?:-top)?:104px/);
});
