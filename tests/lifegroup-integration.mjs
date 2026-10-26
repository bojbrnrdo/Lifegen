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
let personId = null, registrationId = null, groupId = null, meetingId = null, membershipId = null, checkinId = null, checkinServiceId = null;
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

  const repeated = await json('/api/public/registrations', {
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
  assert.equal(Number(repeated.vip.id), registrationId, 'replayed registration retains original VIP registration');
  assert.equal(Number(repeated.vip.person_id), personId, 'replayed registration retains original Person');
  assert.equal(repeated.already_registered, true, 'repeated registration reports an existing registration');

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
  // Verify durable Cell meeting attendance belongs to the canonical People ID,
  // and saving the same meeting again does not create duplicate attendance.
  const verifyClient = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await verifyClient.connect();
  try {
    const before = await verifyClient.query(
      'SELECT count(*)::int AS total FROM lifegroup_meeting_attendance WHERE meeting_id=$1 AND person_id=$2',
      [meetingId, personId],
    );
    assert.equal(before.rows[0].total, 1, 'Cell meeting attendance is linked to the registered Person exactly once');
    const repeatedMeeting = await json('/api/tracker/saveMeeting', {
      method: 'POST',
      body: { args: [groupId, { meeting_date: meetingDate, held: true, present_ids: [personId], devotion_ids: [] }] },
      auth: session,
    });
    assert.equal(Number(repeatedMeeting.meeting_id), meetingId, 're-saving a Cell meeting reuses its record');
    const after = await verifyClient.query(
      'SELECT count(*)::int AS total FROM lifegroup_meeting_attendance WHERE meeting_id=$1 AND person_id=$2',
      [meetingId, personId],
    );
    assert.equal(after.rows[0].total, 1, 're-saving a Cell meeting does not duplicate attendance');
  } finally {
    await verifyClient.end();
  }



  // Local-only check-in validation cycle. Creates a pending check-in directly
  // because the public submission endpoint rightly refuses non-Sunday requests.
  // This exercises the real administrator validation endpoint and records.
  const checkinClient = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await checkinClient.connect();
  try {
    const { allocateId } = await import('../src/db.js');
    checkinId = await allocateId(checkinClient, 'vip_checkins');
    await checkinClient.query(
      'INSERT INTO vip_checkins(id,registration_id,date_key,status) VALUES($1,$2,$3,$4)',
      [checkinId, registrationId, meetingDate, 'pending'],
    );
    const pending = await json('/api/tracker/pendingCheckins', { method: 'POST', body: { args: [] }, auth: session });
    assert.ok(pending.some(c => Number(c.id) === checkinId && Number(c.person_id) === personId),
      'pending check-in appears under original People ID');
    const approved = await json('/api/tracker/validateCheckin', {
      method: 'POST', body: { args: [checkinId, true] }, auth: session,
    });
    assert.equal(approved.status, 'valid', 'admin can approve pending check-in');
    const attendance = await checkinClient.query(
      "SELECT r.id,r.source,r.source_checkin_id,r.service_id FROM records r JOIN services s ON s.id=r.service_id WHERE r.person_id=$1 AND s.service_date=$2 AND r.status='present'",
      [personId, meetingDate],
    );
    assert.equal(attendance.rows.length, 1, 'approval records exactly one Sunday attendance');
    assert.equal(attendance.rows[0].source_checkin_id, checkinId, 'attendance references the validated check-in');
    checkinServiceId = Number(attendance.rows[0].service_id);

    const declined = await json('/api/tracker/validateCheckin', {
      method: 'POST', body: { args: [checkinId, false] }, auth: session,
    });
    assert.equal(declined.status, 'invalid', 'admin can decline the check-in');
    const removed = await checkinClient.query('SELECT count(*)::int total FROM records WHERE person_id=$1 AND service_id=$2', [personId,checkinServiceId]);
    assert.equal(removed.rows[0].total, 0, 'declining undoes only check-in-sourced attendance');

    // Equivalent persistence state to an allowed retry, then validate again.
    await checkinClient.query("UPDATE vip_checkins SET status='pending',validated_by=NULL,validated_at=NULL WHERE id=$1", [checkinId]);
    const approvedAgain = await json('/api/tracker/validateCheckin', {
      method: 'POST', body: { args: [checkinId, true] }, auth: session,
    });
    assert.equal(approvedAgain.status, 'valid', 'retried check-in can be validated');
    const once = await checkinClient.query('SELECT count(*)::int total FROM records WHERE person_id=$1 AND service_id=$2', [personId,checkinServiceId]);
    assert.equal(once.rows[0].total, 1, 're-validation does not duplicate Sunday attendance');
  } finally {
    await checkinClient.end();
  }

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
    if (checkinServiceId) {
      await cleanupClient.query('DELETE FROM records WHERE service_id=$1 AND person_id=$2', [checkinServiceId, personId]);
      await cleanupClient.query('DELETE FROM services WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM records WHERE service_id=$1)', [checkinServiceId]);
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
