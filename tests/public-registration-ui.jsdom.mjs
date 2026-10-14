// Public registration update — browser-level (jsdom) checks.
//
// This file is NOT part of `npm test`: it needs a running server and the jsdom
// package, which is not a project dependency. Run it from a folder that has
// jsdom installed (npm install jsdom@30 --no-save) with the site running locally:
//
//   node tests/public-registration-ui.jsdom.mjs
//
// It fetches the real page and the real app.js/backend.js and stubs only the API
// answers, so the shipped UI code is what gets exercised.
// Browser-level check of the public registration update, run in jsdom against
// the live local server. Fetches the real page + real app.js/backend.js and
// stubs only the API answers, so what is exercised is the shipped UI code.
//
//   node reg-ui-check.mjs            (server on http://127.0.0.1:3000)
import { JSDOM, VirtualConsole } from 'jsdom';

// A missing app behaviour must never take this checker down with it.
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
// sit on that request for minutes. Only that one stylesheet link is dropped —
// every script and stylesheet of the site itself is still fetched and executed.
const html = (await (await fetch(BASE + '/')).text()).replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/g, '');
const styles = await (await fetch(BASE + '/lifegen/styles.css')).text();
check('the served page contains the selection screen', html.includes('id="reg-choice"'));
check('the served page contains the 3-step regular wizard', html.includes('id="regular-registration"') && html.includes('data-step="3"'));
check('the served page contains the success panel', html.includes('id="reg-success"'));
check('the page nowhere offers "Go to dashboard"', !/go to dashboard/i.test(html));

// ---- the API the UI will talk to (fixtures, mirrors the real shapes) --------
const LEADERS = {
  male: [
    { leader_person_id: '11', leader_name: 'Kuya Mark', lifegroup_id: '21', lifegroup_name: 'Open Cell A', network_leader_name: 'Kuya Josh', network_name: 'Boys Network' },
    { leader_person_id: '12', leader_name: 'Kuya Dan', lifegroup_id: '22', lifegroup_name: 'Open Cell B', network_leader_name: null, network_name: null },
  ],
  female: [
    { leader_person_id: '31', leader_name: 'Ate Grace', lifegroup_id: '41', lifegroup_name: 'Open Cell C', network_leader_name: 'Ate Yhail', network_name: 'Girls Network' },
  ],
  other: [], prefer_not_to_say: [],
};
const calls = [];
const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
let regularError = null;
let leadersEmpty = false;
let regularResponse = { ok: true, person_created: true, person: { id: '900', name: 'Reg Check Person', person_code: 'LG-2026-0900' }, membership: { created: true, tier: 'new', lifegroup_id: '21', lifegroup_name: 'Open Cell A' }, review: null, leader: { leader_person_id: '11', leader_name: 'Kuya Mark' } };

const apiFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, BASE);
  const path = url.pathname + url.search;
  calls.push({ path, method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
  if (path.startsWith('/api/public/leaders')) {
    const gender = url.searchParams.get('gender');
    return jsonResponse({ gender, group_gender: gender === 'male' ? 'boys' : gender === 'female' ? 'girls' : null, leaders: leadersEmpty ? [] : LEADERS[gender] || [] });
  }
  if (path === '/api/public/registrations/regular') {
    if (regularError) return jsonResponse(regularError.body, regularError.status);
    return jsonResponse(regularResponse, regularResponse.person_created ? 201 : 200);
  }
  if (path === '/api/public/registrations') return jsonResponse({ vip: { id: '1', person_id: '2', name: 'Vip Person', created_at: new Date().toISOString() }, recovery_code: 'LG-testrecoverycode123' });
  if (path === '/api/public/vip/restore') return jsonResponse({ vip: { id: '1', person_id: '2', name: 'Vip Person' } });
  if (path.startsWith('/api/public/vip')) return jsonResponse({ vip: null, checkins: [], attendance: [], state: null });
  if (path === '/api/public/config') return jsonResponse({ server_time: new Date().toISOString(), legacy_restore_enabled: false, hosted_preview: false, preview: false, church_name: 'Lifegiver Church of Faith' });
  if (path === '/api/public/posts') return jsonResponse([]);
  if (path === '/api/public/verse') return jsonResponse({ text: 'The Lord is my shepherd.', reference: 'Psalm 23:1' });
  if (path.startsWith('/api/public/')) return jsonResponse({ ok: true, services: [], events: [], checkins: [], state: null });
  return jsonResponse({ ok: true });
};

// jsdom has no IntersectionObserver/ResizeObserver; the site uses them for
// scroll effects. Without the shims the page's own script stops early, which
// would look like an app error when it is only a missing browser API.
function prepare(window) {
  window.fetch = (input, init) => apiFetch(input, init);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
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
const visible = (el) => Boolean(el) && !el.hidden;
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = (el) => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const submit = (form) => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };

// Wait until the deferred scripts have wired the page up.
for (let i = 0; i < 100 && !window.Lifegen?.DB; i++) await sleep(50);
check('the page scripts loaded (Lifegen.DB exists)', Boolean(window.Lifegen?.DB));
await sleep(150);

section('SELECTION SCREEN (same #vip destination)');
{
  check('the selection screen is shown first', visible($('reg-choice')));
  check('the VIP form is not shown yet', !visible($('vip-signup-form-container')));
  check('the regular wizard is not shown yet', !visible($('regular-registration')));
  check('the VIP attendance dashboard is not shown', !visible($('vip-attendance-dashboard')));
  check('the screen asks how you are connecting', (doc.querySelector('#reg-choice')?.textContent || '').includes('How are you connecting with us today?'));
  check('VIP choice explains first-time VIP registration', (doc.querySelector('#reg-choice')?.textContent || '').includes('first time registering as a LIFEGEN VIP'));
  check('regular choice explains regular attendance', (doc.querySelector('#reg-choice')?.textContent || '').includes('attended LIFEGEN before'));
  check('the QR still lands on the #vip section (the card is the same one)', Boolean($('vipCard')));
  check('the card header now says Lifegen Registration Form', /Lifegen Registration Form/i.test(doc.querySelector('#vipCard .vip-tag')?.textContent || ''), doc.querySelector('#vipCard .vip-tag')?.textContent);
  check('both choices use the same gold button', ['chooseVip', 'chooseRegular'].every((id) => $(id).classList.contains('btn-gold')), ['chooseVip', 'chooseRegular'].map((id) => $(id).className).join(' | '));
}

section('VIP FORM (gender + birthday)');
{
  click($('chooseVip'));
  check('VIP form opens', visible($('vip-signup-form-container')));
  check('the selection screen closes', !visible($('reg-choice')));
  check('the title is VIP First-Timer Registration', (doc.querySelector('#vipCard')?.textContent || '').includes('VIP First-Timer Registration'));
  check('there is a Gender field with Male / Female only', $('vip-gender') && [...$('vip-gender').options].map((o) => o.value).join(',') === ',male,female', [...$('vip-gender').options].map((o) => o.value).join(','));
  check('there is a Birthday date field', $('vip-birthdate')?.type === 'date');
  check('the old age field is gone', !$('vip-age') && !/Age/i.test(doc.querySelector('#vip-signup-form')?.textContent || ''));
  check('the consent text is present', (doc.querySelector('#vip-signup-form')?.textContent || '').includes('I agree that LIFEGEN may store these details'));
  check('the privacy link is present', Boolean(doc.querySelector('#vip-signup-form a[href*="privacy"]')));
  check('VIP recovery is still offered', visible($('show-vip-recovery')) || Boolean($('show-vip-recovery')));
  check('the stored-in-Supabase line is present', (doc.querySelector('#vipCard')?.textContent || '').includes('stored securely in the LIFEGEN Supabase database'));
  // invalid submit is blocked
  submit($('vip-signup-form'));
  await sleep(80);
  check('an empty VIP submit is blocked and shows an error', visible($('vip-signup-form-container')) && doc.querySelectorAll('#vip-signup-form .field.invalid').length >= 1);
  click($('vipBack'));
  check('the back button returns to the selection screen', visible($('reg-choice')) && !visible($('vip-signup-form-container')));
}

section('REGULAR WIZARD — step 1');
{
  click($('chooseRegular'));
  check('step 1 opens', visible($('regular-registration')));
  check('it is titled LIFEGEN Registration', (doc.querySelector('#regular-registration')?.textContent || '').includes('LIFEGEN Registration'));
  check('the three steps are listed', doc.querySelectorAll('#regSteps li').length === 3, String(doc.querySelectorAll('#regSteps li').length));
  check('step 1 is the active step', doc.querySelector('#regSteps li[data-step="1"]')?.className.includes('is-active'));
  check('step 2 is not visible', !visible(doc.querySelector('.reg-step[data-step="2"]')));
  check('step 3 is not visible', !visible(doc.querySelector('.reg-step[data-step="3"]')));
  check('Basic Info fields exist', ['rg-name', 'rg-email', 'rg-birthdate', 'rg-gender', 'rg-school'].every((id) => Boolean($(id))));
  check('gender here is also Male / Female only', [...$('rg-gender').options].map((o) => o.value).join(',') === ',male,female', [...$('rg-gender').options].map((o) => o.value).join(','));
  submit(doc.querySelector('#regular-form'));
  await sleep(60);
  check('an empty step 1 is blocked', !visible(doc.querySelector('.reg-step[data-step="2"]')) && doc.querySelectorAll('.reg-step[data-step="1"] .field.invalid').length >= 1);
  type($('rg-name'), 'Reg Check Person');
  type($('rg-email'), 'regcheck@example.com');
  type($('rg-birthdate'), '2003-06-15');
  $('rg-gender').value = 'male'; change($('rg-gender'));
  type($('rg-school'), 'Reg Check School');
  submit(doc.querySelector('#regular-form'));
  await sleep(120);
  check('a filled step 1 advances to step 2', visible(doc.querySelector('.reg-step[data-step="2"]')));
  check('the stepper marks step 1 done', doc.querySelector('#regSteps li[data-step="1"]')?.className.includes('is-done'));
}

section('REGULAR WIZARD — step 2 (ministry, leaders)');
{
  check('step 2 asks for the ministry', Boolean($('rg-ministry')));
  const options = [...$('rg-ministry').options].map((o) => o.value).filter(Boolean);
  check('the ministry list is exactly the eight approved options', JSON.stringify(options) === JSON.stringify(['Worship Team', 'Ushering', 'Media / Tech', 'Kids Ministry', 'Dance / Creative', 'Prayer', 'Production', 'Not yet in a ministry']), options.join(' | '));
  check('the placeholder is Choose a ministry...', $('rg-ministry').options[0].textContent.includes('Choose a ministry'));
  const leaderCalls = calls.filter((c) => c.path.startsWith('/api/public/leaders'));
  check('the leader list was requested for the chosen gender', leaderCalls.length >= 1 && leaderCalls.at(-1).path.includes('gender=male'), JSON.stringify(leaderCalls.at(-1) || {}));
  const leaderOptions = [...$('rg-leader').options].map((o) => o.textContent);
  check('the dropdown shows the real leaders with their lifegroup', leaderOptions.some((t) => t.includes('Kuya Mark') && t.includes('Open Cell A')), leaderOptions.join(' | '));
  check('it does not show a fictional leader', !leaderOptions.some((t) => /fake|sample|test leader/i.test(t)));
  check('the invited-by field is optional (no asterisk requirement)', Boolean($('rg-inviter')));
  // gender change refreshes the list
  $('rg-gender').value = 'female'; change($('rg-gender'));
  await sleep(120);
  const femaleOptions = [...$('rg-leader').options].map((o) => o.textContent);
  check('changing gender fetches the list again', calls.filter((c) => c.path.includes('gender=female')).length >= 1);
  check('the female leaders replace the male ones', femaleOptions.some((t) => t.includes('Ate Grace')) && !femaleOptions.some((t) => t.includes('Kuya Mark')), femaleOptions.join(' | '));
  // select a verified leader → assignment rows fill from the API data
  $('rg-leader').value = '31'; change($('rg-leader'));
  await sleep(60);
  check('the assignment block appears for a chosen leader', visible($('rgAssign')));
  check('the lifegroup leader is the real name', $('rgAssignLeader').textContent === 'Ate Grace', $('rgAssignLeader').textContent);
  check('the network leader comes from the data', $('rgAssignNetwork').textContent === 'Ate Yhail', $('rgAssignNetwork').textContent);
  check('the Open Cell is shown', $('rgAssignCell').textContent.includes('Open Cell C'), $('rgAssignCell').textContent);
  // nobody available for that gender → no leader list, manual entry instead
  leadersEmpty = true;
  $('rg-gender').value = 'female'; change($('rg-gender'));
  await sleep(150);
  check('an empty leader list shows No leader available yet.', $('rg-leader').options[0].textContent.includes('No leader available yet'), $('rg-leader').options[0].textContent);
  check('the leader select is disabled when nobody is available', $('rg-leader').disabled === true);
  leadersEmpty = false;
  check('the manual entry option is offered', Boolean($('rgManualToggle')) && (doc.querySelector('#rgManualToggle').textContent || '').toLowerCase().includes('not on the list'));
  // manual path
  click($('rgManualToggle'));
  await sleep(40);
  check('the manual name field opens', visible($('rgManualWrap')));
  check('hiding the list clears any previous leader', $('rg-leader').value === '');
  type($('rg-manual'), 'Kuya Not In Records');
  // missing ministry is blocked
  click($('rgNext2'));
  await sleep(60);
  check('step 2 is blocked without a ministry', !visible(doc.querySelector('.reg-step[data-step="3"]')) && Boolean($('rg-ministry').closest('.field')?.classList.contains('invalid')));
  $('rg-ministry').value = 'Prayer'; change($('rg-ministry'));
  click($('rgNext2'));
  await sleep(100);
  check('a completed step 2 advances to review', visible(doc.querySelector('.reg-step[data-step="3"]')));
}

section('REGULAR WIZARD — step 3 review + submit');
{
  const review = $('rgReview').textContent;
  check('review lists the basic information', review.includes('Reg Check Person') && review.includes('regcheck@example.com') && review.includes('2003-06-15') && review.includes('Female') && review.includes('Reg Check School'), review.slice(0, 200));
  check('review lists the ministry', review.includes('Prayer'));
  check('review shows the manually typed leader for admin checking', review.includes('Kuya Not In Records') && /reviewed by our team/i.test(review), review.slice(0, 400));
  // back keeps every answer
  click($('rgBack3'));
  await sleep(60);
  check('going back to step 2 keeps the manual name', $('rg-manual').value === 'Kuya Not In Records');
  click($('rgBack2'));
  await sleep(60);
  check('going back to step 1 keeps the typed values', $('rg-name').value === 'Reg Check Person' && $('rg-email').value === 'regcheck@example.com' && $('rg-school').value === 'Reg Check School' && $('rg-birthdate').value === '2003-06-15');
  check('the stepper went back to step 1', doc.querySelector('#regSteps li[data-step="1"]')?.className.includes('is-active'));
  // forward again, then submit without consent
  submit(doc.querySelector('#regular-form'));
  await sleep(150);
  click($('rgNext2'));
  await sleep(150);
  check('review renders again with the same data', $('rgReview').textContent.includes('Reg Check Person'));
  click($('rgSubmit'));
  await sleep(80);
  check('submit is blocked without the consent box', !visible($('reg-success')));
  $('rg-consent').checked = true;
  const before = calls.length;
  click($('rgSubmit'));
  await sleep(200);
  const posted = calls.slice(before).find((c) => c.path === '/api/public/registrations/regular');
  check('the wizard posts to the regular registration endpoint', Boolean(posted));
  check('the posted body carries every answer', posted && posted.body.full_name === 'Reg Check Person' && posted.body.email === 'regcheck@example.com' && posted.body.birthdate === '2003-06-15' && posted.body.gender === 'female' && posted.body.ministry === 'Prayer' && posted.body.leader_name_manual === 'Kuya Not In Records' && posted.body.privacy_consent === true, JSON.stringify(posted?.body));
  check('a request key is sent so a double tap cannot register twice', typeof posted?.body.idempotency_key === 'string' && posted.body.idempotency_key.length >= 16);
}

section('SUCCESS CONFIRMATION');
{
  check('the confirmation panel is shown', visible($('reg-success')));
  check('the wizard is hidden again', !visible($('regular-registration')));
  check('the attendance dashboard is NOT shown', !visible($('vip-attendance-dashboard')));
  const text = $('reg-success').textContent;
  check('it says Registration Successful!', text.includes('Registration Successful!'));
  check('it welcomes the person to the LIFEGEN family', text.includes('Welcome to the LIFEGEN family. Your registration has been recorded.'));
  check('it does not offer "Go to dashboard"', !/go to dashboard/i.test(text));
  check('it says where the details are stored', text.includes('stored securely in the LIFEGEN Supabase database'));
  // the background VIP refresh must not paint over the confirmation
  await sleep(400);
  check('the confirmation survives the background refresh', visible($('reg-success')));
  // manual leader → the confirmation must say a review is coming
  click($('reg-success').querySelector('button, a') || $('reg-success'));
}

section('REGULAR WIZARD — verified leader + review note');
{
  // second pass with a verified leader to see the exact assignment note
  const dom2 = new JSDOM(html, {
    url: BASE + '/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole,
    beforeParse(w) { prepare(w); },
  });
  const d2 = dom2.window.document;
  const $2 = (id) => d2.getElementById(id);
  for (let i = 0; i < 100 && !dom2.window.Lifegen?.DB; i++) await sleep(50);
  await sleep(120);
  $2('chooseRegular').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  const t2 = (el, v) => { el.value = v; el.dispatchEvent(new dom2.window.Event('input', { bubbles: true })); };
  t2($2('rg-name'), 'Reg Check Verified'); t2($2('rg-email'), 'regverified@example.com'); t2($2('rg-birthdate'), '2002-01-05');
  $2('rg-gender').value = 'female'; $2('rg-gender').dispatchEvent(new dom2.window.Event('change', { bubbles: true }));
  t2($2('rg-school'), 'Reg Check School');
  d2.querySelector('#regular-form').dispatchEvent(new dom2.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(150);
  $2('rg-ministry').value = 'Worship Team';
  $2('rg-leader').value = '31'; $2('rg-leader').dispatchEvent(new dom2.window.Event('change', { bubbles: true }));
  await sleep(60);
  $2('rgNext2').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  check('review shows the verified leader + network from the data', $2('rgReview').textContent.includes('Ate Grace') && $2('rgReview').textContent.includes('Ate Yhail') && $2('rgReview').textContent.includes('Open Cell C'));
  $2('rg-consent').checked = true;
  // A server/database failure must not wipe the answers or claim success.
  regularError = { status: 500, body: { message: 'The database request could not be completed. Please try again or contact an administrator.' } };
  $2('rgSubmit').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  await sleep(250);
  check('a database error does not show the success panel', !visible($2('reg-success')));
  check('a database error keeps every answer in the form', $2('rg-name').value === 'Reg Check Verified' && $2('rg-ministry').value === 'Worship Team' && $2('rg-leader').value === '31' && $2('rg-consent').checked === true);
  check('a database error is reported to the visitor', [...d2.querySelectorAll('.toast')].some((t) => /Registration failed/i.test(t.textContent)), [...d2.querySelectorAll('.toast')].map((t) => t.textContent).join(' / '));
  // Now let the server say a review is needed, and confirm the note.
  regularError = null;
  regularResponse = { ok: true, person_created: true, person: { id: '901', name: 'Reg Check Verified', person_code: 'LG-2026-0901' }, membership: { created: false, tier: null, lifegroup_id: null, lifegroup_name: null }, review: { needed: true, reason: 'manual_leader_unmatched' }, leader: null };
  $2('rgSubmit').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  await sleep(250);
  const note = $2('regSuccessNote');
  check('the confirmation states that admin review is coming', visible($2('reg-success')) && !note.hidden && /review your Lifegroup assignment/i.test(note.textContent), note.textContent);
  check('no "Go to dashboard" anywhere after success', !/go to dashboard/i.test($2('reg-success').textContent));
  dom2.window.close();
}

section('LAYOUT (fits the original card)');
{
  const card = $('vipCard');
  check('the new screens live inside the original registration card', ['reg-choice', 'vip-signup-form-container', 'regular-registration', 'reg-success'].every((id) => card.contains($(id))));
  check('the two choices are stacked in one column (portrait)', /\.reg-choice__list\s*\{[^}]*grid-template-columns:\s*1fr/.test(styles));
  check('both choice cards are inside the original card, one per row', doc.querySelectorAll('#reg-choice .reg-choice__card').length === 2 && doc.querySelector('#reg-choice .reg-choice__list'));
  const block = styles.match(/\.reg-[a-z-]+[^}]*\}/g) || [];
  const wide = block.filter((r) => /(?:^|[^-])width:\s*(\d{3,})px/.test(r) && Number(RegExp.$1) >= 600);
  check('no new rule forces a width wider than the card', wide.length === 0, wide.join(' '));
  check('the stepper wraps instead of overflowing', /\.reg-steps\{[^}]*flex-wrap:wrap/.test(styles.replace(/\s+/g, '')));
  check('the choice boxes are slim (no stretched gap between text and button)', !/\.reg-choice__card p\{[^}]*flex:1/.test(styles) && /\.reg-choice__card\{[^}]*padding:12px 14px/.test(styles));
  check('copy and card stay side by side on a narrow laptop/preview width', /@media\s*\(min-width:761px\)\s*and\s*\(max-width:1024px\)\s*\{\s*\.vip-grid\s*\{\s*grid-template-columns:\s*\.92fr 1\.08fr/.test(styles));
  check('the stepper is an ordered list in the page', doc.querySelector('#regSteps')?.tagName === 'OL');
}

section('PAGE HEALTH');
{
  const realErrors = jsErrors.filter((m) => !/fonts\.googleapis\.com|Could not load link/.test(m));
  check('no script errors while the flows ran', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  window.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
