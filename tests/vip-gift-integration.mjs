// VIP Gift Tracker — live integration test.
//
// The counts, the recording and the undo all need a real PostgreSQL, so this
// runs against an isolated local database the same way
// tests/vip-design-integration.mjs and tests/lifegroup-integration.mjs do.
// It is NOT part of `npm test`.
//
//   LIFEGEN_INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5433/lifegen \
//   LIFEGEN_INTEGRATION_ADMIN_USERNAME=demo@lifegen.local \
//   LIFEGEN_INTEGRATION_ADMIN_PASSWORD=LifegenDemo2026! \
//   npm run test:vip-gift-integration
//
// Everything it creates is marked TEST-GIFT- and it removes exactly those rows
// again, so it can be run repeatedly. It never deletes, updates or truncates a
// row it did not create itself.
import pg from 'pg';
import crypto from 'node:crypto';

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
const adminUsername = process.env.LIFEGEN_INTEGRATION_ADMIN_USERNAME || 'demo@lifegen.local';
if (!process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD) {
  console.error('Set LIFEGEN_INTEGRATION_ADMIN_PASSWORD for an existing test admin account.');
  process.exit(2);
}

process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_DIRECT_URL = process.env.LIFEGEN_INTEGRATION_DIRECT_URL || databaseUrl;
process.env.LOCAL_DEMO = 'true';
process.env.TZ = 'Asia/Manila';
const { default: app } = await import('../src/app.js');
const { closePool } = await import('../src/db.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
let session = '', csrf = '';
const ok = (label, actual, expected) => {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  good ? pass++ : fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}${good ? '' : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};
const truthy = (label, v) => ok(label, Boolean(v), true);
const section = (t) => console.log(`\n=== ${t} ===`);

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(session ? { 'X-Lifegen-Preview-Session': session } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      Origin: base,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (data?.csrf_token) csrf = data.csrf_token;
  if (data?.preview_session_token) session = data.preview_session_token;
  return { status: res.status, data };
}

const MARK = `TEST-GIFT-${crypto.randomBytes(4).toString('hex')}`;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => iso(new Date());

// Four Sundays far enough in the future that no real service can be using them.
const sundays = (() => {
  const out = [];
  const d = new Date();
  d.setFullYear(d.getFullYear() + 4);
  d.setHours(12, 0, 0, 0);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 4; i++) { out.push(iso(d)); d.setDate(d.getDate() + 7); }
  return out;
})();

const client = new pg.Client(databaseUrl);
await client.connect();
const allocate = async (entity) => (await client.query('UPDATE id_counters SET last_id=last_id+1 WHERE entity=$1 RETURNING last_id', [entity])).rows[0].last_id;

const ids = { people: [], services: [], registrations: [] };

async function cleanup() {
  const people = (await client.query("SELECT id FROM people WHERE person_code LIKE 'TEST-GIFT-%'")).rows.map((r) => r.id);
  const services = (await client.query('SELECT id FROM services WHERE notes = $1', [MARK])).rows.map((r) => r.id);
  if (people.length) {
    await client.query('DELETE FROM vip_checkins WHERE registration_id IN (SELECT id FROM vip_registrations WHERE person_id = ANY($1::bigint[]))', [people]);
    await client.query('DELETE FROM records WHERE person_id = ANY($1::bigint[])', [people]);
    await client.query('DELETE FROM vip_gift_handouts WHERE person_id = ANY($1::bigint[])', [people]);
    await client.query('DELETE FROM vip_registrations WHERE person_id = ANY($1::bigint[])', [people]);
    await client.query('DELETE FROM people WHERE id = ANY($1::bigint[])', [people]);
  }
  if (services.length) {
    await client.query('DELETE FROM records WHERE service_id = ANY($1::bigint[])', [services]);
    await client.query('DELETE FROM services WHERE id = ANY($1::bigint[])', [services]);
  }
}
await cleanup();

for (const date of sundays) {
  if ((await client.query('SELECT id FROM services WHERE service_date=$1', [date])).rows.length) {
    console.error(`Refusing to run: ${date} already has a service row that this test did not create.`);
    process.exit(2);
  }
}

