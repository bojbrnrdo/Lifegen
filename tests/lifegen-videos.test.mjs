import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The Stories video helpers live in a browser-only IIFE, so run the real
// public/lifegen/videos.js in a sandbox with a stub DOM and use the
// __LIFEGEN_VIDEOS__ test hook it exposes. Top-level DOM work is stubbed to
// empty results; only the pure helpers are exercised here.
const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/lifegen/videos.js'), 'utf8');

function loadHelpers() {
  const sandbox = {
    location: { href: 'https://lifegen.test/' },
    document: {
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener: () => {},
      createElement: () => { throw new Error('no DOM in helper tests'); },
    },
    window: {},
    console,
    URL,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'videos.js' });
  assert.ok(sandbox.__LIFEGEN_VIDEOS__, 'videos.js must expose its __LIFEGEN_VIDEOS__ test hook');
  return sandbox.__LIFEGEN_VIDEOS__;
}

const { embedFor, parseYouTubeStart, isYouTubeShorts, resolveRatio } = loadHelpers();

test('YouTube start times parse plain seconds and h/m/s forms', () => {
  assert.equal(parseYouTubeStart('90'), 90);
  assert.equal(parseYouTubeStart('90s'), 90);
  assert.equal(parseYouTubeStart('1m30s'), 90); // parseInt("1m30s") would give 1
  assert.equal(parseYouTubeStart('1h2m3s'), 3723);
  assert.equal(parseYouTubeStart('2m'), 120);
  assert.equal(parseYouTubeStart('1h'), 3600);
  assert.equal(parseYouTubeStart(''), 0);
  assert.equal(parseYouTubeStart(null), 0);
  assert.equal(parseYouTubeStart('soon'), 0);
});

test('YouTube embeds carry the parsed start time and the no-cookie host', () => {
  const watch = embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s');
  assert.equal(watch.provider, 'YouTube');
  assert.match(watch.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.match(watch.src, /[?&]start=90(&|$)/);
  const plain = embedFor('https://youtu.be/dQw4w9WgXcQ?start=3723');
  assert.match(plain.src, /start=3723/);
  const hour = embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s');
  assert.match(hour.src, /start=3723/);
  const none = embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.doesNotMatch(none.src, /start=/);
  const shorts = embedFor('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  assert.equal(shorts.provider, 'YouTube');
});

test('YouTube Shorts default to a 9:16 frame without data-ratio', () => {
  assert.equal(isYouTubeShorts('https://www.youtube.com/shorts/dQw4w9WgXcQ'), true);
  assert.equal(isYouTubeShorts('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
  assert.equal(resolveRatio({ dataset: {} }, 'https://www.youtube.com/shorts/dQw4w9WgXcQ'), '9/16');
  assert.equal(resolveRatio({ dataset: {} }, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), '16/9');
  assert.equal(resolveRatio({ dataset: { ratio: '16/9' } }, 'https://www.youtube.com/shorts/dQw4w9WgXcQ'), '16/9');
});

test('Facebook embeds size the plugin to the slot ratio', () => {
  const landscape = embedFor('https://www.facebook.com/watch/?v=123456', '16/9');
  assert.equal(landscape.provider, 'Facebook');
  assert.match(landscape.src, /width=560/);
  assert.match(landscape.src, /height=314/);
  assert.equal(landscape.width, 560);
  assert.equal(landscape.height, 314);
  // A 9:16 reel requested at 560x314 would play squeezed into landscape.
  const reel = embedFor('https://www.facebook.com/reel/123456', '9/16');
  assert.equal(reel.provider, 'Facebook');
  assert.match(reel.src, /width=360/);
  assert.match(reel.src, /height=640/);
  assert.equal(reel.width, 360);
  assert.equal(reel.height, 640);
  const watch = embedFor('https://fb.watch/abcdefghi/', '16/9');
  assert.equal(watch.provider, 'Facebook');
  assert.match(landscape.src, new RegExp(encodeURIComponent('https://www.facebook.com/watch/?v=123456')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Google Drive file and Docs video links become preview embeds', () => {
  const file = embedFor('https://drive.google.com/file/d/1rZt48LpaSTRQM3dvfbxkb-ta7cwtSAUb/view');
  assert.equal(file.type, 'iframe');
  assert.equal(file.provider, 'Google Drive');
  assert.equal(file.src, 'https://drive.google.com/file/d/1rZt48LpaSTRQM3dvfbxkb-ta7cwtSAUb/preview');
  const docs = embedFor('https://docs.google.com/videos/d/1nz7eS6ge9ezqCHZrUnFyVfj28YfqEnHL0sncocPgZKQ/edit?usp=drive_link');
  assert.equal(docs.provider, 'Google Drive');
  assert.equal(docs.src, 'https://drive.google.com/file/d/1nz7eS6ge9ezqCHZrUnFyVfj28YfqEnHL0sncocPgZKQ/preview');
});

test('Vimeo and direct video files are recognised', () => {
  const vimeo = embedFor('https://vimeo.com/123456789');
  assert.equal(vimeo.provider, 'Vimeo');
  assert.match(vimeo.src, /^https:\/\/player\.vimeo\.com\/video\/123456789/);
  const mp4 = embedFor('https://example.com/clip.mp4');
  assert.equal(mp4.type, 'video');
  assert.equal(mp4.provider, 'self');
  assert.equal(mp4.src, 'https://example.com/clip.mp4');
});

test('unsupported or empty links return null so the slot can fall back', () => {
  assert.equal(embedFor(''), null);
  assert.equal(embedFor('   '), null);
  assert.equal(embedFor('https://example.com/not-a-video'), null);
  assert.equal(embedFor('https://www.tiktok.com/@lifegen/video/123'), null);
  assert.equal(embedFor('not a url at all %%%'), null);
});

test('no third-party player loads before a tap', () => {
  const page = fs.readFileSync(path.join(root, 'public/lifegen/index.html'), 'utf8');
  assert.doesNotMatch(page, /<iframe/);
  // Every iframe embed renders a cover button first; the iframe is only
  // created inside the click handler. The old eager branch called play()
  // directly for slots without a poster.
  assert.match(source, /btn\.addEventListener\("click", play\)/);
  assert.doesNotMatch(source, /else\s*\{\s*play\(\);?\s*\}/);
  // play() is never invoked during mount — only referenced by the click handler.
  assert.equal((source.match(/(?<![\w$.])(?<!function )play\(\)/g) || []).length, 0);
  // Slots without a poster get a styled fallback cover, not an empty frame.
  assert.match(source, /vcover-fallback/);
  assert.match(source, /vcover-provider/);
});

test('"coming soon" is only for empty slots; unsupported links get a direct link', () => {
  // Empty data-video keeps the placeholder…
  assert.match(source, /if \(!raw\) return placeholder\(frame\);/);
  assert.match(source, /Coming soon/);
  // …while a non-empty link no provider matched warns and links out.
  assert.match(source, /if \(!embed\) return unsupportedFallback\(frame, raw, label\);/);
  assert.match(source, /Video link not supported/);
  assert.match(source, /console\.warn\("\[LIFEGEN\] Video link not supported/);
});
