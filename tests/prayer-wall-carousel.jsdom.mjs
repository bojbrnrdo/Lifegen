// Prayer wall carousel — browser-level (jsdom) checks.
//
// This file is NOT part of `npm test`: it needs a running server and the jsdom
// package, which is not a project dependency. Run it from a folder that has
// jsdom installed (npm install jsdom@30 --no-save) with the site running locally:
//
//   node tests/prayer-wall-carousel.jsdom.mjs
//
// It fetches the real page and the real app.js/backend.js and stubs only the
// API answers, so the shipped UI code is what gets exercised: grouping posts
// per visible row, per-group height measurement on navigation, swipe/keyboard/
// dots browsing, filter re-chunking, and the Pray interaction.
import { JSDOM, VirtualConsole } from 'jsdom';

process.on('uncaughtException', (e) => console.log('[uncaught]', String((e && e.stack) || e).split('\n')[0]));
process.on('unhandledRejection', (e) => console.log('[unhandled]', String((e && e.stack) || e).split('\n')[0]));

const BASE = process.env.LIFEGEN_BASE_URL || 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page links Google Fonts; a sandboxed run has no internet, and jsdom would
// sit on that request for minutes. Only that one stylesheet link is dropped.
const html = (await (await fetch(BASE + '/')).text()).replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/g, '');
check('the served page has the community board carousel', html.includes('aria-roledescription="carousel"') && html.includes('id="wallStage"'));
check('the served page has browsing controls', html.includes('id="wallPrev"') && html.includes('id="wallNext"') && html.includes('id="wallDots"'));
check('the four filters are on the page', ['data-filter="all"', 'data-filter="prayer"', 'data-filter="testimony"', 'data-filter="praise"'].every(s => html.includes(s)));

// ---- fixture posts: deliberately short / medium / long messages -----------
const longText = 'Last month I asked the prayer wall to pray for my board exams. I passed. ' +
  'I want to give all the glory to God — He carried me through the review season when I wanted to give up, ' +
  'He gave me peace during the exam itself, and He opened a door I never expected. To everyone still waiting ' +
  'for an answer: keep praying, keep trusting. God\u2019s timing is perfect, and His faithfulness never runs out.';