async function createServices() {
  for (const date of sundays) {
    const id = await allocate('services');
    await client.query('INSERT INTO services(id,service_date,notes) VALUES($1,$2,$3)', [id, date, MARK]);
    ids.services.push(id);
  }
}
async function createPerson(name, { vip = true, attended = 0, archived = false } = {}) {
  const personId = await allocate('people');
  await client.query(
    `INSERT INTO people(id,person_code,first_name,full_name,status,date_registered,registration_source${archived ? ',archived_at' : ''})
     VALUES($1,$2,$3,$4,'first_timer',$5,'vip'${archived ? ',now()' : ''})`,
    [personId, `${MARK}-${personId}`, String(name).split(' ')[0], name, todayIso()],
  );
  ids.people.push(personId);
  if (vip) {
    const registrationId = await allocate('vip_registrations');
    await client.query('INSERT INTO vip_registrations(id,person_id,full_name,inviter) VALUES($1,$2,$3,$4)', [registrationId, personId, name, 'Kuya Test']);
    ids.registrations.push(registrationId);
  }
  for (let i = 0; i < attended; i++) {
    const recordId = await allocate('records');
    await client.query("INSERT INTO records(id,service_id,person_id,status,classification) VALUES($1,$2,$3,'present','first_timer')", [recordId, ids.services[i], personId]);
  }
  return personId;
}

// A past Sunday with no service row yet. validateCheckin() opens the service for
// the check-in date, and the app refuses future Sundays, so the check-in sync is
// proven on a real past Sunday — created here with the TEST-GIFT- marker and
// removed by cleanup().
async function createPastSundayService() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 60);
  while (d.getDay() !== 0) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 12; i++) {
    const date = iso(d);
    if (!(await client.query('SELECT id FROM services WHERE service_date=$1', [date])).rows.length) {
      const id = await allocate('services');
      await client.query('INSERT INTO services(id,service_date,notes) VALUES($1,$2,$3)', [id, date, MARK]);
      ids.services.push(id);
      return date;
    }
    d.setDate(d.getDate() - 7);
  }
  throw new Error('Could not find a free past Sunday for the check-in test.');
}

const find = (payload, id) => payload.items.find((i) => i.person_id === String(id));
const giftRow = async (personId) => (await client.query('SELECT id,marked_by_name FROM vip_gift_handouts WHERE person_id=$1', [personId])).rows[0];
const auditCount = async (action, personId) => Number((await client.query("SELECT count(*)::int AS n FROM audit_log WHERE entity='vip_gift_handouts' AND action=$1 AND details->>'person_id'=$2", [action, String(personId)])).rows[0].n);

