import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PERMISSIONS, publicUser } from '../src/auth.js';
import { normalizeYouthWelfareAnswers } from '../src/youth-welfare-form.js';
import {
  YOUTH_WELFARE_CATEGORIES, YOUTH_REPORT_TEMPLATES, YOUTH_WELFARE_PEOPLE_TABS, validateYouthCategory,
  youthWelfareEligibilitySql, normalizeYouthFilters, youthWelfareRegistrationTrend,
  isPossibleSimilarYouthName, shapeYouthProfileForViewer, shapeYouthProfileForStaff,
} from '../src/youth-welfare.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('Youth Welfare role is restricted to the separate portal permissions', () => {
  assert.deepEqual(PERMISSIONS.youth_welfare_admin, ['youth_welfare:view', 'youth_welfare:classify', 'youth_welfare:manage', 'youth_welfare:records:manage', 'youth_welfare:access:manage', 'youth_welfare:profile:private', 'youth_welfare:people:add', 'youth_welfare:tracker:view']);
  assert.deepEqual(PERMISSIONS.youth_welfare_staff, ['youth_welfare:view', 'youth_welfare:records:manage', 'youth_welfare:tracker:view']);
  assert.deepEqual(PERMISSIONS.youth_welfare_viewer, ['youth_welfare:view', 'youth_welfare:tracker:view']);
  assert.ok(PERMISSIONS.admin.includes('youth_welfare:manage'), 'Main Admin can manage only within the separately permission-gated portal');
  assert.ok(PERMISSIONS.admin.includes('youth_welfare:view'), 'Main Admin can open the separate Youth Welfare portal');
  for (const permission of ['dashboard:view', 'people:view', 'people:write', 'registrations:manage', 'users:manage', 'settings:manage', 'lifegroups:view', 'attendance:view']) {
    assert.equal(PERMISSIONS.youth_welfare_admin.includes(permission), false, `${permission} must not be inherited`);
    assert.equal(PERMISSIONS.youth_welfare_viewer.includes(permission), false, `${permission} must not be inherited by Viewer`);
  }
  assert.deepEqual(publicUser({ id: 4, username: 'jessa', display_name: 'Jessa', role_id: 'youth_welfare_admin', is_active: true }).permissions, PERMISSIONS.youth_welfare_admin);
  assert.deepEqual(publicUser({ id: 5, username: 'youthviewer', display_name: 'Youth Viewer', role_id: 'youth_welfare_viewer', is_active: true }).permissions, ['youth_welfare:view', 'youth_welfare:tracker:view']);
});

test('additive Youth Welfare assignments compose with shared LIFEGEN roles and revocation removes only portal access', () => {
  const staffBase = PERMISSIONS.staff;
  const adminGrant = publicUser({ id: 7, username: 'shared-staff', display_name: 'Shared Staff', role_id: 'staff', is_active: true, youth_welfare_access_role_id: 'youth_welfare_admin', youth_welfare_access_status: 'active' });
  assert.equal(adminGrant.role_id, 'staff', 'the primary LIFEGEN role is not replaced');
  assert.equal(adminGrant.youth_welfare_role, 'youth_welfare_admin');
  for (const permission of staffBase) assert.ok(adminGrant.permissions.includes(permission), `keeps primary permission ${permission}`);
  for (const permission of PERMISSIONS.youth_welfare_admin) assert.ok(adminGrant.permissions.includes(permission), `adds portal permission ${permission}`);
  assert.equal(adminGrant.permissions.includes('users:manage'), false, 'Youth Welfare Admin does not inherit LIFEGEN account administration');

  const viewerGrant = publicUser({ id: 8, username: 'shared-viewer', display_name: 'Shared Viewer', role_id: 'viewer', is_active: true, youth_welfare_access_role_id: 'youth_welfare_viewer', youth_welfare_access_status: 'active' });
  assert.equal(viewerGrant.role_id, 'viewer');
  assert.ok(viewerGrant.permissions.includes('youth_welfare:view'));
  assert.equal(viewerGrant.permissions.includes('youth_welfare:manage'), false);
  assert.equal(viewerGrant.permissions.includes('youth_welfare:profile:private'), false);

  const revoked = publicUser({ id: 7, username: 'shared-staff', display_name: 'Shared Staff', role_id: 'staff', is_active: true, youth_welfare_access_role_id: 'youth_welfare_admin', youth_welfare_access_status: 'revoked' });
  assert.deepEqual(revoked.permissions, staffBase);
  assert.equal(revoked.youth_welfare_role, null);
  assert.equal(publicUser({ id: 9, username: 'pre-migration', display_name: 'Existing Staff', role_id: 'staff', is_active: true }).permissions.length, staffBase.length, 'sessions still compose from the legacy role set before the optional assignment table exists');
});

test('Viewer profile shaping is an allow-list and excludes private and restricted answer fields', () => {
  const person = shapeYouthProfileForViewer({
    id: 42, person_code: 'LG-0042', first_name: 'Ari', last_name: 'Santos', full_name: 'Ari Santos',
    status: 'regular', date_registered: '2026-09-01', youth_category: 'student', email: 'ari@example.test',
    school: 'Example School', course_year: 'Grade 12', occupation: 'Student', school_exit_reason: 'private answer',
    notes: 'private note', vip_details: { phone: 'private' },
  });
  assert.deepEqual(person, {
    id: 42, person_code: 'LG-0042', first_name: 'Ari', last_name: 'Santos', full_name: 'Ari Santos',
    status: 'regular', date_registered: '2026-09-01', youth_category: 'student',
  });
  assert.doesNotMatch(JSON.stringify(person), /ari@example|Example School|Grade 12|private answer|private note|phone/i);
});

