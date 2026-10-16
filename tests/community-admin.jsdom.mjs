// Community board admin — browser-level (jsdom) checks.
//
// This file is NOT part of `npm test`: it needs the jsdom package, which is not
// a project dependency. Run it from a folder that has jsdom installed
// (npm install jsdom@30 --no-save):
//
//   node tests/community-admin.jsdom.mjs
//
// The admin portal is an ES-module app, so the harness imports the real
// public/admin/js/app.js entry into a jsdom document and stubs only the API
// answers. What gets exercised is the shipped UI: the Community board table,
// its filters and search, and the edit / hide / delete flows.
import { JSDOM, VirtualConsole } from 'jsdom';

process.on('uncaughtException', (e) => console.log('[uncaught]', String((e && e.stack) || e).split('\n')[0]));
process.on('unhandledRejection', (e) => console.log('[unhandled]', String((e && e.stack) || e).split('\n')[0]));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 1500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
  return fn();
};

// ---- fixture community posts ---------------------------------------------
const longText = 'Last month I asked the prayer wall to pray for my board exams. I passed. I want to give all the glory to God — He carried me through the review season and opened a door I never expected.';
let wallPosts = [
  { id: 5001, type: 'prayer', author: 'Ana', content: 'Please pray for my mother\u2019s recovery.', is_anonymous: false, is_hidden: false, created_at: '2026-10-13T01:00:00.000Z', prayer_count: 3 },
  { id: 5002, type: 'praise', author: null, content: 'God is good all the time!', is_anonymous: true, is_hidden: false, created_at: '2026-10-12T01:00:00.000Z', prayer_count: 1 },
  { id: 5003, type: 'testimony', author: 'Marco', content: longText, is_anonymous: false, is_hidden: false, created_at: '2026-10-11T01:00:00.000Z', prayer_count: 7 },
  { id: 5004, type: 'prayer', author: null, content: 'Please pray for our barangay health workers.', is_anonymous: true, is_hidden: true, created_at: '2026-10-10T01:00:00.000Z', prayer_count: 0 },
  { id: 5005, type: 'praise', author: 'Youth Group', content: 'Youth night was full! 24 teens, 3 first-timers.', is_anonymous: false, is_hidden: false, created_at: '2026-10-09T01:00:00.000Z', prayer_count: 2 },
];
const calls = [];
const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const apiFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost/');
  const path = url.pathname + url.search;
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path, method, body });
  if (path === '/api/auth/status') return jsonResponse({
    user: { id: 1, username: 'demo@lifegen.local', display_name: 'Demo Admin', role_id: 'admin', is_active: true, permissions: ['settings:manage', 'people:view', 'people:view_private', 'dashboard:view', 'registrations:manage'] },
    settings: { church_name: 'Lifegiver Church of Faith', service_name: 'Lifegen' },
    needs_setup: false, auth_disabled: false, standalone: false, preview: true, hosted_preview: false,
    deploy_helper_enabled: false, today: '2026-10-15',
  });
  if (path === '/api/auth/logout') return jsonResponse({});
  if (path === '/api/events') return jsonResponse({ revision: 1 });
  if (path === '/api/tracker/registrationCounts') return jsonResponse({ pending: 0 });
  if (path === '/api/tracker/postsAdmin') return jsonResponse(wallPosts.map((p) => ({ ...p })));
  if (path === '/api/tracker/editPost') {
    const [id, fields] = body.args;
    const p = wallPosts.find((x) => x.id === id);
    if (!p) return jsonResponse({ message: 'Post not found.' }, 404);
    Object.assign(p, {
      type: fields.type,
      content: fields.content,
      is_anonymous: !!fields.is_anonymous,
      author: fields.is_anonymous ? null : (fields.author || null),
    });
    return jsonResponse({ ...p });
  }
  if (path === '/api/tracker/moderatePost') {
    const [id, hidden] = body.args;
    const p = wallPosts.find((x) => x.id === id);
    if (!p) return jsonResponse({ message: 'Post not found.' }, 404);
    p.is_hidden = !!hidden;
    return jsonResponse({});
  }
  if (path === '/api/tracker/deletePost') {
    const [id] = body.args;
    const before = wallPosts.length;
    wallPosts = wallPosts.filter((x) => x.id !== id);
    return before === wallPosts.length ? jsonResponse({ message: 'Post not found.' }, 404) : jsonResponse({});
  }
  return jsonResponse({ ok: true });
};

// ---- jsdom + globals the module graph touches -----------------------------
const virtualConsole = new VirtualConsole();
const jsErrors = [];
virtualConsole.on('jsdomError', (e) => jsErrors.push(e.message));
virtualConsole.on('error', (m) => jsErrors.push(String(m)));

