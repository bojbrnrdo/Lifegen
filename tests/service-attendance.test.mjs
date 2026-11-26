// Service Attendance — contract tests.
//
// The page itself is exercised in tests/attendance-admin.jsdom.mjs (needs jsdom).
// These checks are about the guarantees that must not quietly rot:
//
//   * the migration is additive, Sunday-only, private, and live-updating;
//   * a VIP's presence is still the validated VIP check-in — the page must never
//     write a second, competing record for the same person and Sunday;
//   * a check-in that came from the mobile QR cannot be deleted by the register;
//   * the endpoints are permission-gated on the server and listed in the client;
//   * the register payload carries no private contact/profile fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { redactForViewer } from '../src/auth.js';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const server = read('src/app.js');
const module_ = read('src/service-attendance.js');
const api = read('public/admin/js/api.js');
const shell = read('public/admin/js/app.js');
const view = read('public/admin/js/views/attendance.js');
const css = read('public/admin/attendance.css');
const migration = read('database/018_service_attendance.sql');

test('migration 018 is additive, Sunday-only and private', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS service_attendance/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS service_headcounts/);
  // A row can only belong to a Sunday, and a person is recorded once per Sunday.
  assert.match(migration, /date_key date NOT NULL CHECK\(EXTRACT\(DOW FROM date_key\)=0\)/);
  assert.match(migration, /UNIQUE\(date_key, person_id\)/);
  assert.match(migration, /headcount integer NOT NULL DEFAULT 0 CHECK\(headcount BETWEEN 0 AND 100000\)/);
  // Same privacy posture as every other table.
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC/);
  assert.match(migration, /ARRAY\['anon','authenticated'\]/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE TRIGGER lifegen_changed/);
  assert.match(migration, /INSERT INTO id_counters\(entity\) VALUES \('service_attendance'\) ON CONFLICT DO NOTHING/);
  // No destructive statement: this migration may not drop or rename anything.
  // Only the rollback note in the header may mention DROP, so strip comments first.
  const statements = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /DROP TABLE|DROP COLUMN|RENAME TO/);
  assert.match(migration, /INSERT INTO schema_migrations\(version\) VALUES\('018_service_attendance'\)/);
});

test('a VIP check-in stays the one record of VIP attendance', () => {
  // Marking a VIP present writes vip_checkins and removes any roster row, so the
  // VIP portal, prize streak and Gift Tracker cannot disagree with this page.
  assert.match(module_, /INSERT INTO vip_checkins\(id, registration_id, date_key, status, validated_by, validated_at, extras\)/);
  assert.match(module_, /DELETE FROM service_attendance WHERE date_key=\$1::date AND person_id=\$2/);
  // Un-marking only removes the check-in this page created.
  assert.match(module_, /extras\.service_attendance/);
  assert.match(module_, /This VIP checked in through the service QR/);
  assert.match(module_, /locked: true/);
  // The first verified Sunday is the person's date first attended, as before.
  assert.match(module_, /SET date_first_attended=\$1::date/);
});

