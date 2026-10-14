import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, statSync, existsSync} from 'node:fs';
import {mp4Info, formatDuration} from '../scripts/add-video.mjs';

// scripts/add-video.mjs is how a church-owned video gets onto the site so a
// slot stops playing through the provider's black surround. Its whole value is
// trusting the numbers it prints, so the MP4 reader is checked against a real,
// already-published file: Janime's testimony, whose caption on the page says
// 7 min 19 sec at 1280 × 720.
const page = readFileSync(new URL('../public/lifegen/index.html', import.meta.url), 'utf8');
const video = new URL('../public/brand/videos/janime-rivera-testimony-720p.mp4', import.meta.url);

test('the MP4 reader reports the real duration and picture size', () => {
    const info = mp4Info(readFileSync(video));
    assert.equal(info.width, 1280);
    assert.equal(info.height, 720);
    assert.ok(info.duration > 438 && info.duration < 441, `expected ~439 s, read ${info.duration}`);
});

test('the reported duration is the one the page already shows for that file', () => {
    const {duration} = mp4Info(readFileSync(video));
    const label = formatDuration(duration);
    assert.equal(label, '7 min 19 sec');
    assert.ok(page.includes(label), 'the caption and the file must agree');
});

test('formatDuration matches how the site writes times', () => {
    assert.equal(formatDuration(133), '2 min 13 sec'); // the hangout's own running time
    assert.equal(formatDuration(59), '59 sec');
    assert.equal(formatDuration(60), '1 min 0 sec');
    assert.equal(formatDuration(0), null);
});

test('the helper refuses what it cannot publish', () => {
    const script = readFileSync(new URL('../scripts/add-video.mjs', import.meta.url), 'utf8');
    assert.match(script, /signature !== 'ftyp'/, 'non-MP4 files are refused, not copied');
    assert.match(script, /hardLimit = 100 \* 1024 \* 1024/, 'GitHub\'s 100 MB hard limit is enforced');
    assert.match(script, /softLimit = 90 \* 1024 \* 1024/, 'the 90 MB warning is kept');
    assert.match(script, /already exists — re-run with --force/, 'no silent overwrite of a published video');
    assert.match(script, /--dir must stay inside the repository/, 'nothing is written outside the repo');
    // A video this large is why the file, not the provider, is the deliverable.
    assert.ok(statSync(video).size > 5_000_000);
});

test('the hangout slot names a file that is actually there', () => {
    const slot = page.match(/data-native-src="([^"]+)"[^>]*data-label="Grand Campus Hangout"|data-label="Grand Campus Hangout"[^>]*data-native-src="([^"]+)"/);
    assert.ok(slot, 'the highlight names the file it will play first-party');
    const named = slot[1] || slot[2];
    assert.equal(named, '/brand/videos/grand-campus-hangout.mp4');
    // A slot pointing at a file that is not on the site would silently fall
    // back to the provider's black surround — the exact thing being fixed.
    assert.ok(existsSync(new URL('../public' + named, import.meta.url)), `${named} must exist in public/`);
});