test('Staff profile shaping exposes limited education and LCSOL fields but no family/contact or school-stop reasons', () => {
  const person = shapeYouthProfileForStaff({
    id: 11, person_code: 'LG-0011', full_name: 'Nia Cruz', school: 'Central High', course_year: 'Grade 10',
    education_status: 'out_of_school', school_stop_period: 'last_school_year', school_stop_reasons: ['financial_problem'],
    continue_studies: 'yes_need_help', lcsol_enrolled: false, lcsol_status: 'not_yet_started',
    complete_address: 'private address', contact_number: 'private phone', parent_guardian_contact: 'private guardian',
  });
  assert.equal(person.school, 'Central High');
  assert.equal(person.education_status, 'out_of_school');
  assert.equal(person.lcsol_enrolled, false);
  assert.equal(Object.hasOwn(person, 'school_stop_reasons'), false);
  assert.doesNotMatch(JSON.stringify(person), /private address|private phone|private guardian|financial_problem/);
});

test('registration trend validation rejects partial, malformed, or unsupported ranges before querying data', async () => {
  await assert.rejects(youthWelfareRegistrationTrend({ from: '2026-01-01' }), error => error.status === 400);
  await assert.rejects(youthWelfareRegistrationTrend({ from: '2026-02-30', to: '2026-03-01' }), error => error.status === 400);
  await assert.rejects(youthWelfareRegistrationTrend({ from: '2022-01-01', to: '2026-02-01' }), error => error.status === 400);
});

test('Youth Welfare categories are explicit and unknown values cannot be assigned', () => {
  assert.deepEqual(YOUTH_WELFARE_CATEGORIES.map(category => category.id), [
    'student', 'working_student', 'young_professional', 'working_employed',
    'not_studying', 'unable_to_continue', 'unclassified',
  ]);
  for (const category of YOUTH_WELFARE_CATEGORIES) assert.equal(validateYouthCategory(category.id), category.id);
  assert.throws(() => validateYouthCategory('inferred_from_age'), error => error.status === 400);
});

test('questionnaire validation keeps consent/guardian requirements and conditional school-stop multi-selects', () => {
  const valid={consent:true,complete_address:'21 Maharlika Street, Bulacan',contact_number:'+639171234567',parent_guardian_name:'Maria Cruz',parent_guardian_contact_number:'+639181234567',education_status:'currently_studying',grade_year_level:'senior_high_grade_12',lcsol_enrolled:true,lcsol_status:'currently_in_consolidation'};
  const studying=normalizeYouthWelfareAnswers(valid);
  assert.equal(studying.education_status,'currently_studying');
  assert.equal(studying.grade_year_level,'senior_high_grade_12');
  assert.equal(studying.school_stop_period,null);
  const stopped=normalizeYouthWelfareAnswers({...valid,education_status:'out_of_school',grade_year_level:null,school_stop_period:'two_years_ago',school_stop_reasons:['financial_problem','needed_to_work','financial_problem'],continue_studies:'yes_need_help',lcsol_enrolled:false,lcsol_status:'not_yet_started'});
  assert.deepEqual(stopped.school_stop_reasons,['financial_problem','needed_to_work']);
  assert.equal(stopped.grade_year_level,null);
  assert.equal(stopped.continue_studies,'yes_need_help');
  assert.throws(()=>normalizeYouthWelfareAnswers({...valid,consent:false}),error=>error.status===400);
  assert.throws(()=>normalizeYouthWelfareAnswers({...valid,parent_guardian_name:''}),error=>error.status===400);
  assert.throws(()=>normalizeYouthWelfareAnswers({...valid,grade_year_level:''}),error=>error.status===400);
  assert.throws(()=>normalizeYouthWelfareAnswers({...valid,lcsol_enrolled:false,lcsol_status:'sol_1'}),error=>error.status===400);
});

