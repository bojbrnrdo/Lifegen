// Lifegroups — browser-level (jsdom) checks for the tabbed page.
//
// This file is NOT part of `npm test`: it needs jsdom, which is not a project
// dependency. Run it from a folder that has jsdom installed:
//
//   node tests/lifegroups-tabs.jsdom.mjs
//
// It imports the real public/admin/js/app.js into a jsdom document and stubs
// only the API answers, so what is exercised is the shipped UI: the section
// tabs, that only one section shows at a time, lazily drawn sections, keyboard
// navigation, the URL, and the headline numbers.
import { createRequire } from 'node:module';
// jsdom is not a project dependency, so resolve it from wherever it is
// installed (the usual place is a sibling folder such as ../jsdom-env).
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || '/home/user/jsdom-env/node_modules/jsdom');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(25); } return fn(); };
const jsonResponse = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

const networks = [
  { id: 1, name: 'Arsie Borromeo', leader_name: 'Arsie Borromeo', parent_network_id: null, gender: 'boys', is_active: true, child_count: 1 },
  { id: 2, name: 'Roxxane Network', leader_name: 'Roxxane Borromeo', parent_network_id: 1, gender: 'boys', is_active: true, child_count: 0, group_count: 6, people_count: 36 },
  { id: 3, name: 'Jane Borromeo', leader_name: 'Jane Borromeo', parent_network_id: null, gender: 'girls', is_active: true, child_count: 1 },
  { id: 4, name: 'Grace Network', leader_name: 'Grace Borromeo', parent_network_id: 3, gender: 'girls', is_active: true, child_count: 0, group_count: 6, people_count: 36 },
];
const groups = [
  { id: 10, name: 'Roxxane Network Leaders', leader_name: 'Roxxane Borromeo', network_id: 2, gender: 'boys', member_count: 6, is_active: true, leads_network: true },
  { id: 11, name: 'Kai Cell', leader_name: 'Kai Borromeo', network_id: 2, gender: 'boys', member_count: 6, is_active: true },
  { id: 20, name: 'Grace Network Leaders', leader_name: 'Grace Borromeo', network_id: 4, gender: 'girls', member_count: 6, is_active: true, leads_network: true },
  { id: 21, name: 'Mika Cell', leader_name: 'Mika Borromeo', network_id: 4, gender: 'girls', member_count: 6, is_active: true },
];
const peopleIndex = [
  { id: 100, first_name: 'Kai', last_name: 'Borromeo', cell_id: 11, cell_name: 'Kai Cell', network_id: 2, network_name: 'Roxxane Network', role: 'cell_leader', member_count: 6 },
];
const calls = [];
const apiFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost/');
  const path = url.pathname + url.search;
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path, body });
  if (path === '/api/auth/status') return jsonResponse({
    user: { id: 1, username: 'admin@x', display_name: 'Admin', role_id: 'admin', is_active: true,
      permissions: ['settings:manage', 'people:view', 'people:view_private', 'dashboard:view', 'lifegroups:view', 'lifegroups:manage', 'attendance:write'] },
    settings: { church_name: 'Lifegiver', service_name: 'Lifegen' }, needs_setup: false, auth_disabled: false,
    standalone: false, preview: true, hosted_preview: false, deploy_helper_enabled: false, today: '2026-11-16',
  });
  if (path === '/api/events') return jsonResponse({ revision: 1 });
  if (path === '/api/events/stream') return new Response('', { status: 204 });
  if (path === '/api/tracker/registrationCounts') return jsonResponse({ pending: 0 });
  if (path === '/api/tracker/leaderScope') return jsonResponse({ kind: 'admin', linked: false });
  if (path === '/api/tracker/lifegroups') return jsonResponse(groups);
  if (path === '/api/tracker/networks') return jsonResponse(networks);
  if (path === '/api/tracker/lifegroupPeopleIndex') return jsonResponse(peopleIndex);
  if (path === '/api/tracker/lifegroupNeeds') return jsonResponse([{ id: 7, first_name: 'Spare', last_name: 'Boy', person_code: 'P-7', status: 'member', sex: 'male' }]);
  if (path === '/api/tracker/progressOverview') return jsonResponse({ groups: [], summary: {} });
  if (path === '/api/tracker/people') return jsonResponse({ people: [], total: 0 });
  if (path === '/api/tracker/dashboard') return jsonResponse({ people: { total: 0 }, services_recorded: 0, today: '2026-11-16', latest: null });
  return jsonResponse({ message: 'not stubbed: ' + path }, 404);
};

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});
const dom = new JSDOM('<!doctype html><html><body><a id="skipLink" href="#main">Skip</a><div id="app"></div><div id="modalRoot"></div><div class="toasts" id="toastRoot"></div></body></html>',
  { url: 'http://localhost/#/lifegroups', pretendToBeVisual: true, virtualConsole });
