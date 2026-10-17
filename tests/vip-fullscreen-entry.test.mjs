import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The homepage countdown card carries a Fullscreen control that opens the public
// VIP welcome board (/vip-announce) without signing in to Admin, and the
// local-demo clock lets the preview database behave as a live Sunday.
const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('homepage countdown card has a Fullscreen control in its lower-right footer', () => {
  const html = read('public/lifegen/index.html');
  const foot = html.match(/<div class="cd-foot" id="cdSub">([\s\S]*?)<\/div><\/section>/);
  assert.ok(foot, 'countdown footer exists');
  assert.match(foot[1], /<button[^>]*class="cd-fs"[^>]*id="cdFsBtn"/);
  // The button comes after the existing Sunday/time and location items, so it sits at the right edge.
  assert.ok(foot[1].indexOf('Lifegiver Church of Faith') < foot[1].indexOf('id="cdFsBtn"'));
  assert.match(read('public/lifegen/styles.css'), /\.cd-fs\{margin-left:auto/);
});

test('the fullscreen overlay hosts the public projector page and is hidden until opened', () => {
  const html = read('public/lifegen/index.html');
  assert.match(html, /<div[^>]*class="vip-fs"[^>]*hidden[^>]*id="vipFs"|<div[^>]*id="vipFs"[^>]*class="vip-fs"[^>]*hidden/);
  // No iframe in the markup: the board is mounted on first click, so the page makes no extra request.
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /id="vipFsClose"/);
  const js = read('public/lifegen/app.js');
  assert.match(js, /frame\.src = "\/vip-announce"/);
  assert.match(js, /setAttribute\("allow", "fullscreen"\)/);
  assert.match(js, /requestFullscreen/);
});

test('the CSP allows the same-origin projector iframe', () => {
  const server = read('src/app.js');
  const frameSrc = server.match(/frameSrc:\[([^\]]*)\]/);
  assert.ok(frameSrc, 'frameSrc directive exists');
  assert.match(frameSrc[1], /^"'self'"|^'self'/);
});

test('the demo clock only runs in the local demo and never in production', async () => {
  const saved = { ...process.env };
  try {
    const mod = await import(`../src/service-cycle.js?demo=${Date.now()}`);
    delete process.env.LOCAL_DEMO; delete process.env.LOCAL_DEMO_CLOCK;
    assert.equal(mod.demoClockEnabled(), false);

    process.env.LOCAL_DEMO_CLOCK = '2026-10-18T13:05:00+08:00';
    assert.equal(mod.demoClockEnabled(), false, 'clock needs LOCAL_DEMO=true too');

    process.env.LOCAL_DEMO = 'true';
    process.env.NODE_ENV = 'production';
    assert.equal(mod.demoClockEnabled(), false, 'never in production');

    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;
    assert.equal(mod.demoClockEnabled(), true);
    const first = mod.currentInstant();
    assert.equal(manilaKey(first), '2026-10-18', 'the demo starts on the Sunday');
    assert.equal(mod.manilaMinutesOfDay(first) >= 13 * 60, true, 'and at service time');
    // The demo clock keeps running in real time from the anchor.
    assert.ok(mod.currentInstant().getTime() >= first.getTime());
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

function manilaKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