test('the register reads every source of Sunday presence', () => {
  assert.match(module_, /FROM service_attendance/);
  assert.match(module_, /FROM vip_checkins/);
  assert.match(module_, /status='valid'/);
  assert.match(module_, /FROM service_headcounts/);
  // A past Sunday must not grow when someone registers later on.
  assert.match(module_, /p\.date_registered <= \$1::date/);
  // A VIP with no earlier Sunday is a first timer even after they check in
  // today, so the roll call says FIRST TIMER the moment they arrive.
  assert.match(module_, /vip_sundays_before/);
  assert.match(module_, /const firstTimer = category === 'vip' && Number\(p\.vip_sundays_before \|\| 0\) === 0/);
  assert.match(module_, /p\.archived_at IS NULL/);
  // The token chip is a read-only count of gifts already recorded, never a
  // second place where a gift is written.
  assert.match(module_, /FROM vip_gift_handouts/);
  assert.match(module_, /tokens_given: tokensGiven/);
  // Logged like every other write, so the audit trail stays complete.
  assert.match(module_, /logAction\(client, actor, 'service_attendance'/);
  assert.match(module_, /logAction\(client, actor, 'service_headcounts'/);
});

test('the register payload carries no private profile or contact fields', () => {
  const select = module_.slice(module_.indexOf('export async function serviceAttendanceRegister'), module_.indexOf('export async function serviceAttendanceReport'));
  // `inviter` is deliberately present: the roll call shows who brought a VIP,
  // the same name the VIP portal already shows. No contact detail is selected.
  for (const field of ['contact_number', 'email', 'address', 'birthdate', 'school', 'notes']) {
    assert.doesNotMatch(select, new RegExp(`\\b${field}\\b`), `${field} must not be selected into the roll call`);
  }
});

test('the endpoints are permission-gated on the server', () => {
  for (const method of ['serviceAttendance', 'serviceAttendanceReport', 'serviceAttendanceUnrecorded']) {
    assert.ok(server.includes(`${method}:['people:view',false]`), `${method} must require people:view`);
  }
  for (const method of ['setServiceAttendance', 'setServiceAttendanceCategory', 'setServiceHeadcount', 'addServiceAttendancePerson']) {
    assert.ok(server.includes(`${method}:['registrations:manage',true]`), `${method} must require registrations:manage and be a write`);
    assert.match(server, new RegExp(`if\\(name==='${method}'\\)`), `${method} must be handled`);
  }
  // Every write answers with the fresh register, so several devices stay in step.
  assert.match(server, /return \{\.\.\.result,register:await serviceAttendanceRegister\(\{dateKey:input\.dateKey\}\)\}/);
});

test('the client knows every method the page calls', () => {
  for (const method of ['serviceAttendance', 'serviceAttendanceReport', 'serviceAttendanceUnrecorded', 'setServiceAttendance', 'setServiceAttendanceCategory', 'setServiceHeadcount', 'addServiceAttendancePerson']) {
    assert.match(api, new RegExp(`'${method}'`), `${method} is missing from public/admin/js/api.js`);
    assert.match(view, new RegExp(`api\\.${method}\\(`), `${method} is unused by the page`);
  }
});

test('the page is an Admin route with its own navigation entry', () => {
  assert.match(shell, /path: \/\^\\\/attendance\$\/, view: renderServiceAttendance, nav: 'attendance', perm: 'people:view'/);
  assert.match(shell, /navLink\('#\/attendance', 'attendance', 'Attendance', 'check'\)/);
  assert.match(shell, /can\('people:view'\) && !state\.standalone/);
});

test('the page keeps every part of the Service Attendance design', () => {
  // A roll call with one tap per person, a Sunday picker, the headcount, the
  // follow-up queue, the month report, the history sheet and walk-in check-in.
  for (const id of ['saPrev', 'saNext', 'saToday', 'saDateInput', 'saHcInput', 'saHcMinus', 'saHcPlus', 'saSearch', 'saTabs', 'saList', 'saFollowup', 'saReport', 'saReportCopy', 'saAdd', 'saMarkAll', 'saPrint']) {
    assert.match(view, new RegExp(`id="${id}"`), `${id} is missing`);
  }
  assert.match(view, /function stats\(data\)/);
  assert.match(view, /function giftProgress\(item, ctx\)/);
  assert.match(view, /aria-pressed="\$\{item\.present \? 'true' : 'false'\}"/);
  // Read-only roles see the register but get no controls that would fail.
  assert.match(view, /const writable = \(\) => can\('registrations:manage'\)/);
  assert.match(view, /disabled/);
});

test('the register is styled by a versioned stylesheet', () => {
  assert.match(read('public/admin/index.html'), /\/admin\/attendance\.css\?v=\d+\.\d+\.\d+/);
  for (const part of ['.sa-datebar', '.sa-ring', '.sa-check', '.sa-fu', '.sa-hist', '.sa-match', '.sa-hero', '.sa-seg', '.sa-fab', '.sa-step', '@media print', 'prefers-reduced-motion']) {
    assert.ok(css.includes(part), `${part} is missing from attendance.css`);
  }
  // The tap target at the door must not shrink.
  assert.match(css, /\.app \.sa-check \{[^}]*width: 46px; height: 46px/);
});

test('a Viewer keeps the month map but still loses private person fields', () => {
  // The register answers with month_attendance keyed by Person id. The Viewer
  // redaction used to empty any object it did not recognise as a person, which
  // silently removed the whole map; it must survive while contact details do not.
  const register = {
    date: '2026-11-22',
    headcount: 12,
    month_attendance: { 41: ['2026-11-01', '2026-11-22'], 42: [] },
    items: [{ first_name: 'Maria', last_name: 'Santos', full_name: 'Maria Santos', contact_number: '0917', email: 'maria@example.test', address: 'Bulacan' }],
  };
  const safe = redactForViewer(register);
  assert.deepEqual(safe.month_attendance, { 41: ['2026-11-01', '2026-11-22'], 42: [] });
  assert.equal(safe.headcount, 12);
  assert.equal(safe.items[0].contact_number, undefined);
  assert.equal(safe.items[0].email, undefined);
  assert.equal(safe.items[0].address, undefined);
  assert.equal(safe.items[0].full_name, 'Maria Santos');
});
