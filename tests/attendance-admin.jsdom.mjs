// Service Attendance — browser-level (jsdom) checks.
//
// NOT part of `npm test`: it needs the jsdom package, which is not a project
// dependency. Run it from a folder that has jsdom installed:
//
//   npm install jsdom@30 --no-save
//   node tests/attendance-admin.jsdom.mjs
//
// The admin portal is an ES-module app, so this imports the real
// public/admin/js/app.js into a jsdom document and stubs only the API answers.
// What is exercised is the shipped UI: the Sunday picker, the roll call, the
// headcount, the VIP follow-up, the month report, the history sheet and the
// walk-in check-in.
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
const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(15); }
  return fn();
};

// ---- fixture: one Sunday of the register ----------------------------------
const SUNDAYS = ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29'];
const PEOPLE = [
  // id, name, category, present, extra
  [1, 'Maria Santos', 'member', false, { lifegroup_name: 'Girls · Central', status: 'member' }],
  [2, 'Jose Bautista', 'member', true, { lifegroup_name: 'Boys · North', status: 'member', present_source: 'roster', marked_by_name: 'Demo Admin' }],
  [3, 'Ana Reyes', 'vip', true, { present_source: 'vip_checkin', vip_sundays: 1, first_timer: false, inviter: 'Maria' }],
  [4, 'Mark Dela Cruz', 'vip', true, { present_source: 'vip_checkin', vip_sundays: 4, first_timer: false, inviter: 'Zxai' }],
  [5, 'Grace Lim', 'vip', false, { vip_sundays: 0, first_timer: true, inviter: 'Joy' }],
];
const history = { 3: ['2026-11-15', '2026-11-22'], 4: ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22'], 5: [] };

let headcount = 12;
let date = '2026-11-22';
let categoryOverrides = {};
const calls = [];
const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const register = () => ({
  date,
  month: date.slice(0, 7),
  sundays: SUNDAYS,
  today: '2026-11-25',
  is_future: false,
  headcount,
  tokens_given: 1,
  // Every Sunday of the month per person — the register carries it so the page
  // never asks for a profile per VIP.
  month_attendance: Object.fromEntries(Object.entries(history).filter(([, v]) => v.length).map(([k, v]) => [k, [...v]])),
  items: PEOPLE.map(([person_id, full_name, category, present, extra]) => ({
    person_id, person_code: `LG-2026-000${person_id}`, full_name, status: 'member', sex: null,
    category: categoryOverrides[person_id] || category,
    category_source: categoryOverrides[person_id] ? 'override' : 'record',
    stored_category: category,
    present, present_source: present ? (extra.present_source || 'roster') : null,
    first_timer: Boolean(extra.first_timer), vip_sundays: extra.vip_sundays || 0, gift_ready: false,
    lifegroup_id: extra.lifegroup_name ? 7 : null, lifegroup_name: extra.lifegroup_name || null,
    last_seen: null, marked_by_name: extra.marked_by_name || null, marked_at: null,
    inviter: extra.inviter || null,
  })),
});

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
    deploy_helper_enabled: false, today: '2026-11-25',
  });
  if (path === '/api/auth/logout') return jsonResponse({});
  if (path === '/api/events') return jsonResponse({ revision: 1 });
  if (path === '/api/tracker/registrationCounts') return jsonResponse({ pending: 0 });
  if (path === '/api/tracker/serviceAttendance') {
    const [wanted] = body.args;
    if (wanted) date = wanted;
    return jsonResponse(register());
  }
  if (path === '/api/tracker/serviceAttendanceReport') {
    return jsonResponse({
      month: '2026-11', today: '2026-11-25',
      sundays: [
        { date: '2026-11-01', members: 0, vips: 19, headcount: 0, total: 19, held: true, future: false, today: false },
        { date: '2026-11-08', members: 1, vips: 22, headcount: 0, total: 23, held: true, future: false, today: false },
        { date: '2026-11-15', members: 1, vips: 23, headcount: 5, total: 29, held: true, future: false, today: false },
        { date: '2026-11-22', members: 2, vips: 2, headcount: 12, total: 16, held: true, future: false, today: false },
        { date: '2026-11-29', members: 0, vips: 0, headcount: 0, total: 0, held: false, future: true, today: false },
      ],
      totals: { services: 4, members: 4, vips: 66, headcount: 17, total: 87, average: 22, best: { date: '2026-11-15', total: 29 } },
    });
  }
  if (path === '/api/tracker/serviceAttendanceUnrecorded') {
    return jsonResponse({ items: [
      { date: '2026-11-08', recorded: true, today: false, future: false },
      { date: '2026-11-15', recorded: false, today: false, future: false },
      { date: '2026-11-22', recorded: true, today: false, future: false },
    ] });
  }
  if (path === '/api/tracker/setServiceAttendance') {
    const [d, personId, present] = body.args;
    if (d) date = d;
    const p = PEOPLE.find((x) => x[0] === personId);
    if (p) p[3] = Boolean(present);
    else {
      // a walk-in that was just created by addServiceAttendancePerson
      const added = PEOPLE.find((x) => x[0] === personId);
      if (!added) PEOPLE.push([personId, 'Juan Walkin', 'vip', Boolean(present), { first_timer: true }]);
    }
    const row = PEOPLE.find((x) => x[0] === personId);
    if (row) row[3] = Boolean(present);
    return jsonResponse({ person_id: personId, present: Boolean(present), register: register() });
  }
  if (path === '/api/tracker/setServiceAttendanceCategory') {
    const [, personId, category] = body.args;
    if (category) categoryOverrides[personId] = category; else delete categoryOverrides[personId];
    return jsonResponse({ person_id: personId, category, register: register() });
  }
  if (path === '/api/tracker/setServiceHeadcount') {
    headcount = Number(body.args[1]) || 0;
    return jsonResponse({ headcount, register: register() });
  }
  if (path === '/api/tracker/addServiceAttendancePerson') {
    const [, name, category] = body.args;
    const id = 90 + PEOPLE.length;
    PEOPLE.push([id, name, category === 'member' ? 'member' : 'vip', true, { first_timer: category !== 'member' }]);
    return jsonResponse({ person_id: id, person_code: 'LG-2026-0099', full_name: name, category, registration_id: 900, register: register() });
  }
  if (path.startsWith('/api/tracker/person')) {
    const id = Number(body.args[0]);
    const p = PEOPLE.find((x) => x[0] === id);
    return jsonResponse({
      id, full_name: p ? p[1] : 'Unknown', person_code: `LG-2026-000${id}`, status: 'member',
      history: (history[id] || []).map((d) => ({ service_date: d, status: 'present' })),
    });
  }
  if (path === '/api/tracker/search') {
    const [q] = body.args;
    const found = PEOPLE.filter((p) => p[1].toLowerCase().includes(String(q).toLowerCase()))
      .map(([id, full_name, , , extra]) => ({ id, full_name, person_code: `LG-2026-000${id}`, status: extra.status || 'member' }));
    return jsonResponse({ people: found });
  }
  return jsonResponse({ ok: true });
};