test('eligible records are selected by regular registration evidence, never name matching, and VIP-linked people are excluded', () => {
  const live = youthWelfareEligibilitySql({ localDemo: false });
  assert.match(live, /p\.registration_source IN \('public','youth_welfare'\)/);
  assert.match(live, /action = 'public_registration'/);
  assert.match(live, /NOT EXISTS\s*\(\s*SELECT 1 FROM public\.vip_registrations vip WHERE vip\.person_id = p\.id/s);
  assert.match(live, /p\.archived_at IS NULL/);
  assert.doesNotMatch(live, /ILIKE|first_name.*=.*last_name/i);
  assert.doesNotMatch(live, /p\.is_demo/);
  assert.match(youthWelfareEligibilitySql({ localDemo: true }), /p\.is_demo = true/);
});

test('dashboard and API pages use the existing authentication with server-side permission checks', () => {
  const app = read('../src/app.js');
  const dashboard = read('../public/youth-welfare/index.html');
  const settings = read('../public/admin/js/views/settings.js');
  const adminClient = read('../public/admin/js/app.js');
  const adminApi = read('../public/admin/js/api.js');
  const adminLogin = read('../public/admin/js/views/auth.js');
  assert.match(app, /youthWelfareApi\.use\(requireStaff/);
  assert.match(app, /requirePermission\(req\.actor,'youth_welfare:view'\)/);
  assert.match(app, /youthWelfareApi\.get\('\/people\/:id\/lifegroup-tracker',requireYouthTrackerView/);
  assert.match(app, /youth_welfare:tracker:view/);
  assert.match(app, /lifegroups:view/);
  assert.match(app, /protectYouthWrite\('youth_welfare:classify'\)/);
  assert.match(app, /app\.get\(\['\/youth-welfare','\/youth-welfare\/'\]/);
  assert.match(app, /if\(actor&&!actor\.permissions\.includes\('youth_welfare:view'\)\)return res\.redirect\(303,'\/admin'\)/);
  assert.match(dashboard, /\/api\/auth\/login/);
  assert.match(dashboard, /\/api\/auth\/password/);
  assert.match(dashboard, /currentUser\?\.permissions\?\.includes\('youth_welfare:view'\)/);
  assert.match(dashboard, /\/api\/youth-welfare\/people/);
  assert.match(dashboard, /const privateFields=isAdmin\?/);
  assert.match(dashboard, /can\('youth_welfare:profile:private'\)/);
  assert.match(dashboard, /if\(!can\('youth_welfare:records:manage'\)&&!can\('youth_welfare:profile:private'\)\)return ''/);
  assert.match(settings, /youth_welfare_admin/);
  assert.match(settings, /youth_welfare_viewer/);
  assert.match(settings, /Youth Welfare Viewer \(portal-only\)/);
  assert.match(read('../public/admin/js/ui.js'), /youth_welfare_viewer: 'Youth Welfare Viewer \(portal-only\)'/);
  assert.match(adminClient, /isYouthWelfareRole\(signedInUser\.role_id\)/);
  assert.match(adminClient, /isYouthWelfareRole\(status\.user\.role_id\)/);
  assert.match(app, /includes\(actor\?\.role_id\)/);
  assert.match(dashboard, /can\('youth_welfare:classify'\)/);
  assert.match(dashboard, /can\('youth_welfare:manage'\)/);
  assert.match(dashboard, /id="categoryControls"/);
  assert.match(dashboard, /id="profileAddTask"/);
  assert.match(dashboard, /id="editWelfareRecord"/);
  assert.match(adminClient, /location\.replace\(youthWelfareUrl\(verified\.preview\)\)/);
  assert.match(adminClient, /location\.replace\(youthWelfareUrl\(status\.preview\)\)/);
  assert.match(adminApi, /getPreviewSessionToken/);
  assert.match(adminLogin, /demo-youth@lifegen\.local/);
  assert.match(adminLogin, /<span style="flex:1;min-width:0"><b>Local demo only/);
  assert.doesNotMatch(adminLogin, /Youth Welfare Admin and Viewer accounts open the separate Youth Welfare portal automatically after sign-in/);
  assert.match(dashboard, /preview-session/);
  const youthApi = read('../src/youth-welfare.js');
  const profileSelect = youthApi.slice(youthApi.indexOf('function personSelect'), youthApi.indexOf('export function validateYouthCategory'));
  assert.doesNotMatch(profileSelect, /p\.middle_name|p\.contact_number|p\.address/);
  assert.match(profileSelect, /p\.school,\s*p\.course_year,\s*p\.occupation/);
  assert.match(youthApi, /export function shapeYouthProfileForViewer\(person\)/);
  assert.match(youthApi, /const visible=\['id','person_code','first_name','last_name','full_name','status','date_registered','youth_category'\]/);
});

test('Youth Welfare API protects private profiles, correction review, record writes, tasks, activity, and exports', () => {
  const app = read('../src/app.js');
  assert.match(app, /youthWelfareApi\.put\('\/people\/:id\/welfare-record',protectYouthWrite\('youth_welfare:records:manage'\)/);
  assert.match(app, /youthWelfareApi\.put\('\/people\/:id\/verification',protectYouthWrite\('youth_welfare:manage'\)/);
  assert.match(app, /youthWelfareApi\.get\('\/people\/:id\/history',requireYouthPrivate/);
  assert.match(app, /youthWelfareApi\.get\('\/updates\/pending',requireYouthPrivate/);
  assert.match(app, /youthWelfareApi\.post\('\/updates\/:id\/review',protectYouthWrite\('youth_welfare:profile:private'\)/);
  assert.match(app, /youthWelfareApi\.get\('\/tasks',requireYouthManage/);
  assert.match(app, /youthWelfareApi\.get\('\/reminders',requireYouthManage/);
  assert.match(app, /youthWelfareApi\.get\('\/activity',requireYouthManage/);
  assert.match(app, /youthWelfareApi\.get\('\/cell-leaders',requireYouthRecordsManage/);
  assert.match(app, /reports\/export\.csv',requireYouthManage/);
});

test('Education/LCSOL dashboard tools, corrections review, and role-shaped edit controls are present', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  const service = read('../src/youth-welfare.js');
  assert.match(dashboard, /async function loadEducationPage\(\)/);
  assert.match(dashboard, /async function loadLcsolPage\(\)/);
  assert.match(dashboard, /async function loadAnalyticsPage\(\)/);
  assert.match(dashboard, /async function loadCorrectionsPage\(\)/);
  assert.match(dashboard, /school-stop reasons are multi-select/);
  assert.match(dashboard, /welfareProfileSection\(person,leaders=\[\]\)/);
  assert.match(dashboard, /const privateFields=isAdmin\?/);
  assert.match(dashboard, /function setVerification\(person,status\)/);
  assert.match(service, /education_status\s*=\$3/);
  assert.match(service, /lcsol_enrolled IS TRUE/);
  assert.match(service, /continuation_choice_counts/);
  assert.match(service, /canViewSchoolStopReasons \? \(welfare\.school_stop_reason_counts/);
  assert.match(service, /Your role cannot filter directory records by Youth Welfare answers/);
});

test('Youth Welfare responsive shell keeps navigation, dialogs, tables, and mobile controls available', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  for (const breakpoint of ['@media(max-width:800px)', '@media(max-width:420px)', '@media(max-width:360px)']) {
    assert.ok(dashboard.includes(breakpoint), `responsive styles include ${breakpoint}`);
  }
  for (const rule of [
    '.sidebar{position:sticky', '.table-wrap{max-width:100%', '.nav-link{min-height:42px}',
    '.dialog[open]>form{display:flex;', '.dialog__body{flex:1;min-height:0;max-height:none;overflow:auto}',
    'aria-label="Youth Welfare sections"', 'id="changePassword" aria-label="Change password"',
    'id="logout" aria-label="Sign out"',
  ]) assert.ok(dashboard.includes(rule), `responsive UI includes ${rule}`);
  for (const destination of ['overview', 'directory', 'corrections', 'education', 'lcsol', 'tasks', 'analytics', 'reports', 'status', 'quality', 'activity', 'views', 'access', 'settings']) {
    assert.ok(dashboard.includes(`['${destination}'`), `navigation keeps the ${destination} destination`);
  }
  assert.doesNotMatch(dashboard, /font-size:0;gap:0/);
});

test('phone dashboard uses an app-style header, accessible section drawer, and recent-person cards', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  for (const control of ['id="mobileNavToggle"', 'id="mobileSearchToggle"', 'id="mobileAccountMenu"', 'class="btn btn--primary mobile-create"', 'id="navBackdrop"']) {
    assert.ok(dashboard.includes(control), `phone UI includes ${control}`);
  }
  assert.match(dashboard, /body\.mobile-nav-open \.sidebar/);
  assert.match(dashboard, /class="dashboard-welcome"/);
  assert.match(dashboard, /function recentPeopleStrip\(people\)/);
  assert.match(dashboard, /class="recent-mobile"/);
  assert.match(dashboard, /aria-label="Recently registered people"/);
  assert.equal((dashboard.match(/id="changePassword"/g) || []).length, 1, 'desktop password control has a unique ID');
  assert.equal((dashboard.match(/id="logout"/g) || []).length, 1, 'desktop sign-out control has a unique ID');
});

test('Youth Welfare dashboard follows the responsive CRM-inspired card layout with verified LIFEGEN data', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  assert.match(dashboard, /class="dashboard-workspace"/);
  assert.match(dashboard, /grid-template-areas:"trend recent" "categories reminders"/);
  assert.match(dashboard, /grid-template-areas:"trend" "recent" "categories" "reminders"/);
  assert.match(dashboard, /class="card dashboard-panel dashboard-panel--trend"/);
  assert.match(dashboard, /class="card card--recent-people dashboard-panel--recent"/);
  assert.match(dashboard, /function recentPeopleList\(people\)/);
  assert.match(dashboard, /function metricGlyph\(label\)/);
  assert.match(dashboard, /Registration trend/);
  assert.match(dashboard, /Follow-up reminders/);
  assert.match(dashboard, /VIP-linked people are excluded/);
  assert.match(dashboard, /Monthly verified registrations · not attendance/);
});

test('Youth Welfare overview has clickable directory drilldowns and reuses the public registration workflow', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  assert.match(dashboard, /metric--link/);
  assert.match(dashboard, /data-goto="directory" data-category="\$\{esc\(row\.id\)\}"/);
  assert.match(dashboard, /directoryPageSize/);
  assert.match(dashboard, /Register attendee/);
  assert.ok(dashboard.includes('href="/#vip"'));
  assert.match(dashboard, /href="\/#vip">＋ Register attendee/);
  assert.match(dashboard, /Linking never changes the existing People record/);
  assert.match(dashboard, /does not record participant consent, Welfare answers, or completion/);
  assert.match(dashboard, /never link by name similarity alone/);
  assert.match(read('../public/lifegen/index.html'), /id="chooseRegular"/);
});

test('regular registration preserves canonical People fields and sends existing welfare corrections to Admin review', () => {
  const api=read('../src/public-api.js');
  const form=read('../src/youth-welfare-form.js');
  const registrationStart=api.indexOf("publicRouter.post('/registrations/regular'");
  const existingStart=api.indexOf('if(existing){',registrationStart);
  const welfareStart=api.indexOf('// ---- save Youth Welfare answers separately from People and Tracker data ----',existingStart);
  assert.notEqual(registrationStart,-1);
  assert.notEqual(existingStart,-1);
  assert.notEqual(welfareStart,-1);
  const existingBlock=api.slice(existingStart,welfareStart);
  assert.match(existingBlock,/person=existing/);
  assert.doesNotMatch(existingBlock,/person\.(?:first_name|last_name|full_name|sex|birthdate|age|school|inviter|ministry|email)\s*=/);
  assert.match(existingBlock,/if\(!person\.privacy_consent_at\)person\.privacy_consent_at=today\(\)/);
  assert.match(api,/const existing=emailMatches\[0\]\|\|null/);
  assert.match(api,/if\(emailMatches\.length>1\)/);
  assert.match(api,/if\(existingWelfare\)\{[\s\S]*?INSERT INTO public\.youth_welfare_record_updates/);
  assert.match(api,/ON CONFLICT\(request_hash\) DO NOTHING/);
  assert.match(form,/I agree that LCF LifeGen - Central Youth Welfare may collect and use my answers for youth welfare and follow-up purposes\./);
  assert.match(api,/normalizeYouthWelfareAnswers\(b\.youth_welfare\)/);
});

test('dashboard shows verified LIFEGEN education fields and labels unavailable answers without inference', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  assert.match(dashboard, /class="dashboard-welcome__copy"/);
  assert.match(dashboard, /function educationReportStatus\(\)/);
  assert.match(dashboard, /Youth Welfare answers/);
  assert.match(dashboard, /welfareAvailable\?'Education status · grade\/year · school-stop period · continuation plans · LCSOL · church invitation date\. Stored separately from People\.'/);
  assert.match(dashboard, /Apply additive migration 015_youth_welfare_records\.sql through the approved, backed-up deployment process/);
  assert.match(dashboard, /no zero counts are inferred/);
  for (const verifiedField of ['School / institution', 'Course / grade / year', 'Occupation']) assert.ok(dashboard.includes(verifiedField), `dashboard identifies ${verifiedField} as a stored field`);
  for (const welfareField of ['Education status', 'school-stop period', 'school-stop reasons', 'continuation plans', 'LCSOL', 'church invitation date']) assert.ok(dashboard.includes(welfareField), `dashboard identifies ${welfareField} as a Youth Welfare response field`);
  assert.match(dashboard, /Youth Welfare Admin/);
  assert.match(dashboard, /never inferred/);
  assert.match(dashboard, /person_code/);
  assert.match(dashboard, /reportCategoryChart\(summary\.categories\|\|\{\},true\)/);
  assert.match(dashboard, /registrationTrendChart\(trendResult\.data,trendResult\.error\)/);
  assert.match(dashboard, /data-goto="directory" data-category="\$\{esc\(row\.id\)\}"/);
});

test('member-care dashboard keeps VIP care unavailable and avoids Admin-only VIP APIs', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  assert.match(dashboard, /function memberCareAvailability\(\)/);
  assert.match(dashboard, /VIP profiles/);
  assert.match(dashboard, /Not available/);
  assert.match(dashboard, /VIP follow-ups/);
  assert.match(dashboard, /Not tracked/);
  assert.match(dashboard, /VIP care requires a separate authorized workflow/);
  assert.match(dashboard, /VIP profiles are excluded from Youth Welfare tasks and reports/);
  assert.match(dashboard, /Tasks are administrative and limited to eligible non-VIP profiles/);
  assert.match(dashboard, /Do not enter health, safeguarding, pastoral, or other sensitive details/);
  assert.match(dashboard, /Your role cannot view follow-up tasks or notes/);
  assert.doesNotMatch(dashboard, /\/api\/tracker\/(?:registrations|registrationCounts|registration)(?:['"`/])/);
});

test('Reports auto-load authorized data and chart current categories accessibly', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  assert.match(dashboard, /wireGoto\(\);runSelectedReport\(\);/);
  assert.match(dashboard, /function reportCategoryChart\(categories=\{\},interactive=false\)/);
  assert.match(dashboard, /background:conic-gradient/);
  assert.match(dashboard, /aria-label="Current eligible profiles by Youth Welfare category:/);
  assert.match(dashboard, /Preparing the latest report/);
  assert.match(dashboard, /Category charts show current assignments; past categories are not available/);
  assert.match(dashboard, /Monthly registration trend/);
  assert.match(dashboard, /School-stop reasons are Admin-only and excluded from reports and exports/);
});

test('person profiles distinguish current Tracker assignments from registration audit details and filter VIP leaders', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  const youthApi = read('../src/youth-welfare.js');
  assert.match(dashboard, /Registration details/);
  assert.match(dashboard, /Event time/);
  assert.match(dashboard, /LifeGroup Tracker/);
  assert.ok(dashboard.includes("can('youth_welfare:tracker:view')||can('lifegroups:view')"));
  assert.ok(dashboard.includes('/lifegroup-tracker'));
  for (const field of ['Current Lifegroup', 'Network', 'Lifegroup leader', 'Network leader', 'Membership role', 'Membership tier', 'Joined date']) {
    assert.ok(dashboard.includes(`['${field}'`), `profile shows ${field}`);
  }
  assert.match(dashboard, /Tracker shows only the current group, network, leaders, role, tier, and join date/);
  assert.match(dashboard, /No registration event found\. An Admin may have linked this profile/);
  assert.match(youthApi, /return \{ \.\.\.person,welfare_record:welfareRecord,youth_welfare_record_exists:welfareRecordExists,pending_welfare_updates:pending\.rows,follow_up_history:followUpHistory,registration_details:details \}/);
  assert.match(youthApi, /registration_details:details\?\{event_at:details\.event_at,person_created:details\.person_created,leader_assigned:details\.leader_assigned\}:null/);
  assert.match(youthApi, /leader\.archived_at IS NULL/);
  assert.match(youthApi, /NOT EXISTS \(SELECT 1 FROM public\.vip_registrations vip WHERE vip\.person_id=leader\.id\)/);
  assert.match(youthApi, /NOT EXISTS \(SELECT 1 FROM public\.vip_registrations vip WHERE vip\.person_id=network_leader\.id\)/);
});

test('Tracker profile data is read-only, current-membership-only, and excludes restricted meeting and note details', () => {
  const youthApi = read('../src/youth-welfare.js');
  const app = read('../src/app.js');
  const start = youthApi.indexOf('export async function youthWelfareTrackerAssignment');
  const end = youthApi.indexOf('export async function setYouthWelfareCategory', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const trackerQuery = youthApi.slice(start, end);
  for (const fragment of [
    'FROM public.lifegroup_memberships', 'm.left_at IS NULL', 'public.lifegroups', 'public.networks',
    'group_leader.archived_at IS NULL', 'network_leader.archived_at IS NULL',
    'public.vip_registrations vip', 'joined_at',
  ]) assert.ok(trackerQuery.includes(fragment), `Tracker query includes ${fragment}`);
  assert.doesNotMatch(trackerQuery, /notes|meeting_attendance|lifegroup_meetings|devotion|history/i);
  assert.ok(app.includes('const requireYouthTrackerView='));
  assert.ok(app.includes("permissions.includes('youth_welfare:tracker:view')"));
  assert.ok(app.includes("permissions.includes('lifegroups:view')"));
});

test('Youth Welfare migration keeps category overrides separate and grants no browser table access', () => {
  const migration = read('../database/011_youth_welfare.sql');
  assert.match(migration, /youth_welfare_admin/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.youth_welfare_categories/);
  assert.match(migration, /REFERENCES public\.people\(id\) ON DELETE CASCADE/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.youth_welfare_categories FROM PUBLIC/);
  assert.doesNotMatch(migration, /UPDATE\s+public\.people|DELETE\s+FROM\s+public\.people|INSERT\s+INTO\s+public\.people/i);
});

test('Youth Welfare Viewer migration expands only the existing staff role constraint', () => {
  const migration = read('../database/013_youth_welfare_viewer.sql');
  assert.match(migration, /staff_users_role_id_check/);
  assert.match(migration, /youth_welfare_admin/);
  assert.match(migration, /youth_welfare_viewer/);
  assert.match(migration, /'013_youth_welfare_viewer'/);
  assert.doesNotMatch(migration, /CREATE TABLE|INSERT INTO public\.staff_users|UPDATE public\.staff_users|DELETE FROM public\.staff_users|DROP TABLE/i);
});

test('Youth Welfare access migration is additive, preserves primary roles, and grants no browser table access', () => {
  const migration = read('../database/014_youth_welfare_access.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.youth_welfare_access/);
  assert.match(migration, /user_id bigint PRIMARY KEY REFERENCES public\.staff_users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /role_id text NOT NULL CHECK \(role_id IN \('youth_welfare_admin','youth_welfare_viewer'\)\)/);
  assert.match(migration, /status text NOT NULL DEFAULT 'active' CHECK \(status IN \('active','revoked'\)\)/);
  assert.match(migration, /INSERT INTO public\.youth_welfare_access[\s\S]*?FROM public\.staff_users[\s\S]*?role_id IN \('youth_welfare_admin','youth_welfare_viewer'\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.youth_welfare_access FROM PUBLIC/);
  assert.match(migration, /'014_youth_welfare_access'/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM public\.people|UPDATE public\.people|ALTER TABLE public\.staff_users/i);
});

test('access routes are server-guarded and existing logins remain usable before the additive migration', () => {
  const app = read('../src/app.js');
  const auth = read('../src/auth.js');
  const service = read('../src/youth-welfare.js');
  for (const route of ["get('/data-status'", "get('/access'", "get('/access/search'", "get('/access/activity'", "put('/access/:userId'", "delete('/access/:userId'", "get('/reports/trend'"]) assert.ok(app.includes(route), `server exposes ${route}`);
  assert.match(app, /const requireYouthAccessManage=/);
  assert.match(app, /const protectYouthAccess=/);
  assert.match(app, /permissions\.includes\('youth_welfare:access:manage'\)/);
  assert.match(app, /permissions\.includes\('users:manage'\)/);
  assert.match(service, /logAction\(client,actor,'youth_welfare_access',id,action/);
  assert.match(service, /logAction\(client,actor,'youth_welfare_access',id,'access_revoked'/);
  assert.match(auth, /to_regclass\('public\.youth_welfare_access'\)/);
  assert.match(auth, /Keep existing LIFEGEN sessions usable until the additive access migration is applied/);
  assert.match(auth, /if\(error\?\.code!=='42P01'\)throw error/);
});

test('workspace UI and API provide distinct navigation sections with narrowly guarded writes', () => {
  const app = read('../src/app.js');
  const dashboard = read('../public/youth-welfare/index.html');
  for (const route of ['/data-quality', '/activity', '/tasks', '/saved-views', '/report-templates', '/reports/summary', '/reports/export.csv', '/search', '/reconciliation']) {
    assert.ok(app.includes(`'${route}'`), `API route ${route} exists`);
  }
  assert.match(app, /protectYouthWrite\('youth_welfare:classify'\)/);
  assert.match(app, /const protectYouthWrite=\(permission='youth_welfare:manage'\)/);
  assert.match(app, /const requireYouthManage=/);
  assert.match(app, /\/tasks\/assignees',requireYouthManage/);
  assert.match(app, /\/reports\/export\.csv',requireYouthManage/);
  assert.match(dashboard, /\['overview','Dashboard','DB'\]/);
  assert.match(dashboard, /\['directory','People','PM'\]/);
  assert.match(dashboard, /\['reports','Reports','RP'\]/);
  assert.match(dashboard, /\['status','Data Status','DS'\]/);
  assert.match(dashboard, /\['access','Members & Access','MA'\]/);
  assert.match(dashboard, /\['settings','Settings','ST'\]/);
  assert.match(dashboard, /\['tasks','Follow-ups','WF'\]/);
  assert.match(dashboard, /Activity Logs/);
  assert.match(dashboard, /Data Quality/);
  assert.match(dashboard, /Saved Views/);
  assert.match(dashboard, /Reports/);
  assert.match(dashboard, /Independent comparison unavailable/);
  assert.match(dashboard, /Category charts show current assignments; past categories are not available/);
  assert.match(dashboard, /VIP-linked people are excluded/);
  assert.doesNotMatch(dashboard, /historical attendance|attendance tracking/i);
});

test('Data Status reports live source checks, unavailable reconciliation, and truthful sync semantics', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  const service = read('../src/youth-welfare.js');
  const app = read('../src/app.js');
  assert.match(dashboard, /async function loadDataStatusPage\(\)/);
  assert.match(dashboard, /Source check only · no test registration or sync/);
  assert.match(dashboard, /Missing and conflicting record counts are unavailable, not zero/);
  assert.match(dashboard, /no separate login, database, or registration flow/);
  assert.match(dashboard, /attendance, devotion marks, notes, and membership history are excluded/i);
  assert.match(service, /max\(registration_event\.created_at\)::text AS latest/);
  assert.match(service, /JOIN public\.people p ON p\.id::text=registration_event\.entity_id/);
  assert.match(service, /direct_database_queries/);
  assert.match(service, /No independent source snapshot or separate synchronization job is configured/);
  assert.match(service, /to_regclass\('public\.youth_welfare_access'\)/);
  assert.match(service, /to_regclass\('public\.youth_welfare_records'\) IS NOT NULL AS welfare_records_table/);
  assert.match(service, /id:'youth_welfare_records',label:'Youth Welfare answers'/);
  assert.match(service, /welfare_schema_available:data\.welfare_schema_available/);
  assert.match(dashboard, /source\.id==='youth_welfare_records'/);
  assert.match(dashboard, /review_queue_available\?\'Available\'/);
  assert.match(dashboard, /needsMigration=state\.summary\?\.welfare_schema_available===false/);
  assert.match(app, /get\('\/data-status'/);
});

test('registration analytics use verified monthly audit events and distinct people without claiming historical categories', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  const service = read('../src/youth-welfare.js');
  const start = service.indexOf('export async function youthWelfareRegistrationTrend');
  const end = service.indexOf('function csvCell', start);
  const trendQuery = service.slice(start, end);
  assert.match(dashboard, /api\/youth-welfare\/reports\/trend/);
  assert.match(dashboard, /Distinct eligible people with a verified public-registration event by month/);
  assert.match(trendQuery, /registration_event\.entity='people'/);
  assert.match(trendQuery, /registration_event\.action='public_registration'/);
  assert.match(trendQuery, /count\(DISTINCT p\.id\)::int AS people/);
  assert.match(trendQuery, /date_trunc\('month',registration_event\.created_at AT TIME ZONE 'Asia\/Manila'\)/);
  assert.match(trendQuery, /historical category snapshots are unavailable/);
  assert.match(trendQuery, /const eligible=eligiblePredicate\(\)/);
});

test('access management UI grants existing accounts, protects self and LIFEGEN admins, and exposes audit history', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  const service = read('../src/youth-welfare.js');
  assert.match(dashboard, /function canAccessPage\(page\)/);
  assert.match(dashboard, /NAV\.filter\(\(\[id\]\)=>canAccessPage\(id\)/);
  assert.match(dashboard, /id="sidebarCollapse"/);
  assert.match(dashboard, /function sidebarIsCollapsed\(\)/);
  assert.match(dashboard, /aria-pressed/);
  assert.match(dashboard, /async function loadAccessPage\(\)/);
  assert.match(dashboard, /Choose an active LIFEGEN account/);
  assert.match(dashboard, /No account is created or main role changed/);
  assert.match(dashboard, /data-search-grant/);
  assert.match(dashboard, /data-revoke-access/);
  assert.match(dashboard, /Your access cannot be changed here/);
  assert.match(dashboard, /LIFEGEN Admin · full access/);
  assert.match(dashboard, /Access history/);
  assert.match(dashboard, /Access management unavailable/);
  assert.match(dashboard, /The access migration may be missing/);
  assert.match(service, /access_granted/);
  assert.match(service, /access_role_changed/);
  assert.match(service, /access_revoked/);
});

test('Youth Welfare Settings use the shared staff account and document enforced role/privacy boundaries', () => {
  const dashboard = read('../public/youth-welfare/index.html');
  assert.match(dashboard, /async function loadSettingsPage\(\)/);
  assert.match(dashboard, /existing LIFEGEN accounts/);
  assert.match(dashboard, /Permissions are checked on every request/);
  assert.match(dashboard, /School-stop reasons are Admin-only and excluded from reports and exports/);
  assert.match(dashboard, /Password changes update your LIFEGEN account and end other sessions/);
  assert.match(dashboard, /data-goto="status"/);
});

test('general reports and CSV exports do not include individual school-exit reasons', () => {
  const service = read('../src/youth-welfare.js');
  const app = read('../src/app.js');
  const start = service.indexOf('export async function youthWelfareCsv');
  const end = service.indexOf('export async function youthWelfareGlobalSearch', start);
  const csv = service.slice(start, end);
  assert.doesNotMatch(csv, /school_stop_reasons|school_exit_reason|contact_number|parent_guardian/i);
  assert.match(csv, /Education status/);
  assert.match(csv, /LCSOL progress/);
  assert.match(csv, /Course \/ Year/);
  assert.match(csv, /Occupation/);
  assert.match(app, /reports\/export\.csv',requireYouthManage/);
  assert.match(service, /current Youth Welfare classifications for those people; no historical category snapshots exist/);
});

test('People Management filters, tabs, and report presets are allow-listed', () => {
  const defaults={q:'',category:'all',missing:'all',education_status:'all',lcsol_enrolled:'all',tab:'all',age_min:null,age_max:null,cell_leader:'all',lcsol_status:'all',verification_status:'all'};
  assert.deepEqual(YOUTH_WELFARE_PEOPLE_TABS.map(({id})=>id),['all','students','out_of_school','als','working_students','graduated','incomplete']);
  assert.deepEqual(YOUTH_WELFARE_PEOPLE_TABS.map(({label})=>label),['All People','Students','Out-of-School','ALS','Working Students','Graduated','Incomplete']);
  assert.deepEqual(normalizeYouthFilters({ q: '  Ana  ', category: 'student', missing: 'email' }), {...defaults,q:'Ana',category:'student',missing:'email'});
  assert.deepEqual(normalizeYouthFilters({q:'Kai',education_status:'out_of_school',lcsol_enrolled:'yes',tab:'out_of_school',age_min:'16',age_max:'24',cell_leader:'person:42',lcsol_status:'sol_1',verification_status:'verified'}),{
    ...defaults,q:'Kai',education_status:'out_of_school',lcsol_enrolled:'yes',tab:'out_of_school',age_min:16,age_max:24,cell_leader:'person:42',lcsol_status:'sol_1',verification_status:'verified',
  });
  assert.throws(() => normalizeYouthFilters({ category: 'vip' }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ missing: 'occupation' }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ education_status: 'guessed_from_school' }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ lcsol_enrolled: 'maybe' }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ tab: 'vip' }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ age_min: 121 }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ age_min: 20, age_max: 16 }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ cell_leader: 'person:zero' }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ lcsol_status: 'guessed' }), error => error.status === 400);
  assert.throws(() => normalizeYouthFilters({ verification_status: 'unknown' }), error => error.status === 400);
  assert.deepEqual(normalizeYouthFilters({ missing: 'review' }), {...defaults,missing:'review'});
  assert.deepEqual(normalizeYouthFilters({ missing: 'duplicates' }), {...defaults,missing:'duplicates'});
  assert.ok(YOUTH_REPORT_TEMPLATES.some(template => template.type === 'registration_summary'));
  assert.ok(YOUTH_REPORT_TEMPLATES.every(template => ['registration_summary','current_directory','data_quality','tasks'].includes(template.type)));
  assert.deepEqual(YOUTH_REPORT_TEMPLATES.map(({name})=>name),['Monthly registrations','Quarterly registrations','People directory','Data quality','Follow-ups']);
});

test('People is a routed directory with protected data-backed tabs, filters, profiles, and Add Member APIs', () => {
  const app=read('../src/app.js'),auth=read('../src/auth.js'),service=read('../src/youth-welfare.js'),ui=read('../public/youth-welfare/index.html');
  for(const route of ["get('/people'","get('/cell-leaders'","get('/people/:id'","post('/people/duplicate-check'","post('/people'"])assert.ok(app.includes(route),`protected People Management API ${route}`);
  assert.match(app,/requireYouthPeopleAdd/);
  assert.match(auth,/youth_welfare:people:add/);
  assert.match(ui,/\['directory','People','PM'\]/);
  assert.match(ui,/role="tablist" aria-label="People categories"/);
  assert.match(ui,/All People/);
  for(const tab of ['students','out_of_school','als','working_students','graduated','incomplete'])assert.ok(ui.includes(`id:'${tab}'`)||ui.includes(`id:"${tab}"`),`UI tab ${tab}`);
  assert.match(ui,/directory\/profile/);
  assert.match(ui,/profileBackToPeople/);
  assert.match(ui,/Back to People/);
  assert.match(service,/domain\.createPerson/);
  assert.match(ui,/people\/duplicate-check/);
  assert.match(ui,/manual_review_confirmed/);
  assert.match(ui,/directoryAgeMin/);
  assert.match(ui,/directoryEducation/);
  assert.match(ui,/directoryCellLeader/);
  assert.match(ui,/directoryLcsolStatus/);
  assert.match(ui,/directoryVerification/);
  assert.match(ui,/scrollbar-width:thin/);
  assert.match(ui,/directoryRequestId/);
  assert.match(ui,/peopleTableElement/);
  assert.doesNotMatch(ui,/profileModal|memberProfileModal|profile-overlay/);
  assert.match(service,/YOUTH_WELFARE_PEOPLE_TABS/);
  assert.match(service,/count\(\*\) FILTER \(WHERE welfare\.education_status/);
  assert.match(service,/welfareIncompletePredicate/);
  assert.match(service,/withState\(async\(\{data,client,context\}\)/);
  assert.match(service,/await context\.flush\(\)/);
});

test('similar-name duplicate candidates require review without auto-linking, and bounded searches block creation', () => {
  assert.equal(isPossibleSimilarYouthName({first_name:'Catherine',last_name:'Smith'},{first_name:'Cathrine',last_name:'Smith'}),true);
  assert.equal(isPossibleSimilarYouthName({first_name:'Maria',last_name:'Garcia'},{first_name:'Mara',last_name:'Garcia'}),true);
  assert.equal(isPossibleSimilarYouthName({first_name:'José',last_name:'García'},{first_name:'Jose',last_name:'Garcia'}),true);
  assert.equal(isPossibleSimilarYouthName({first_name:'Anne-Marie',last_name:'O’Neil'},{first_name:'Anne Marie',last_name:'ONeil'}),true);
  assert.equal(isPossibleSimilarYouthName({first_name:'Demo',last_name:'Person 01'},{first_name:'Demo',last_name:'Person 02'}),false);
  assert.equal(isPossibleSimilarYouthName({first_name:'Catherine',last_name:'Smith'},{first_name:'Catherine',last_name:'Smith'}),false);
  assert.equal(isPossibleSimilarYouthName({first_name:'Catherine',last_name:'Smith'},{first_name:'Catherine',last_name:'Jones'}),false);
  const service=read('../src/youth-welfare.js');
  const ui=read('../public/youth-welfare/index.html');
  assert.match(service,/LIMIT 501/);
  assert.match(service,/directRows\.length===25\|\|nameCandidates\.length>500/);
  assert.match(service,/orderedMatches\.length>25/);
  assert.match(service,/if\(duplicates\.search_limited\)throw httpError\(409/);
  assert.match(service,/similar name — manual review/);
  assert.match(service,/sameNameOnly\.length>0/);
  assert.match(service,/if\(duplicates\.ambiguous&&!member\.manual_review_confirmed\)/);
  assert.match(service,/manual_review_confirmed:member\.manual_review_confirmed/);
  assert.match(ui,/More records need review/);
  assert.match(ui,/duplicateResult\.search_limited\?\'/);
  assert.match(ui,/if\(duplicateResult\.search_limited\)\{showMessage/);
  assert.match(ui,/confirmManualReview/);
  assert.match(ui,/manual_review_confirmed:manualReviewConfirmed/);
});

test('administrator backup includes Youth Welfare workspace tables without exposing them through browser APIs', () => {
  const db = read('../src/db.js');
  const app = read('../src/app.js');
  for (const table of ['youth_welfare_categories','youth_welfare_records','youth_welfare_record_updates','youth_welfare_record_history','public_registration_requests','youth_welfare_access','youth_welfare_follow_up_tasks','youth_welfare_saved_views','youth_welfare_report_templates','youth_welfare_reminder_dismissals']) {
    assert.ok(db.includes(`state.${table}=`), `backup includes ${table}`);
  }
  assert.match(app, /app\.get\('\/api\/backup',requireStaff/);
  assert.match(app, /requirePermission\(req\.actor,'settings:manage'\)/);
});

test('workspace migration creates only additive, server-mediated tables with RLS', () => {
  const migration = read('../database/012_youth_welfare_workspace.sql');
  for (const table of ['youth_welfare_follow_up_tasks','youth_welfare_saved_views','youth_welfare_report_templates','youth_welfare_reminder_dismissals']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.%I ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM %I/);
  assert.match(migration, /REFERENCES public\.people\(id\) ON DELETE CASCADE/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM public\.people|UPDATE public\.people/i);
});

test('Youth Welfare migration 015 stores answers separately and protects corrections, history, and idempotency', () => {
  const migration = read('../database/015_youth_welfare_records.sql');
  for (const table of ['youth_welfare_records','youth_welfare_record_updates','youth_welfare_record_history','public_registration_requests']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.match(migration, /school_stop_reasons text\[\] NOT NULL DEFAULT ARRAY\[\]::text\[\]/);
  assert.match(migration, /welfare_consent_at timestamptz/);
  assert.match(migration, /source text NOT NULL DEFAULT 'public_registration'/);
  assert.match(migration, /request_hash text UNIQUE/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS staff_users_role_id_check/);
  assert.match(migration, /'youth_welfare_staff','youth_welfare_viewer'/);
  assert.match(migration, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM %I/);
  assert.doesNotMatch(migration, /UPDATE public\.people|ALTER TABLE public\.people|DROP TABLE|TRUNCATE/i);
});