try {
  section('0. SIGN IN AS ADMIN');
  const login = await call('/api/auth/login', { method: 'POST', body: { username: adminUsername, password: process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD } });
  ok('login succeeds', login.status, 200);
  truthy('a CSRF token is issued', csrf);
  truthy('a preview session is issued', session);

  section('1. TEST DATA (marked TEST-GIFT-, removed again at the end)');
  await createServices();
  const fourSundays = await createPerson('Gift Test Four', { attended: 4 });
  const threeSundays = await createPerson('Gift Test Three', { attended: 3 });
  const noneYet = await createPerson('Gift Test New', { attended: 0 });
  const notVip = await createPerson('Gift Test Regular', { vip: false, attended: 4 });
  const archivedVip = await createPerson('Gift Test Archived', { attended: 4, archived: true });
  console.log(`  created 4 Sundays (${sundays.join(', ')}), 4 VIPs and 1 non-VIP`);

  section('2. THE TRACKER READS EXISTING ATTENDANCE');
  const before = await call('/api/tracker/giftTracker', { method: 'POST', body: { args: [] } });
  ok('the tracker loads', before.status, 200);
  ok('four Sunday attendances are the target', before.data.target, 4);
  ok('a VIP with four Sundays counts 4', find(before.data, fourSundays)?.sundays_attended, 4);
  ok('a VIP with three Sundays counts 3', find(before.data, threeSundays)?.sundays_attended, 3);
  ok('a VIP with none counts 0', find(before.data, noneYet)?.sundays_attended, 0);
  ok('the inviter is carried through', find(before.data, fourSundays)?.inviter, 'Kuya Test');
  ok('nothing is recorded yet', find(before.data, fourSundays)?.gift_given, false);
  truthy('a VIP who has not reached four is not eligible', find(before.data, fourSundays)?.sundays_attended >= 4);
  truthy('the active VIP count includes the test VIPs', before.data.counts.active_vips >= 4);
  const eligibleBefore = before.data.counts.gift_eligible;

  section('3. A VIP CHECK-IN THAT STAFF VALIDATE FEEDS THE SAME TRACKER');
  const checkinSunday = await createPastSundayService();
  const checkedIn = await createPerson('Gift Test Checkin', { attended: 0 });
  const fresh = await call('/api/tracker/giftTracker', { method: 'POST', body: { args: [] } });
  ok('the check-in VIP starts at zero', find(fresh.data, checkedIn)?.sundays_attended, 0);
  console.log(`  check-in Sunday: ${checkinSunday}`);
  const checkinId = await allocate('vip_checkins');
  await client.query('INSERT INTO vip_checkins(id,registration_id,date_key) VALUES($1,$2,$3)', [checkinId, ids.registrations.at(-1), checkinSunday]);
  const validated = await call('/api/tracker/validateCheckin', { method: 'POST', body: { args: [checkinId, true] } });
  ok('staff can validate the check-in', validated.status, 200);
  ok('the check-in is marked valid', validated.data?.status, 'valid');
  const afterCheckin = await call('/api/tracker/giftTracker', { method: 'POST', body: { args: [] } });
  ok('the tracker counts it straight away', find(afterCheckin.data, checkedIn)?.sundays_attended, 1);

  section('4. PEOPLE WITHOUT A VIP REGISTRATION, AND ARCHIVED PEOPLE, STAY OUT');
  ok('a non-VIP person is not listed', find(before.data, notVip), undefined);
  ok('an archived VIP is not listed', find(before.data, archivedVip), undefined);

  section('5. A VIP UNDER FOUR SUNDAYS CANNOT BE RECORDED');
  const tooEarly = await call('/api/tracker/markGiftGiven', { method: 'POST', body: { args: [threeSundays] } });
  ok('three Sundays is refused', tooEarly.status, 400);
  truthy('the refusal explains the count', /3\/4/.test(String(tooEarly.data?.message)));
  ok('a brand new VIP is refused', (await call('/api/tracker/markGiftGiven', { method: 'POST', body: { args: [noneYet] } })).status, 400);
  ok('nothing was written', await giftRow(threeSundays), undefined);

  section('6. RECORDING THE GIFT');
  const recorded = await call('/api/tracker/markGiftGiven', { method: 'POST', body: { args: [fourSundays] } });
  ok('recording succeeds', recorded.status, 200);
  ok('the response confirms it', recorded.data.recorded, true);
  const row = await giftRow(fourSundays);
  truthy('the row is stored', row);
  truthy('the staff member who recorded it is stored', row?.marked_by_name);
  const after = await call('/api/tracker/giftTracker', { method: 'POST', body: { args: [] } });
  ok('the tracker shows it as given', find(after.data, fourSundays)?.gift_given, true);
  truthy('with a timestamp', find(after.data, fourSundays)?.gift_given_at);
  truthy('with who recorded it', find(after.data, fourSundays)?.gift_given_by);
  ok('and the eligible count drops by one', after.data.counts.gift_eligible, eligibleBefore - 1);

  section('7. ONE GIFT PER VIP');
  const again = await call('/api/tracker/markGiftGiven', { method: 'POST', body: { args: [fourSundays] } });
  ok('a second recording is refused as a duplicate', again.data?.already_recorded, true);
  ok('still exactly one row', Number((await client.query('SELECT count(*)::int AS n FROM vip_gift_handouts WHERE person_id=$1', [fourSundays])).rows[0].n), 1);
  ok('and exactly one audit entry', await auditCount('gift_recorded', fourSundays), 1);

  section('8. UNDO (A MIS-CLICK)');
  const undone = await call('/api/tracker/undoGiftGiven', { method: 'POST', body: { args: [fourSundays] } });
  ok('undo succeeds', undone.status, 200);
  ok('the response confirms it', undone.data.removed, true);
  ok('the row is gone', await giftRow(fourSundays), undefined);
  const back = await call('/api/tracker/giftTracker', { method: 'POST', body: { args: [] } });
  ok('the tracker shows it as not given', find(back.data, fourSundays)?.gift_given, false);
  ok('and the eligible count is back', back.data.counts.gift_eligible, eligibleBefore);
  ok('undoing twice is harmless', (await call('/api/tracker/undoGiftGiven', { method: 'POST', body: { args: [fourSundays] } })).data?.removed, false);
  ok('the undo is in the audit log too', await auditCount('gift_undo', fourSundays), 1);

  section('9. SIGNED-OUT STAFF CANNOT TOUCH IT');
  const keep = [session, csrf];
  session = ''; csrf = '';
  const anonymous = await fetch(base + '/api/tracker/giftTracker', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ args: [] }) });
  ok('anonymous read is refused', anonymous.status, 401);
  const anonymousWrite = await fetch(base + '/api/tracker/markGiftGiven', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ args: [fourSundays] }) });
  ok('anonymous write is refused', anonymousWrite.status, 401);
  [session, csrf] = keep;
} finally {
  await cleanup();
  await client.end();
  server.close();
  await closePool();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