const { window } = dom;
const doc = window.document;
for (const k of ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'MouseEvent']) globalThis[k] = window[k];
globalThis.location = window.location; globalThis.history = window.history;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.fetch = apiFetch;
window.EventSource = undefined; // force the polling fallback, which is easy to stop
globalThis.FormData = window.FormData;
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

// Resolve the shipped entry point by absolute path: jsdom-based suites are run
// from a folder that has jsdom installed, not from the repo root.
await import(new URL('../public/admin/js/app.js', import.meta.url).href);
const $ = (id) => doc.getElementById(id);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const visible = (el) => el && !el.hidden && el.offsetParent !== null || (el && !el.hidden);

console.log('\n=== the Lifegroups page loads its sections ===');
await until(() => doc.querySelector('.lifegroups-page'));
check('page rendered', Boolean(doc.querySelector('.lifegroups-page')));
check('title says Lifegroups', doc.querySelector('.lg-head h1')?.textContent.trim() === 'Lifegroups');
check('tab strip has 4 sections', doc.querySelectorAll('.lg-tabs__tab').length === 4,
  String(doc.querySelectorAll('.lg-tabs__tab').length));

console.log('\n=== one section at a time ===');
const panels = () => [...doc.querySelectorAll('.lg-panel')];
check('5 panels exist', panels().length === 4, String(panels().length));
check('exactly one panel visible', panels().filter((p) => !p.hidden).length === 1,
  panels().map((p) => `${p.id}:${p.hidden ? 'hidden' : 'shown'}`).join(' '));
check('the visible one is the directory', !$('lgPanel-directory').hidden);
check('selected tab matches the visible panel',
  doc.querySelector('.lg-tabs__tab[aria-selected="true"]')?.dataset.tab === 'directory');

console.log('\n=== switching sections actually swaps content ===');
click(doc.querySelector('.lg-tabs__tab[data-tab="find"]'));
await sleep(80);
check('Find panel now visible', !$('lgPanel-find').hidden);
check('Directory panel now hidden', $('lgPanel-directory').hidden);
check('the find box was drawn', Boolean(doc.querySelector('#findPersonQ')));
check('the tab is marked selected', doc.querySelector('.lg-tabs__tab[data-tab="find"]').getAttribute('aria-selected') === 'true');
check('the previously selected tab is not',
  doc.querySelector('.lg-tabs__tab[data-tab="directory"]').getAttribute('aria-selected') === 'false');

console.log('\n=== a section draws only when opened (lazy) ===');
const needsCallsBefore = calls.filter((c) => c.path === '/api/tracker/lifegroupNeeds').length;
check('needs not fetched before its tab is opened', needsCallsBefore === 0, String(needsCallsBefore));
click(doc.querySelector('.lg-tabs__tab[data-tab="needs"]'));
await until(() => calls.some((c) => c.path === '/api/tracker/lifegroupNeeds'));
check('opening the tab fetched the list', calls.some((c) => c.path === '/api/tracker/lifegroupNeeds'));
await sleep(120);
check('the list rendered', (doc.querySelector('#needsBody')?.textContent || '').includes('Spare'));

console.log('\n=== arrow keys move between tabs ===');
doc.querySelector('.lg-tabs__tab[data-tab="needs"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
await sleep(80);
const afterArrow = doc.querySelector('.lg-tabs__tab[aria-selected="true"]')?.dataset.tab;
check('ArrowRight advances to the next tab', afterArrow === 'people', String(afterArrow));

console.log('\n=== the URL remembers the section ===');
check('hash includes the open tab', window.location.hash.includes('tab=people'), window.location.hash);
check('the removed group-progress tab is not offered', !doc.querySelector('.lg-tabs__tab[data-tab="progress"]'));

console.log('\n=== numbers are on the page ===');
click(doc.querySelector('.lg-tabs__tab[data-tab="directory"]'));
await sleep(200);
const nums = $('treeSummary');
check('numbers rendered', Boolean(nums) && nums.querySelectorAll('.lifegroups-page__number').length >= 3,
  nums ? String(nums.querySelectorAll('.lifegroups-page__number').length) : 'missing');
const values = [...(nums?.querySelectorAll('.lifegroups-page__number-value') || [])].map((e) => e.textContent.trim());
check('numbers are real values, not "Loading…"', values.every((v) => v !== 'Loading…'), values.join(','));
check('Cell Leaders count is 2 (one per Network)', values.includes('2'), values.join(','));
check('People in Cells counts all 4 Cells x 6 = 24', values.includes('24'), values.join(','));

console.log('\n=== the header stays short ===');
const head = doc.querySelector('.lg-head');
check('header has only the title block and Add New', head?.children.length === 2, String(head?.children.length));
check('no leftover always-open panels', !doc.querySelector('#allPeoplePanel, #needsPanel, #lgPanel-progress'));
check('the glossary is collapsed by default', doc.querySelector('.lg-about') && !doc.querySelector('.lg-about').open);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

process.exit(fail ? 1 : 0);