const dom = new JSDOM('<!doctype html><html><body><a id="skipLink" href="#main">Skip</a><div id="app"></div><div id="modalRoot"></div><div class="toasts" id="toastRoot"></div></body></html>', {
  url: 'http://localhost/#/community',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const doc = window.document;
globalThis.window = window;
globalThis.document = doc;
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.fetch = apiFetch;
// jsdom's FormData understands HTMLFormElement; Node's native one does not.
globalThis.FormData = window.FormData;
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const $ = (id) => doc.getElementById(id);
const qsa = (sel, root = doc) => [...root.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const rows = () => qsa('#cboardBody tbody tr');

// Boot the real admin app (module graph: app.js -> api.js, ui.js, views/*).
await import(new URL('../public/admin/js/app.js', import.meta.url));
await until(() => rows().length || doc.querySelector('#cboardBody .empty'));

section('THE COMMUNITY BOARD SECTION RENDERS');
{
  check('the sidebar links to the Community board', !!qsa('#nav a').find((a) => a.getAttribute('href') === '#/community'));
  check('the page is titled Community board', doc.querySelector('#main h1')?.textContent === 'Community board');
  check('every post is listed once', rows().length === 5, `got ${rows().length}`);
  check('long messages render in full, unclipped', doc.querySelector('#cboardBody').textContent.includes('opened a door I never expected'));
  check('anonymous posts are labelled', doc.querySelector('#cboardBody').textContent.includes('Anonymous'));
  check('hidden posts are marked', doc.querySelector('#cboardBody').textContent.includes('Hidden'));
  check('prayer reaction counts are shown', rows().some((r) => r.textContent.includes('7')));
  const tabs = qsa('#cboardTypes button');
  check('the type filters are All, Requests, Testimonies, Praise', tabs.map((t) => t.textContent.replace(/\d+$/, '')).join('|') === 'All|Requests|Testimonies|Praise');
  check('the filter counts are live', tabs[0].querySelector('.count')?.textContent === '5');
}

section('FILTERS AND SEARCH');
{
  click(qsa('#cboardTypes button').find((b) => b.dataset.type === 'prayer'));
  check('Requests shows only prayer posts', rows().length === 2 && rows().every((r) => r.textContent.includes('Prayer request')));
  click(qsa('#cboardTypes button').find((b) => b.dataset.type === 'all'));
  click(qsa('#cboardStatus button').find((b) => b.dataset.status === 'hidden'));
  check('the Hidden filter shows only hidden posts', rows().length === 1 && rows()[0].textContent.includes('health workers'));
  click(qsa('#cboardStatus button').find((b) => b.dataset.status === 'all'));
  type($('cboardQ'), 'board exams');
  await until(() => rows().length === 1, 800);
  check('search narrows the list to matching messages', rows().length === 1 && rows()[0].textContent.includes('board exams'));
  type($('cboardQ'), '');
  await until(() => rows().length === 5, 800);
  check('clearing search restores every post', rows().length === 5);
}

section('EDIT A POST');
{
  click(rows().find((r) => r.textContent.includes('God is good')).querySelector('[data-edit]'));
  await until(() => $('cbfText'));
  check('the edit dialog opens with the message', $('cbfText')?.value === 'God is good all the time!');
  check('the type is selected', $('cbfType')?.value === 'praise');
  check('anonymous is marked', $('cbfAnon')?.checked === true);
  type($('cbfText'), 'God is good — all the time, every day!');
  check('the character counter follows', $('cbfCount')?.textContent.startsWith(String('God is good — all the time, every day!'.length)));
  $('cbfAnon').checked = false;
  $('cbfAnon').dispatchEvent(new window.Event('change', { bubbles: true }));
  check('unticking anonymous enables the author field', $('cbfAuthor')?.disabled === false);
  type($('cbfAuthor'), 'Sister Grace');
  const save = doc.querySelector('#modalRoot [data-save]');
  click(save);
  await until(() => calls.some((c) => c.path === '/api/tracker/editPost'));
  const sent = calls.find((c) => c.path === '/api/tracker/editPost');
  check('saving sends the rewritten post', sent?.body?.args?.[1]?.content === 'God is good — all the time, every day!');
  check('saving sends the new author and visibility', sent?.body?.args?.[1]?.author === 'Sister Grace' && sent?.body?.args?.[1]?.is_anonymous === false);
  await until(() => doc.querySelector('#cboardBody').textContent.includes('Sister Grace'));
  check('the table refreshes with the edit', doc.querySelector('#cboardBody').textContent.includes('Sister Grace'));
  check('the dialog closed after saving', !$('cbfText'));
}

section('HIDE / SHOW A POST');
{
  click(rows().find((r) => r.textContent.includes('recovery')).querySelector('[data-hide]'));
  await until(() => calls.some((c) => c.path === '/api/tracker/moderatePost'));
  const sent = calls.find((c) => c.path === '/api/tracker/moderatePost');
  check('Hide sends the hide command', sent?.body?.args?.[1] === true);
  await until(() => rows().find((r) => r.textContent.includes('recovery'))?.textContent.includes('Hidden'));
  check('the row is now marked Hidden', rows().find((r) => r.textContent.includes('recovery'))?.textContent.includes('Hidden'));
  click(rows().find((r) => r.textContent.includes('recovery')).querySelector('[data-hide]'));
  await until(() => calls.filter((c) => c.path === '/api/tracker/moderatePost').length === 2);
  check('Hide turned into Show for hidden posts', calls.filter((c) => c.path === '/api/tracker/moderatePost')[1]?.body?.args?.[1] === false);
}

section('DELETE A POST (confirmed)');
{
  click(rows().find((r) => r.textContent.includes('Youth night')).querySelector('[data-del]'));
  await until(() => doc.querySelector('#modalRoot [data-ok]'));
  const dialogText = doc.querySelector('#modalRoot')?.textContent || '';
  check('the confirm dialog warns that deletion is permanent', dialogText.includes('cannot be undone'));
  check('the confirm dialog offers Delete post', doc.querySelector('#modalRoot [data-ok]')?.textContent.includes('Delete post'));
  click(doc.querySelector('#modalRoot [data-ok]'));
  await until(() => calls.some((c) => c.path === '/api/tracker/deletePost'));
  check('confirming sends the delete command', calls.find((c) => c.path === '/api/tracker/deletePost')?.body?.args?.[0] === 5005);
  await until(() => rows().length === 4);
  check('the deleted post is gone from the table', rows().length === 4 && !doc.querySelector('#cboardBody').textContent.includes('Youth night'));
}

section('PAGE HEALTH');
{
  const realErrors = jsErrors.filter((m) => !/fonts\.googleapis\.com|Could not load link/.test(m));
  check('no script errors while the section ran', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  window.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
