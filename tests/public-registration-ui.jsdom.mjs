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
const registrationStyles = await (await fetch(BASE + '/lifegen/youth-welfare-registration.css')).text();
check('the served page contains the selection screen', html.includes('id="reg-choice"'));
check('the served page contains the three-section regular wizard with integrated Youth Welfare questions', html.includes('id="regular-registration"') && html.includes('id="rg-education-status"') && html.includes('data-step="3"') && html.includes('Additional Information'));
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
let regularDelay = 0;
let leadersEmpty = false;
let regularResponse = { ok: true, person_created: true, person: { id: '900', name: 'Reg Check Person', person_code: 'LG-2026-0900' }, membership: { created: true, tier: 'new', lifegroup_id: '21', lifegroup_name: 'Open Cell A' }, review: null, leader: { leader_person_id: '11', leader_name: 'Kuya Mark' } };

const apiFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, BASE);
  const path = url.pathname + url.search;
  calls.push({ path, method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
  if (path === '/api/public/registration-count') return jsonResponse({ total: 12345 });
  if (path.startsWith('/api/public/leaders')) {
    const gender = url.searchParams.get('gender');
    return jsonResponse({ gender, group_gender: gender === 'male' ? 'boys' : gender === 'female' ? 'girls' : null, leaders: leadersEmpty ? [] : LEADERS[gender] || [] });
  }
  if (path === '/api/public/registrations/regular') {
    if (regularDelay) await sleep(regularDelay);
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

section('REGULAR WIZARD — Basic Information');
{
  click($('chooseRegular'));
  await sleep(170);
  check('the regular form opens inside the existing card', visible($('regular-registration')));
  check('it is titled LIFEGEN Registration', (doc.querySelector('#regular-registration')?.textContent || '').includes('LIFEGEN Registration'));
  check('the wizard has exactly three sections: Basic, Additional, Review & Submit', doc.querySelectorAll('#regSteps li').length === 3 && doc.querySelector('#regSteps li[data-step="1"]')?.textContent.includes('Basic Information') && doc.querySelector('#regSteps li[data-step="2"]')?.textContent.includes('Additional Information') && doc.querySelector('#regSteps li[data-step="3"]')?.textContent.includes('Review & Submit'));
  check('the current step is announced accessibly', doc.querySelector('#regSteps')?.getAttribute('aria-label') === 'Registration progress' && doc.querySelector('#regSteps li[data-step="1"]')?.getAttribute('aria-current') === 'step');
  check('the live total comes from the public database-count endpoint', $('regRegistrationCount').textContent.includes('12,345') && $('regRegistrationCount').textContent.includes('Registration remains open'), $('regRegistrationCount').textContent);
  check('Basic Information is the only visible step initially', visible(doc.querySelector('.reg-step[data-step="1"]')) && !visible(doc.querySelector('.reg-step[data-step="2"]')) && !visible(doc.querySelector('.reg-step[data-step="3"]')));
  check('all existing basic required fields are still present', ['rg-name', 'rg-email', 'rg-birthdate', 'rg-gender', 'rg-school'].every((id) => Boolean($(id)) && $(id).required));
  check('email and birthday use suitable input types', $('rg-email').type === 'email' && $('rg-birthdate').type === 'date');
  check('gender here is Male / Female only', [...$('rg-gender').options].map((o) => o.value).join(',') === ',male,female', [...$('rg-gender').options].map((o) => o.value).join(','));
  submit(doc.querySelector('#regular-form'));
  await sleep(60);
  check('an empty Basic Information section is blocked', visible(doc.querySelector('.reg-step[data-step="1"]')) && doc.querySelectorAll('.reg-step[data-step="1"] .field.invalid').length >= 1);
  check('validation errors are linked to their fields for assistive technology', $('rg-name').getAttribute('aria-invalid') === 'true' && $('rg-name').getAttribute('aria-describedby')?.includes('rg-name-error') && $('rg-name-error')?.textContent.includes('full name'));
  type($('rg-name'), 'Reg Check Person');
  type($('rg-email'), 'regcheck@example.com');
  type($('rg-birthdate'), '2003-06-15');
  $('rg-gender').value = 'male'; change($('rg-gender'));
  type($('rg-school'), 'Reg Check School');
  submit(doc.querySelector('#regular-form'));
  await sleep(120);
  check('a valid basic section advances to Additional Information', visible(doc.querySelector('.reg-step[data-step="2"]')));
  check('the progress indicator marks Basic Information complete and Additional Information current', doc.querySelector('#regSteps li[data-step="1"]')?.className.includes('is-done') && doc.querySelector('#regSteps li[data-step="2"]')?.getAttribute('aria-current') === 'step');
  check('the next heading receives focus for keyboard navigation', doc.activeElement === $('rgAdditionalHeading'));
}

section('ADDITIONAL INFORMATION — ministry, leaders, and Youth Welfare');
{
  check('Ministry and Youth Welfare stay in the same integrated Additional Information section', visible(doc.querySelector('.reg-step[data-step="2"]')) && Boolean($('rg-ministry')) && Boolean($('rg-education-status')) && Boolean($('rg-youth-consent')));
  const options = [...$('rg-ministry').options].map((o) => o.value).filter(Boolean);
  check('the ministry list is exactly the eight approved options', JSON.stringify(options) === JSON.stringify(['Worship Team', 'Ushering', 'Media / Tech', 'Kids Ministry', 'Dance / Creative', 'Prayer', 'Production', 'Not yet in a ministry']), options.join(' | '));
  check('the ministry placeholder is preserved', $('rg-ministry').options[0].textContent.includes('Choose a ministry'));
  const leaderCalls = calls.filter((c) => c.path.startsWith('/api/public/leaders'));
  check('the live leader list is requested for the chosen gender', leaderCalls.length >= 1 && leaderCalls.at(-1).path.includes('gender=male'), JSON.stringify(leaderCalls.at(-1) || {}));
  const leaderOptions = [...$('rg-leader').options].map((o) => o.textContent);
  check('the dropdown shows current leaders and their Lifegroup', leaderOptions.some((t) => t.includes('Kuya Mark') && t.includes('Open Cell A')), leaderOptions.join(' | '));
  check('the dropdown does not show a fictional leader', !leaderOptions.some((t) => /fake|sample|test leader/i.test(t)));
  check('the invited-by field remains optional', Boolean($('rg-inviter')) && !$('rg-inviter').required);
  check('leader help text is associated with its select', $('rg-leader').getAttribute('aria-describedby') === 'rgLeaderHelp');
  // Gender changes refresh live leaders; this also confirms answers survive the section boundary.
  $('rg-gender').value = 'female'; change($('rg-gender'));
  await sleep(120);
  const femaleOptions = [...$('rg-leader').options].map((o) => o.textContent);
  check('changing gender refreshes the leader list', calls.filter((c) => c.path.includes('gender=female')).length >= 1);
  check('female leaders replace male leaders', femaleOptions.some((t) => t.includes('Ate Grace')) && !femaleOptions.some((t) => t.includes('Kuya Mark')), femaleOptions.join(' | '));
  $('rg-leader').value = '31'; change($('rg-leader'));
  await sleep(60);
  check('a selected leader shows verified Lifegroup assignment', visible($('rgAssign')) && $('rgAssignLeader').textContent === 'Ate Grace' && $('rgAssignNetwork').textContent === 'Ate Yhail' && $('rgAssignCell').textContent.includes('Open Cell C'));
  // Empty live lists still permit the existing manual-name path.
  leadersEmpty = true;
  $('rg-gender').value = 'female'; change($('rg-gender'));
  await sleep(150);
  check('an empty leader list explains that no leader is available yet', $('rg-leader').options[0].textContent.includes('No leader available yet'));
  check('the empty leader selector is disabled and manual entry remains available', $('rg-leader').disabled === true && Boolean($('rgManualToggle')));
  leadersEmpty = false;
  click($('rgManualToggle'));
  await sleep(40);
  check('manual leader entry opens and clears any previous selected leader', visible($('rgManualWrap')) && $('rg-leader').value === '');
  type($('rg-manual'), 'Kuya Not In Records');
  click($('rgNextWelfare'));
  await sleep(60);
  check('the Additional Information section is blocked when ministry is missing', visible(doc.querySelector('.reg-step[data-step="2"]')) && $('rg-ministry').closest('.field')?.classList.contains('invalid'));
  $('rg-ministry').value = 'Prayer'; change($('rg-ministry'));
  click($('rgNextWelfare'));
  await sleep(80);
  check('required Youth Welfare answers and the separate consent block an empty section', visible(doc.querySelector('.reg-step[data-step="2"]')) && !visible(doc.querySelector('.reg-step[data-step="3"]')) && $('rg-address').closest('.field')?.classList.contains('invalid'));
  check('school interruption questions are hidden by default', $('rg-school-stop-wrap').hidden);
  check('grade/year stays hidden until an applicable status is chosen', $('rg-grade-wrap').hidden);
  type($('rg-address'), '21 Maharlika Street, Bulacan');
  type($('rg-contact'), '+639171234567');
  type($('rg-guardian-name'), 'Maria Cruz');
  type($('rg-guardian-contact'), '+639181234567');
  $('rg-education-status').value = 'currently_studying'; change($('rg-education-status'));
  check('grade/year appears for a currently studying attendee', !$('rg-grade-wrap').hidden);
  $('rg-grade-year').value = 'senior_high_grade_12'; change($('rg-grade-year'));
  $('rg-education-status').value = 'out_of_school'; change($('rg-education-status'));
  check('school interruption questions appear only for Out-of-School Youth', !$('rg-school-stop-wrap').hidden && $('rg-grade-wrap').hidden);
  $('rg-school-stop-period').value = 'last_school_year';
  const reasons = [...doc.querySelectorAll('input[name="rg-school-stop-reason"]')];
  reasons[0].checked = true; reasons[1].checked = true;
  $('rg-continue-studies').value = 'yes_need_help';
  $('rg-church-invited-date').value = '2024-04-01';
  $('rg-lcsol-enrolled').value = 'no';
  $('rg-lcsol-status').value = 'not_yet_started';
  $('rg-youth-consent').checked = true;
  $('rg-lcsol-status').value = 'sol_1';
  click($('rgNextWelfare'));
  await sleep(70);
  check('inconsistent LCSOL enrollment/status is blocked server-side by the UI validation', visible(doc.querySelector('.reg-step[data-step="2"]')) && $('rg-lcsol-status').closest('.field')?.classList.contains('invalid'));
  $('rg-lcsol-status').value = 'not_yet_started';
  click($('rgNextWelfare'));
  await sleep(100);
  check('valid answers advance to the Review & Submit section', visible(doc.querySelector('.reg-step[data-step="3"]')) && !visible(doc.querySelector('.reg-step[data-step="2"]')));
}

section('REVIEW & SUBMIT — editable answers + database save');
{
  const review = $('rgReview').textContent;
  check('review lists basic identity/contact answers', review.includes('Reg Check Person') && review.includes('regcheck@example.com') && review.includes('2003-06-15') && review.includes('Female') && review.includes('Reg Check School'), review.slice(0, 220));
  check('review lists ministry and leader details', review.includes('Prayer') && review.includes('Kuya Not In Records'));
  check('review includes Youth Welfare answers and conditional reasons', review.includes('21 Maharlika Street') && review.includes('Maria Cruz') && review.includes('Out-of-school youth/stopped schooling') && review.includes('Financial problem') && review.includes('Needed to work') && review.includes('Yes, but I need help'));
  check('the review step is announced as current', $('regSteps').querySelector('li[aria-current="step"]')?.dataset.step === '3');
  click($('rgBackReview'));
  await sleep(80);
  check('going back to Additional Information preserves Youth Welfare answers', $('rg-address').value === '21 Maharlika Street, Bulacan' && $('rg-guardian-name').value === 'Maria Cruz' && $('rg-youth-consent').checked);
  click($('rgBackWelfare'));
  await sleep(60);
  check('going back to Basic Information preserves entered identity and leader answers', $('rg-name').value === 'Reg Check Person' && $('rg-email').value === 'regcheck@example.com' && $('rg-school').value === 'Reg Check School' && $('rg-birthdate').value === '2003-06-15' && $('rg-manual').value === 'Kuya Not In Records');
  check('the progress indicator returns to Basic Information', doc.querySelector('#regSteps li[data-step="1"]')?.className.includes('is-active') && doc.querySelector('#regSteps li[data-step="1"]')?.getAttribute('aria-current') === 'step');
  submit(doc.querySelector('#regular-form'));
  await sleep(120);
  click($('rgNextWelfare'));
  await sleep(150);
  check('answers still render in Review & Submit after navigating forward again', visible(doc.querySelector('.reg-step[data-step="3"]')) && $('rgReview').textContent.includes('Maria Cruz'));
  click($('rgSubmit'));
  await sleep(80);
  check('submit is blocked until the separate regular-registration consent is checked', !visible($('reg-success')) && !$('rg-consent').checked);
  $('rg-consent').checked = true;
  const before = calls.length;
  click($('rgSubmit'));
  await sleep(220);
  const posted = calls.slice(before).find((c) => c.path === '/api/public/registrations/regular');
  check('the wizard posts to the existing regular-registration endpoint', Boolean(posted));
  check('the request carries both consents and all answers', posted && posted.body.full_name === 'Reg Check Person' && posted.body.email === 'regcheck@example.com' && posted.body.birthdate === '2003-06-15' && posted.body.gender === 'female' && posted.body.ministry === 'Prayer' && posted.body.leader_name_manual === 'Kuya Not In Records' && posted.body.privacy_consent === true && posted.body.youth_welfare.consent === true && posted.body.youth_welfare.parent_guardian_name === 'Maria Cruz' && posted.body.youth_welfare.school_stop_reasons.length === 2 && posted.body.youth_welfare.lcsol_enrolled === false && posted.body.youth_welfare.lcsol_status === 'not_yet_started', JSON.stringify(posted?.body));
  check('a random request key is sent for server-side idempotency', typeof posted?.body.idempotency_key === 'string' && posted.body.idempotency_key.length >= 16);
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

section('REGULAR WIZARD — verified leader + retry/idempotency');
{
  const dom2 = new JSDOM(html, {
    url: BASE + '/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole,
    beforeParse(w) { prepare(w); },
  });
  const d2 = dom2.window.document;
  const $2 = (id) => d2.getElementById(id);
  for (let i = 0; i < 100 && !dom2.window.Lifegen?.DB; i++) await sleep(50);
  await sleep(130);
  $2('chooseRegular').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  const t2 = (el, v) => { el.value = v; el.dispatchEvent(new dom2.window.Event('input', { bubbles: true })); };
  t2($2('rg-name'), 'Reg Check Verified'); t2($2('rg-email'), 'regverified@example.com'); t2($2('rg-birthdate'), '2002-01-05');
  $2('rg-gender').value = 'female'; $2('rg-gender').dispatchEvent(new dom2.window.Event('change', { bubbles: true }));
  t2($2('rg-school'), 'Reg Check School');
  d2.querySelector('#regular-form').dispatchEvent(new dom2.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(150);
  $2('rg-ministry').value = 'Worship Team';
  $2('rg-leader').value = '31'; $2('rg-leader').dispatchEvent(new dom2.window.Event('change', { bubbles: true }));
  t2($2('rg-address'), '10 Central Avenue, Bulacan'); t2($2('rg-contact'), '+639171112222');
  t2($2('rg-guardian-name'), 'Juan Cruz'); t2($2('rg-guardian-contact'), '+639181112222');
  $2('rg-education-status').value = 'currently_studying'; $2('rg-education-status').dispatchEvent(new dom2.window.Event('change', { bubbles: true }));
  $2('rg-grade-year').value = 'college_first_year';
  $2('rg-lcsol-enrolled').value = 'yes'; $2('rg-lcsol-status').value = 'sol_1'; $2('rg-youth-consent').checked = true;
  $2('rgNextWelfare').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  check('review shows the verified leader and network from live data', $2('rgReview').textContent.includes('Ate Grace') && $2('rgReview').textContent.includes('Ate Yhail') && $2('rgReview').textContent.includes('Open Cell C'));
  check('review includes Youth Welfare answers in readable labels', $2('rgReview').textContent.includes('Juan Cruz') && !$2('rgReview').textContent.includes('college_first_year') && $2('rgReview').textContent.includes('First Year College'));
  $2('rg-consent').checked = true;
  regularError = { status: 500, body: { message: 'The database request could not be completed. Please try again or contact an administrator.' } };
  regularDelay = 80;
  const beforeFailure = calls.length;
  $2('rgSubmit').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  $2('rgSubmit').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  check('submit disables itself while the request is in flight', $2('rgSubmit').disabled === true && $2('rgSubmit').getAttribute('aria-busy') === 'true');
  await sleep(260);
  regularDelay = 0;
  const failedCalls = calls.slice(beforeFailure).filter((c) => c.path === '/api/public/registrations/regular');
  check('a repeated tap does not send a second in-flight request', failedCalls.length === 1, `requests=${failedCalls.length}`);
  const failedKey = failedCalls[0]?.body?.idempotency_key;
  check('a service error does not show success and retains all answers', !($2('reg-success').hidden === false) && $2('rg-name').value === 'Reg Check Verified' && $2('rg-ministry').value === 'Worship Team' && $2('rg-leader').value === '31' && $2('rg-consent').checked && $2('rg-address').value === '10 Central Avenue, Bulacan' && $2('rg-guardian-name').value === 'Juan Cruz' && $2('rg-youth-consent').checked);
  check('the visitor gets a persistent, retryable error with the service reason', !$2('rgSubmitError').hidden && /database request could not be completed/i.test($2('rgSubmitError').textContent) && /answers are still here/i.test($2('rgSubmitError').textContent));
  check('the failed request key stays in session for a safe retry', Boolean(failedKey) && d2.defaultView.sessionStorage.getItem('lifegen_regular_request') === failedKey);
  check('the submit button is re-enabled after the failed request', $2('rgSubmit').disabled === false && !$2('rgSubmit').hasAttribute('aria-busy'));
  check('the error is also announced as a visible toast', [...d2.querySelectorAll('.toast')].some((t) => /Registration failed/i.test(t.textContent)));
  regularError = null;
  regularResponse = { ok: true, person_created: true, person: { id: '901', name: 'Reg Check Verified', person_code: 'LG-2026-0901' }, membership: { created: false, tier: null, lifegroup_id: null, lifegroup_name: null }, review: { needed: true, reason: 'manual_leader_unmatched' }, leader: null };
  const beforeRetry = calls.length;
  $2('rgSubmit').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
  await sleep(250);
  const retry = calls.slice(beforeRetry).find((c) => c.path === '/api/public/registrations/regular');
  check('the retry reuses the same server idempotency key', retry?.body?.idempotency_key === failedKey);
  check('a confirmed successful response clears the retry key', d2.defaultView.sessionStorage.getItem('lifegen_regular_request') === null);
  const note = $2('regSuccessNote');
  check('the confirmation appears only after a saved response and states admin review is coming', !$2('reg-success').hidden && !note.hidden && /review your Lifegroup assignment/i.test(note.textContent), note.textContent);
  check('no "Go to dashboard" appears after success', !/go to dashboard/i.test($2('reg-success').textContent));
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
  check('the original stepper still wraps instead of overflowing', /\.reg-steps\{[^}]*flex-wrap:wrap/.test(styles.replace(/\s+/g, '')));
  check('the three-section progress is a mobile grid with no fixed width', /#regSteps\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(registrationStyles.replace(/\s+/g, '')));
  check('registration controls and action buttons have phone-sized tap targets', /min-height:48px/.test(registrationStyles) && /min-height:44px/.test(registrationStyles) && /width:20px;height:20px/.test(registrationStyles));
  check('the registration total is presented as text rather than a cap or progress bar', $('regRegistrationCount').textContent.includes('Registration remains open') && !/max|limit|capacity/i.test($('regRegistrationCount').textContent));
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