const fixturePosts = [
  { id: 5001, type: 'prayer', author: 'Ana', is_anonymous: false, content: 'Please pray for my mother\u2019s recovery.', created_at: new Date(Date.now() - 6e5).toISOString(), prayer_count: 0, prayed: false },
  { id: 5002, type: 'praise', author: null, is_anonymous: true, content: 'God is good all the time!', created_at: new Date(Date.now() - 5e5).toISOString(), prayer_count: 2, prayed: false },
  { id: 5003, type: 'testimony', author: 'Marco', is_anonymous: false, content: longText, created_at: new Date(Date.now() - 4e5).toISOString(), prayer_count: 7, prayed: true },
  { id: 5004, type: 'prayer', author: 'Sis. Lorna', is_anonymous: false, content: 'Prayer for our barangay health workers — for strength, protection and wisdom.', created_at: new Date(Date.now() - 3e5).toISOString(), prayer_count: 0, prayed: false },
  { id: 5005, type: 'testimony', author: null, is_anonymous: true, content: 'My husband came back to church after 12 years.', created_at: new Date(Date.now() - 2e5).toISOString(), prayer_count: 1, prayed: false },
  { id: 5006, type: 'praise', author: 'Youth Group', is_anonymous: false, content: 'Youth night was full! 24 teens, 3 first-timers.', created_at: new Date(Date.now() - 1e5).toISOString(), prayer_count: 0, prayed: false },
  { id: 5007, type: 'prayer', author: 'Jun', is_anonymous: false, content: 'Pray for safe travels.', created_at: new Date().toISOString(), prayer_count: 0, prayed: false },
];
let wallPosts = fixturePosts.map(p => ({ ...p }));
const calls = [];
const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const apiFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, BASE);
  const path = url.pathname + url.search;
  calls.push({ path, method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
  if (path === '/api/public/posts' && (init.method || 'GET').toUpperCase() === 'POST') {
    const body = JSON.parse(init.body);
    const post = { id: 9000 + wallPosts.length, type: body.type, author: body.is_anonymous ? null : body.author, is_anonymous: !!body.is_anonymous, content: body.content, created_at: new Date().toISOString(), prayer_count: 0, prayed: false };
    wallPosts = [post, ...wallPosts];
    return jsonResponse(post, 201);
  }
  if (path === '/api/public/posts') return jsonResponse(wallPosts);
  const pray = path.match(/\/api\/public\/posts\/(\d+)\/pray$/);
  if (pray) {
    const p = wallPosts.find(x => String(x.id) === pray[1]);
    if (p) p.prayer_count += 1, p.prayed = true;
    return jsonResponse({ prayer_count: p ? p.prayer_count : 1 });
  }
  if (path.startsWith('/api/public/vip')) return jsonResponse({ vip: null, checkins: [], attendance: [], state: null });
  if (path === '/api/public/config') return jsonResponse({ server_time: new Date().toISOString(), legacy_restore_enabled: false, hosted_preview: false, preview: false, church_name: 'Lifegiver Church of Faith' });
  return jsonResponse({ ok: true, services: [], events: [], checkins: [], state: null });
};

// Controllable breakpoints: start at desktop (3 cards per group), then shrink.
const mqState = { '(min-width:1025px)': true, '(min-width:641px)': true };
const mqListeners = {};
const roCallbacks = [];

function prepare(window) {
  window.fetch = (input, init) => apiFetch(input, init);
  window.matchMedia = (q) => ({
    // Live MediaQueryList semantics: `matches` must track the current state.
    get matches() { return mqState[q] !== undefined ? mqState[q] : false; },
    media: q,
    addEventListener: (ev, fn) => { (mqListeners[q] ||= []).push(fn); },
    removeEventListener() {},
    addListener(fn) { (mqListeners[q] ||= []).push(fn); },
    removeListener() {}
  });
  window.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.ResizeObserver = class { constructor(cb) { roCallbacks.push(cb); } observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
  window.Element.prototype.scrollIntoView = function () {};
  if (!window.crypto?.randomUUID) window.crypto = { ...(window.crypto || {}), randomUUID: () => crypto.randomUUID(), getRandomValues: (a) => crypto.getRandomValues(a) };
}

const virtualConsole = new VirtualConsole();
const jsErrors = [];
virtualConsole.on('jsdomError', (e) => jsErrors.push(e.message));
virtualConsole.on('error', (m) => jsErrors.push(String(m)));

const dom = new JSDOM(html, {
  url: BASE + '/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) { prepare(window); },
});
const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const qsa = (sel, root = doc) => [...root.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const pointer = (el, type, x, y) => {
  const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  el.dispatchEvent(e);
};
const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const submit = (form) => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

// Wait until the deferred scripts have wired the page up and posts loaded.
for (let i = 0; i < 100 && !qsa('.wall-slide').length; i++) await sleep(50);
await sleep(150);

section('CONTENT-AWARE GROUPING (desktop: 3 cards per group)');
{
  const slides = qsa('.wall-slide');
  check('7 fixture posts chunk into 3 visible groups (3 / 3 / 1)', slides.length === 3, `got ${slides.length}`);
  check('group 1 holds the three newest posts', slides[0] && slides[0].querySelectorAll('.post').length === 3);
  check('group 3 holds the single leftover short post', slides[2] && slides[2].querySelectorAll('.post').length === 1);
  check('the long testimony is a full card, not clipped or truncated', (slides[0]?.textContent || '').includes('faithfulness never runs out'));
  check('anonymous posts still show the anonymous label', qsa('.anon-name').length >= 2);
  check('the counter starts on group 1 of 3', $('wallCounter').textContent === '1 / 3', $('wallCounter').textContent);
  check('previous is disabled at the start', $('wallPrev').disabled === true);
  check('each group is labelled for screen readers', slides.every((s, i) => s.getAttribute('aria-label') === `Group ${i + 1} of ${slides.length}`));
  check('only the active group is exposed to assistive tech', slides[0].getAttribute('aria-hidden') === 'false' && !slides[0].hasAttribute('inert') && slides[1].hasAttribute('inert') && slides[1].getAttribute('aria-hidden') === 'true');
}

section('GROUP HEIGHT FOLLOWS THE VISIBLE GROUP');
{
  // jsdom performs no layout, so give each group the height its tallest card
  // would produce: group 1 has the long testimony (420), group 2 is medium
  // (300), group 3 is one short card (180). The stage must track the ACTIVE
  // group only — never one wall-wide max height.
  const heights = [420, 300, 180];
  const slides = qsa('.wall-slide');
  slides.forEach((s, i) => s.getBoundingClientRect = () => ({ height: heights[i], width: 900, top: 0, left: 0, right: 900, bottom: heights[i] }));
  click($('wallNext')); await sleep(20);
  check('navigating re-measures the stage to the new group (420 -> 300)', $('wallStage').style.height === '300px', $('wallStage').style.height);
  check('the track slid to group 2', $('wallTrack').style.transform === 'translateX(-100%)', $('wallTrack').style.transform);
  click($('wallNext')); await sleep(20);
  check('a group of one short post stays compact (300 -> 180)', $('wallStage').style.height === '180px', $('wallStage').style.height);
  click($('wallPrev')); click($('wallPrev')); await sleep(20);
  check('returning restores the tall group height (-> 420)', $('wallStage').style.height === '420px', $('wallStage').style.height);
  // A content reflow (ResizeObserver) must re-measure without navigation.
  slides[0].getBoundingClientRect = () => ({ height: 500, width: 900, top: 0, left: 0, right: 900, bottom: 500 });
  roCallbacks.forEach(cb => cb([]));
  for (let i = 0; i < 20 && $('wallStage').style.height !== '500px'; i++) await sleep(10);
  check('a resized/re-flowed group is re-measured in place', $('wallStage').style.height === '500px', $('wallStage').style.height);
}

section('BROWSING CONTROLS, SWIPE AND KEYBOARD');
{
  key($('prayerWall'), 'ArrowRight'); await sleep(20);
  check('ArrowRight moves to the next group', $('wallCounter').textContent === '2 / 3', $('wallCounter').textContent);
  key($('prayerWall'), 'ArrowLeft'); await sleep(20);
  check('ArrowLeft moves back', $('wallCounter').textContent === '1 / 3', $('wallCounter').textContent);
  const dots = qsa('.wall-dot');
  check('one dot per group', dots.length === 3 && dots[0].getAttribute('aria-current') === 'true');
  click(dots[2]); await sleep(20);
  check('the dots jump to a chosen group', $('wallCounter').textContent === '3 / 3' && $('wallNext').disabled === true);
  click($('wallPrev')); // back to 2
  pointer($('wallStage'), 'pointerdown', 320, 400); pointer($('wallStage'), 'pointerup', 200, 405); await sleep(20);
  check('a left swipe advances the group', $('wallCounter').textContent === '3 / 3', $('wallCounter').textContent);
  pointer($('wallStage'), 'pointerdown', 200, 400); pointer($('wallStage'), 'pointerup', 330, 404); await sleep(20);
  check('a right swipe goes back', $('wallCounter').textContent === '2 / 3', $('wallCounter').textContent);
  // A swipe must not also click the card button underneath the finger.
  const before = calls.filter(c => /\/pray$/.test(c.path)).length;
  pointer($('wallStage'), 'pointerdown', 320, 400); pointer($('wallStage'), 'pointerup', 200, 405);
  click(qsa('.wall-slide')[1].querySelector('.amen-btn')); await sleep(20);
  check('the swipe gesture swallows the stray click on a card button', calls.filter(c => /\/pray$/.test(c.path)).length === before);
  const btn = qsa('.wall-slide')[1].querySelector('.amen-btn');
  click(btn); await sleep(30);
  check('the Pray button still works afterwards', btn.classList.contains('voted') && btn.querySelector('span').textContent === 'Amen' && btn.querySelector('b').textContent !== '0');
}

section('FILTERS RE-CHUNK THE GROUPS');
{
  click(qsa('.wf').find(b => b.dataset.filter === 'prayer')); await sleep(20);
  const slides = qsa('.wall-slide');
  check('Requests shows only prayer posts', slides.every(s => qsa('.post', s).every(p => p.dataset.type === 'prayer')) && qsa('.post').length === 3);
  check('a single visible group hides the browsing controls', $('wallControls').hidden === true);
  check('the Requests count matches', $('count-prayer').textContent === '3');
  click(qsa('.wf').find(b => b.dataset.filter === 'all')); await sleep(20);
  check('All brings every post back in 3 groups', qsa('.wall-slide').length === 3 && qsa('.post').length === 7);
  check('browsing controls return with multiple groups', $('wallControls').hidden === false);
}

section('RESPONSIVE RE-CHUNKING (tablet 2-up, phone 1-up)');
{
  mqState['(min-width:1025px)'] = false; mqState['(min-width:641px)'] = true;
  (mqListeners['(min-width:1025px)'] || []).forEach(fn => fn({ matches: false }));
  await sleep(400);
  check('tablet width re-chunks to 2 cards per group (4 groups)', qsa('.wall-slide').length === 4, `got ${qsa('.wall-slide').length}`);
  check('every tablet group holds 2 cards except the last', qsa('.wall-slide')[0].querySelectorAll('.post').length === 2 && qsa('.wall-slide')[3].querySelectorAll('.post').length === 1);
  mqState['(min-width:641px)'] = false;
  (mqListeners['(min-width:641px)'] || []).forEach(fn => fn({ matches: false }));
  await sleep(400);
  check('phone width re-chunks to 1 card per group (7 groups)', qsa('.wall-slide').length === 7, `got ${qsa('.wall-slide').length}`);
  key($('prayerWall'), 'End'); await sleep(20);
  check('End jumps to the last group on the phone layout', $('wallCounter').textContent === '7 / 7', $('wallCounter').textContent);
  // Back to desktop for the submit check.
  mqState['(min-width:1025px)'] = true;
  (mqListeners['(min-width:1025px)'] || []).forEach(fn => fn({ matches: true }));
  await sleep(400);
}

section('NEW SUBMISSION REJOINS THE BOARD');
{
  type($('pfText'), 'Please pray for our exam results tomorrow.');
  type($('pfName'), 'Tester');
  submit($('prayerForm')); await sleep(120);
  const first = qsa('.wall-slide')[0]?.querySelector('.post');
  check('the new post is on the board', (first?.textContent || '').includes('exam results tomorrow'));
  check('posting resets to the first group so the author sees it', $('wallCounter').textContent.startsWith('1 /'), $('wallCounter').textContent);
  check('the filter switched to the posted type', qsa('.wf').find(b => b.dataset.filter === 'prayer').classList.contains('active'));
}

section('PAGE HEALTH');
{
  const realErrors = jsErrors.filter((m) => !/fonts\.googleapis\.com|Could not load link/.test(m));
  check('no script errors while the board ran', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  window.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
