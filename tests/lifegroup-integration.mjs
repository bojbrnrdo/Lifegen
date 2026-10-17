import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const databaseUrl = process.env.LIFEGEN_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  console.error('Set LIFEGEN_INTEGRATION_DATABASE_URL to an isolated local PostgreSQL test database.');
  process.exit(2);
}
const parsed = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
  console.error('Refusing integration writes: LIFEGEN_INTEGRATION_DATABASE_URL must be local.');
  process.exit(2);
}
if (!process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD) {
  console.error('Set LIFEGEN_INTEGRATION_ADMIN_PASSWORD for an existing test admin account.');
  process.exit(2);
}

// Both connections must stay on a loopback host: migrations and app writes
// may use DATABASE_DIRECT_URL independently of DATABASE_URL.
const directUrl = process.env.LIFEGEN_INTEGRATION_DIRECT_URL || databaseUrl;
let directParsed;
try { directParsed = new URL(directUrl); }
catch { console.error('LIFEGEN_INTEGRATION_DIRECT_URL must be a valid local PostgreSQL URL.'); process.exit(2); }
if (!['localhost', '127.0.0.1', '::1'].includes(directParsed.hostname)) {
  console.error('Refusing integration writes: LIFEGEN_INTEGRATION_DIRECT_URL must be local.');
  process.exit(2);
}