// ---- jsdom + the globals the module graph touches -------------------------
const virtualConsole = new VirtualConsole();
const jsErrors = [];
virtualConsole.on('jsdomError', (e) => jsErrors.push(e.message));
virtualConsole.on('error', (m) => jsErrors.push(String(m)));

const dom = new JSDOM('<!doctype html><html><body><a id="skipLink" href="#main">Skip</a><div id="app"></div><div id="modalRoot"></div><div class="toasts" id="toastRoot"></div></body></html>', {
  url: 'http://localhost/#/attendance',
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
globalThis.FormData = window.FormData;
globalThis.navigator.clipboard = { writeText: async () => {} };
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const $ = (id) => doc.getElementById(id);
const qsa = (sel, root = doc) => [...root.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const rows = () => qsa('#saList .sa-row');
// The 300ms debounce in ui.js uses setTimeout; keep the handlers instant.
globalThis.setTimeout = ((real) => (fn, ms, ...a) => real(fn, ms >= 200 ? 0 : ms, ...a))(globalThis.setTimeout);
const text = (sel) => doc.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';

// Boot the real admin app.
await import(new URL('../public/admin/js/app.js', import.meta.url));
await until(() => rows().length || doc.querySelector('#saList .empty'));

section('THE PAGE RENDERS IN THE ADMIN SHELL');
{
  check('the sidebar links to Attendance', !!qsa('#nav a').find((a) => a.getAttribute('href') === '#/attendance'));
  check('the nav entry is marked current', doc.querySelector('#nav a[data-nav="attendance"]')?.classList.contains('active'));
  check('the page is titled Service Attendance', text('#main h1') === 'Service Attendance');
  check('the Sunday is shown like the door sheet', text('#saDateLabel') === 'Sun, Nov 22, 2026', text('#saDateLabel'));
  check('the date input carries the Sunday', $('saDateInput').value === '2026-11-22');
  check('the headcount is loaded and saved', $('saHcInput').value === '12');
  check('the roll call lists everyone', rows().length === 5, `got ${rows().length}`);
  check('the totals ring is drawn', !!doc.querySelector('.sa-ring__ring'));
  check('the totals add up: 3 present + 12 headcount', text('#saHero .sa-ring__center b') === '15', text('#saHero .sa-ring__center b'));
  check('the legend splits members and both VIP groups', text('#saHero .sa-legend').includes('VIPs · first timers') && text('#saHero .sa-legend').includes('VIPs · returning'));
  check('the "not marked in" count is honest', text('.sa-listbar').includes('2 not marked in yet'), text('.sa-listbar'));
  check('the tabs sit directly under the chips', !!doc.querySelector('#saChips + #saTabs'));
  check('the follow-up queue is titled like the door sheet', text('#saFollowup .sa-h2').includes('Follow-up queue · 48 hrs'), text('#saFollowup .sa-h2'));
  check('the follow-up bars name the four Sundays', text('#saFollowup .sa-steps').includes('1st Sunday') && text('#saFollowup .sa-steps').includes('4th Sunday'), text('#saFollowup .sa-steps'));
  check('a token already given is counted', text('#saChips').includes('Tokens given') && text('#saChips').includes('1'), text('#saChips'));
  check('a person shows who invited them', /Invited by (Zxai|Maria|Joy)/.test(text('#saList')), text('#saList'));
}

section('MARKING PEOPLE PRESENT');
{
  const maria = rows().find((r) => r.textContent.includes('Maria Santos'));
  const btn = maria.querySelector('[data-sa-toggle]');
  check('an absent person shows an unticked button', btn.getAttribute('aria-pressed') === 'false');
  click(btn);
  await until(() => calls.some((c) => c.path === '/api/tracker/setServiceAttendance' && c.body.args[1] === 1));
  await until(() => rows().find((r) => r.textContent.includes('Maria Santos'))?.classList.contains('is-present'));
  check('one tap marks the person present', rows().find((r) => r.textContent.includes('Maria Santos')).classList.contains('is-present'));
  const tap = calls.filter((c) => c.path === '/api/tracker/setServiceAttendance').at(-1);
  check('the call carries the Sunday, the person and the state', JSON.stringify(tap?.body?.args) === '["2026-11-22",1,true]', JSON.stringify(tap?.body?.args));
  const again = rows().find((r) => r.textContent.includes('Maria Santos')).querySelector('[data-sa-toggle]');
  click(again);
  await until(() => !rows().find((r) => r.textContent.includes('Maria Santos'))?.classList.contains('is-present'));
  check('tapping again marks them not in', !rows().find((r) => r.textContent.includes('Maria Santos')).classList.contains('is-present'));
  const vip = rows().find((r) => r.textContent.includes('Ana Reyes'));
  check('a VIP shows the VIP check-in as the source', vip.textContent.includes('VIP check-in'));
}

section('FILTERS AND SEARCH');
{
  click(qsa('#saTabs button').find((b) => b.dataset.saTab === 'member'));
  check('Members shows only members', rows().length === 2 && rows().every((r) => r.textContent.includes('Member')));
  click(qsa('#saTabs button').find((b) => b.dataset.saTab === 'vip'));
  check('VIPs shows only VIPs', rows().length === 3 && rows().every((r) => r.textContent.includes('VIP') || r.textContent.includes('First timer')));
  click(qsa('#saTabs button').find((b) => b.dataset.saTab === 'absent'));
  check('Not yet in shows only the missing', rows().length === 2 && rows().every((r) => !r.classList.contains('is-present')), `got ${rows().length}`);
  click(qsa('#saTabs button').find((b) => b.dataset.saTab === 'all'));
  type($('saSearch'), 'grace');
  await until(() => rows().length === 1, 800);
  check('search narrows the roll call', rows().length === 1 && rows()[0].textContent.includes('Grace Lim'));
  type($('saSearch'), '');
  await until(() => rows().length === 5, 800);
  check('clearing search restores the roll call', rows().length === 5);
}

section('HEADCOUNT');
{
  click($('saHcPlus'));
  await until(() => calls.some((c) => c.path === '/api/tracker/setServiceHeadcount'));
  check('plus saves the new headcount', $('saHcInput').value === '13');
  check('the save carries the Sunday and the number', JSON.stringify(calls.filter((c) => c.path === '/api/tracker/setServiceHeadcount').at(-1).body.args) === '["2026-11-22",13]', JSON.stringify(calls.filter((c) => c.path === '/api/tracker/setServiceHeadcount').at(-1).body.args));
  await until(() => text('#saHero .sa-ring__center b') === '16');
  check('the total follows the headcount', text('#saHero .sa-ring__center b') === '16', text('#saHero .sa-ring__center b'));
  click($('saHcMinus'));
  await until(() => $('saHcInput').value === '12');
  check('minus goes back down', $('saHcInput').value === '12');
}

section('VIP FOLLOW-UP AND HISTORY');
{
  check('the follow-up lists the VIPs', qsa('#saFollowupBody .sa-fu').length === 3, `got ${qsa('#saFollowupBody .sa-fu').length}`);
  check('someone on four in a row is ready for a token', !!doc.querySelector('#saFollowupBody .sa-fu.is-ready'));
  check('the ready card says what happens next', text('#saFollowupBody').includes('Ready to become a Member and receive a token'));
  const grace = text('#saFollowupBody');
  check('a first timer shows how many Sundays are left', /more in a row for the token/.test(grace));
  click(rows().find((r) => r.textContent.includes('Mark Dela Cruz')).querySelector('[data-sa-history]'));
  await until(() => doc.querySelector('#modalRoot .sa-hist'));
  check('the history sheet opens for that person', text('#modalRoot .modal__header').includes('Mark Dela Cruz'));
  check('it lists the Sundays of the month', qsa('#modalRoot .sa-hist').length === SUNDAYS.length, `got ${qsa('#modalRoot .sa-hist').length}`);
  check('attended Sundays read Present', qsa('#modalRoot .sa-hist.is-on').length === 4);
  check('the sheet can count the Sunday either way', !!doc.querySelector('#modalRoot [data-sa-cat]'));
  const close = doc.querySelector('#modalRoot [data-sa-close]');
  click(close);
  await until(() => !doc.querySelector('#modalRoot .sa-hist'));
  check('the sheet closes again', !doc.querySelector('#modalRoot .sa-hist'));
}

section('COUNTING A VIP AS A MEMBER FOR ONE SUNDAY');
{
  click(rows().find((r) => r.textContent.includes('Ana Reyes')).querySelector('[data-sa-history]'));
  await until(() => doc.querySelector('#modalRoot [data-sa-cat]'));
  const sel = doc.querySelector('#modalRoot [data-sa-cat]');
  sel.value = 'member';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await until(() => calls.some((c) => c.path === '/api/tracker/setServiceAttendanceCategory'));
  const sent = calls.filter((c) => c.path === '/api/tracker/setServiceAttendanceCategory').at(-1);
  check('the sheet sends the Sunday, the person and the category', JSON.stringify(sent?.body?.args) === '["2026-11-22",3,"member"]', JSON.stringify(sent?.body?.args));
  await until(() => text('#saHero .sa-legend').startsWith('2') || rows().some((r) => r.textContent.includes('Member')));
  check('the totals move with the category', text('#saHero .sa-legend').includes('2'), text('#saHero .sa-legend'));
  // put her back, so the rest of the run sees the fixture it expects
  await (await import('../public/admin/js/api.js')).api.setServiceAttendanceCategory('2026-11-22', 3, null);
  delete categoryOverrides[3];
  click($('saRefresh'));
  await until(() => text('#saHero .sa-legend').includes('1'), 1500);
}

section('MONTH REPORT');
{
  check('the report has a row per Sunday', qsa('#saReportBody tbody tr').length === 5, `got ${qsa('#saReportBody tbody tr').length}`);
  check('the futures Sunday is marked as upcoming or empty', text('#saReportBody').includes('upcoming'));
  check('a Sunday with attendance can be opened', qsa('#saReportBody [data-sa-open]').length === 4);
  check('the month totals are shown', text('#saReportBody tfoot').includes('87'), text('#saReportBody tfoot'));
  click(qsa('#saReportBody [data-sa-open]')[0]);
  await until(() => date === '2026-11-01');
  check('opening a Sunday loads that Sunday', date === '2026-11-01');
  check('it re-reads the register from the server', calls.filter((c) => c.path === '/api/tracker/serviceAttendance').at(-1).body.args[0] === '2026-11-01');
}

section('SUNDAY NAVIGATION AND MISSED SUNDAYS');
{
  click($('saToday'));
  await until(() => date === '2026-11-22');
  check('Today returns to the current Sunday', date === '2026-11-22');
  click($('saPrev'));
  await until(() => date === '2026-11-15');
  check('previous Sunday steps back one week', date === '2026-11-15');
  click($('saNext'));
  await until(() => date === '2026-11-22');
  check('next Sunday steps forward', date === '2026-11-22');
  await until(() => text('#saUnrecorded').length > 0);
  check('a Sunday with no attendance is flagged', text('#saUnrecorded').includes('no attendance at all'), text('#saUnrecorded'));
}

section('CHECK IN A WALK-IN');
{
  click($('saAdd'));
  await until(() => $('saNewName'));
  check('the check-in sheet opens', !!$('saNewName'));
  type($('saNewName'), 'Jose');
  await until(() => doc.querySelector('#saMatches .sa-match'));
  check('an existing person is matched by name', !!doc.querySelector('#saMatches .sa-match'));
  click(doc.querySelector('#saMatches .sa-match'));
  await until(() => $('saNewName').value === 'Jose Bautista');
  check('picking the match fills the name', $('saNewName').value === 'Jose Bautista');
  check('the new-person note explains the existing record is reused', text('#saAddNote').includes('existing Person record'));
  check('the roll-call category is locked for an existing person', $('saNewCategory').disabled === true);
  type($('saNewName'), 'Juan Walkin');
  check('editing the name clears the earlier match', $('saNewCategory').disabled === false && !doc.querySelector('#saMatches .is-picked'));
  const before = calls.filter((c) => c.path === '/api/tracker/addServiceAttendancePerson').length;
  click($('saAddSave'));
  await until(() => calls.filter((c) => c.path === '/api/tracker/addServiceAttendancePerson').length > before);
  const saved = calls.filter((c) => c.path === '/api/tracker/addServiceAttendancePerson').at(-1);
  check('a new name is registered and checked in for the Sunday', JSON.stringify(saved?.body?.args?.slice(0, 3)) === '["2026-11-22","Juan Walkin","vip"]', JSON.stringify(saved?.body?.args));
  await until(() => rows().some((r) => r.textContent.includes('Juan Walkin')));
  check('the walk-in appears in the roll call', rows().some((r) => r.textContent.includes('Juan Walkin')));
}

section('MARK EVERYONE LISTED IN');
{
  click($('saMarkAll'));
  await until(() => doc.querySelector('#modalRoot .modal__header'));
  check('a confirmation names how many will be marked', /Mark \d+ (person|people) present\?/.test(text('#modalRoot .modal__header')), text('#modalRoot .modal__header'));
  const before = calls.filter((c) => c.path === '/api/tracker/setServiceAttendance').length;
  click(doc.querySelector('#modalRoot [data-sa-yes]'));
  await until(() => calls.filter((c) => c.path === '/api/tracker/setServiceAttendance').length > before);
  check('confirming marks the people who were missing', calls.filter((c) => c.path === '/api/tracker/setServiceAttendance').length > before);
}

section('READ-ONLY ROLES');
{
  // A viewer keeps the register but loses every control that would fail.
  const viewSource = await import('node:fs').then((fs) => fs.readFileSync(new URL('../public/admin/js/views/attendance.js', import.meta.url), 'utf8'));
  check('the page checks the write permission once', viewSource.includes("const writable = () => can('registrations:manage')"));
  check('the tap target is disabled without it', /disabled \? 'disabled'/.test(viewSource));
  check('the page says so plainly', viewSource.includes('Read-only: your role can see attendance but not record it.'));
}

section('NO BROWSER ERRORS');
{
  check('jsdom reported no errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
window.close();
// jsdom keeps the live-update EventSource alive; exit explicitly like the
// other browser-level harness in this folder does.
process.exit(fail ? 1 : 0);
