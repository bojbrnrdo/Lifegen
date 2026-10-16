import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../public/lifegen/index.html');
const css = read('../public/lifegen/styles.css');
const app = read('../public/lifegen/app.js');
const versions = JSON.parse(read('../asset-versions.json'));
// Versioned assets are cached immutably, so the carousel markup/CSS/JS must
// ship behind a version at least as new as the one that introduced it
// (styles 2.4.21, app 2.4.2). Later bumps are legitimate — pin a floor only.
const atLeast = (v, min) => {
  const a = v.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

test('the community board is a carousel of post groups with browsing controls', () => {
  const wall = page.match(/<div class="prayer-wall reveal" id="prayerWall"([\s\S]*?)<\/div><\/div><\/div>/);
  assert.ok(wall, '#prayerWall must exist');
  assert.match(wall[0], /aria-roledescription="carousel"/);
  assert.match(wall[0], /id="wallStage"/);
  assert.match(wall[0], /id="wallTrack"/);
  assert.match(wall[0], /id="wallControls"/);
  assert.match(wall[0], /id="wallPrev"[^>]*aria-label="Previous group of posts"/);
  assert.match(wall[0], /id="wallNext"[^>]*aria-label="Next group of posts"/);
  assert.match(wall[0], /id="wallDots"/);
  assert.match(wall[0], /id="wallCounter"[^>]*aria-live="polite"/);
});

test('cards size to their message and stay equal-height only within their group', () => {
  // No masonry columns and no hardcoded card heights: every card grows with
  // its own content.
  assert.doesNotMatch(css, /\.prayer-wall\{columns/);
  assert.doesNotMatch(css, /\.post\{[^}]*height:/);
  assert.match(css, /\.post\{[^}]*display:flex;flex-direction:column/);
  assert.match(css, /\.post\{[^}]*overflow-wrap:anywhere/);
  // Stretch inside one slide = the tallest message in that visible group only.
  assert.match(css, /\.wall-slide\{[^}]*align-items:stretch/);
  // The stage follows the group on screen instead of forcing one wall-wide height.
  assert.match(css, /\.wall-stage\{[^}]*overflow:hidden/);
  assert.match(css, /\.wall-stage\{[^}]*transition:height/);
});

test('the author + Pray footer pins to the bottom of stretched cards', () => {
  assert.match(css, /\.post-foot\{[^}]*margin-top:auto/);
  assert.match(css, /\.post-foot\{[^}]*border-top:1px dashed/);
  assert.match(css, /\.post-text\{[^}]*margin-bottom:16px/);
});

test('the wall re-measures group height on navigation, new posts and viewport changes', () => {
  // Grouping follows the 3 / 2 / 1 responsive breakpoints.
  assert.match(app, /min-width:1025px/);
  assert.match(app, /min-width:641px/);
  assert.match(app, /wallBreaks\[0\]\.matches \? 3 : wallBreaks\[1\]\.matches \? 2 : 1/);
  // renderWall chunks the filtered list into groups of wallCardsPerGroup().
  assert.match(app, /for \(let i = 0; i < list\.length; i \+= size\)/);
  // wallSync measures the ACTIVE slide and writes the stage height — no fixed heights.
  assert.match(app, /slides\[wallIndex\]\.getBoundingClientRect\(\)\.height/);
  assert.match(app, /stage\.style\.height = h \+ "px"/);
  // Content changes (fonts, rotation, dynamic posts) flow through ResizeObserver.
  assert.match(app, /new ResizeObserver/);
  // Breakpoint and rotation changes re-chunk or re-measure.
  assert.match(app, /wallCardsPerGroup\(\) !== wallGroupSize \? renderWall\(!0\) : wallSync\(!1\)/);
  assert.match(app, /addEventListener\("orientationchange", onResize\)/);
});

test('browsing controls, swipe, keyboard and filters all still work', () => {
  // Arrows, dots and counter are wired.
  assert.match(app, /\$\("wallPrev"\)\.addEventListener\("click", \(\) => wallGo\(wallIndex - 1\)\)/);
  assert.match(app, /\$\("wallNext"\)\.addEventListener\("click", \(\) => wallGo\(wallIndex \+ 1\)\)/);
  assert.match(app, /data-group="\$\{i\}"/);
  assert.match(app, /"ArrowLeft" === e\.key/);
  assert.match(app, /"ArrowRight" === e\.key/);
  // Swipe gestures move between groups and must not also click a card button.
  assert.match(app, /stage\.addEventListener\("pointerdown"/);
  assert.match(app, /stage\.addEventListener\("pointerup"/);
  assert.match(app, /wallGo\(wallIndex \+ \(dx < 0 \? 1 : -1\)\)/);
  assert.match(app, /swiped && \(e\.preventDefault\(\), e\.stopPropagation\(\)/);
  // Off-screen groups leave the tab order and the accessibility tree.
  assert.match(app, /s\.setAttribute\("inert", ""\)/);
  assert.match(app, /s\.setAttribute\("aria-hidden", "true"\)/);
  // Filters, counts, timestamps, anonymous names and the Pray button survive.
  assert.match(app, /b\.dataset\.filter/);
  assert.match(app, /countAll/);
  assert.match(app, /amen-btn/);
  assert.match(app, /post-name anon-name/);
  assert.match(page, /data-filter="all">All/);
  assert.match(page, /data-filter="prayer">Requests/);
  assert.match(page, /data-filter="testimony">Testimonies/);
  assert.match(page, /data-filter="praise">Praise/);
});

test('carousel CSS/JS are cache-busted at versions that include them', () => {
  const stylesVersion = page.match(/\/lifegen\/styles\.css\?v=(\d+\.\d+\.\d+)/)?.[1];
  const appVersion = page.match(/\/lifegen\/app\.js\?v=(\d+\.\d+\.\d+)/)?.[1];
  assert.ok(stylesVersion && atLeast(stylesVersion, '2.4.21'), `styles.css?v=${stylesVersion} must be >= 2.4.21`);
  assert.ok(appVersion && atLeast(appVersion, '2.4.2'), `app.js?v=${appVersion} must be >= 2.4.2`);
  assert.equal(versions['/lifegen/styles.css'].version, stylesVersion, 'run: npm run assets:version');
  assert.equal(versions['/lifegen/app.js'].version, appVersion, 'run: npm run assets:version');
});