process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_DIRECT_URL = directUrl;
process.env.LOCAL_DEMO = 'true';
process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/app.js');
const { closePool } = await import('../src/db.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = `http://127.0.0.1:${server.address().port}`;
const idempotencyKey = crypto.randomBytes(18).toString('hex');
let personId = null, registrationId = null, groupId = null, meetingId = null, membershipId = null;
let cleanupClient;

async function json(path, { method = 'GET', body, auth = null } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
      ...(auth ? { 'X-Lifegen-Preview-Session': auth.token, 'X-CSRF-Token': auth.csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.ok, true, `${method} ${path}: ${data.message || response.status}`);
  return data;
}

try {
  const auth = await json('/api/auth/login', {
    method: 'POST',
    body: { username: process.env.LIFEGEN_INTEGRATION_ADMIN_USERNAME || 'demo@lifegen.local', password: process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD },
  });
  assert.ok(auth.user?.permissions?.includes('lifegroups:manage'), 'integration admin can manage Lifegroups');
  const session = { token: auth.preview_session_token, csrf: auth.csrf_token };
  assert.ok(session.token && session.csrf, 'preview login provides a scoped test session');

  const registration = await json('/api/public/registrations', {
    method: 'POST',
    body: {
      full_name: `Tracker QA ${idempotencyKey.slice(0, 8)}`,
      age: 22,
      school: 'Local integration test',
      inviter: 'Automated test',
      privacy_consent: true,
      idempotency_key: idempotencyKey,
    },
  });
  personId = Number(registration.vip.person_id);
  registrationId = Number(registration.vip.id);
  assert.ok(personId > 0 && registrationId > 0, 'VIP registration creates linked Person and registration rows');

  const needs = await json('/api/tracker/lifegroupNeeds', { method: 'POST', body: { args: [{}] }, auth: session });
  const queuedVip = needs.find((row) => row.id === personId);
  assert.ok(queuedVip?.is_vip, 'new public VIP is immediately in the Lifegroup needs queue and identified as a VIP');

  // Public signup may not include gender. The automatic matcher must not
  // guess it or create a membership; staff can complete the profile first.
  const pendingAuto = await json('/api/tracker/autoAssignLifegroup', {
    method: 'POST',
    body: { args: [personId, {}] },
    auth: session,
  });
  assert.equal(pendingAuto.assigned, false, 'VIP without gender cannot be auto-assigned');
  assert.equal(pendingAuto.reason, 'sex_missing', 'missing gender is explicitly reported');
  assert.equal(pendingAuto.needs_manual_assignment, true, 'VIP remains queued for manual review');
  const pendingNeeds = await json('/api/tracker/lifegroupNeeds', {
    method: 'POST', body: { args: [{}] }, auth: session,
  });
  assert.ok(pendingNeeds.some((row) => row.id === personId), 'unassigned VIP remains in follow-up queue');

  const group = await json('/api/tracker/createLifegroup', {
    method: 'POST',
    body: { args: [{ name: `Integration ${idempotencyKey.slice(0, 8)}`, gender: 'boys', is_demo: true }] },
    auth: session,
  });
  groupId = Number(group.id);
  assert.ok(groupId > 0, 'admin can create a Lifegroup');

  const joined = await json('/api/tracker/assignLifegroup', {
    method: 'POST',
    body: { args: [groupId, personId, { sex: 'male', joined_at: new Date().toISOString().slice(0, 10), tier: 'new' }] },
    auth: session,
  });
  membershipId = Number(joined.current?.id);
  assert.equal(joined.current?.lifegroup_id, groupId, 'VIP becomes an active Lifegroup member');

  const afterAssign = await json('/api/tracker/lifegroupNeeds', { method: 'POST', body: { args: [{}] }, auth: session });
  assert.equal(afterAssign.some((row) => row.id === personId), false, 'assigned VIP leaves the unassigned follow-up queue');
  const detail = await json('/api/tracker/lifegroup', { method: 'POST', body: { args: [groupId] }, auth: session });
  assert.ok(detail.members.some((member) => member.id === personId && member.is_vip), 'VIP identity follows the person into the group roster');

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const meetingDay = new Date(`${today}T12:00:00+08:00`);
  if (meetingDay.getUTCDay() !== 0) meetingDay.setUTCDate(meetingDay.getUTCDate() - meetingDay.getUTCDay());
  const meetingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(meetingDay);
  const report = await json('/api/tracker/saveMeeting', {
    method: 'POST',
    body: { args: [groupId, { meeting_date: meetingDate, held: true, present_ids: [personId], devotion_ids: [] }] },
    auth: session,
  });
  meetingId = Number(report.meeting_id);
  assert.ok(report.progress.members.some((member) => member.id === personId && member.is_vip), 'Lifegroup meeting report and progress include the linked VIP');

  console.log('PASS: public VIP signup → Lifegroup needs queue → assign to group → attendance report/progress.');
} finally {
  try {
    cleanupClient = new pg.Client({ connectionString: databaseUrl, ssl: false });
    await cleanupClient.connect();
    await cleanupClient.query('BEGIN');
    if (groupId) {
      await cleanupClient.query('DELETE FROM lifegroup_meetings WHERE lifegroup_id=$1', [groupId]);
      await cleanupClient.query('DELETE FROM lifegroup_memberships WHERE lifegroup_id=$1 OR person_id=$2', [groupId, personId]);
      await cleanupClient.query('DELETE FROM lifegroups WHERE id=$1', [groupId]);
    }
    if (registrationId) {
      await cleanupClient.query('DELETE FROM vip_sessions WHERE registration_id=$1', [registrationId]);
      await cleanupClient.query('DELETE FROM vip_checkins WHERE registration_id=$1', [registrationId]);
      await cleanupClient.query('DELETE FROM vip_registrations WHERE id=$1', [registrationId]);
    }
    if (personId) {
      await cleanupClient.query('DELETE FROM audit WHERE person_id=$1', [personId]);
      await cleanupClient.query("DELETE FROM audit_log WHERE (entity='people' AND entity_id=$1) OR (entity='vip_registrations' AND entity_id=$2)", [String(personId), String(registrationId)]);
      await cleanupClient.query('DELETE FROM people WHERE id=$1', [personId]);
    }
    if (meetingId) await cleanupClient.query('DELETE FROM audit_log WHERE entity=\'lifegroup_meetings\' AND entity_id=$1', [String(meetingId)]);
    if (membershipId) await cleanupClient.query('DELETE FROM audit_log WHERE entity=\'lifegroup_memberships\' AND entity_id=$1', [String(membershipId)]);
    if (groupId) await cleanupClient.query('DELETE FROM audit_log WHERE entity=\'lifegroups\' AND entity_id=$1', [String(groupId)]);
    await cleanupClient.query('COMMIT');
  } catch (error) {
    await cleanupClient?.query('ROLLBACK').catch(() => {});
    console.error('Integration cleanup failed; inspect only the local disposable database:', error.message);
    process.exitCode = 1;
  } finally {
    await cleanupClient?.end().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await closePool();
  }
}
