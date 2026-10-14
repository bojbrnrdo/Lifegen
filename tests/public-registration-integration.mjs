// Public registration integration test — runs against a live server + database.
//
//   LIFEGEN_INTEGRATION_DATABASE_URL=postgres://… node tests/public-registration-integration.mjs
//   (base URL from LIFEGEN_INTEGRATION_BASE_URL, default http://127.0.0.1:3000)
//
// Every row this test creates is marked TEST-REG- and removed again by cleanup(),
// so it never touches real records. No production data is read or written.
import pg from 'pg';

const BASE = process.env.LIFEGEN_INTEGRATION_BASE_URL || 'http://127.0.0.1:3000';
const DB = process.env.LIFEGEN_INTEGRATION_DATABASE_URL || process.env.LIFEGEN_DATABASE_URL;
if (!DB) {
  console.error('Set LIFEGEN_INTEGRATION_DATABASE_URL to run this test.');
  process.exit(2);
}

const MARK = 'TEST-REG-';
const client = new pg.Client({ connectionString: DB });
await client.connect();

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
  return ok;
};
const section = (t) => console.log(`\n=== ${t} ===`);

const allocate = async (entity) =>
  (await client.query('UPDATE id_counters SET last_id=last_id+1 WHERE entity=$1 RETURNING last_id', [entity])).rows[0].last_id;

// Each visitor gets their own forwarded address so the public rate limiter counts
// them separately — exactly what happens with real people on different phones. The
// run number keeps repeated runs of this file independent of each other.
const RUN = Math.floor(Math.random() * 200) + 1;
const V = (n) => `10.${RUN}.0.${n}`;
async function api(path, { method = 'GET', body, headers = {}, visitor = null } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Origin: BASE, 'X-Forwarded-For': visitor || V(1), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

const key = () => crypto.randomUUID();
// pg hands date columns back as JS Dates; compare calendar days, not time.
const day = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const ids = { people: [], networks: [], lifegroups: [], memberships: [], vip: [] };

async function person(name, sex) {
  const id = await allocate('people');
  await client.query(
    `INSERT INTO people(id,person_code,first_name,last_name,full_name,sex,status,date_registered,registration_source)
     VALUES($1,$2,$3,'',$4,$5,'first_timer',CURRENT_DATE,'staff')`,
    [id, `${MARK}${id}`, name, name, sex],
  );
  ids.people.push(id);
  return id;
}

async function cleanup() {
  // Order matters: memberships reference lifegroups and people with plain
  // (non-deferrable) foreign keys, so they have to go first.
  if (ids.people.length) {
    await client.query('DELETE FROM lifegroup_memberships WHERE person_id=ANY($1::bigint[])', [ids.people]);
    await client.query('DELETE FROM records WHERE person_id=ANY($1::bigint[])', [ids.people]);
  }
  if (ids.memberships.length) await client.query('DELETE FROM lifegroup_memberships WHERE id=ANY($1::bigint[])', [ids.memberships]);
  if (ids.vip.length) await client.query('DELETE FROM vip_registrations WHERE id=ANY($1::bigint[])', [ids.vip]);
  if (ids.lifegroups.length) await client.query('DELETE FROM lifegroups WHERE id=ANY($1::bigint[])', [ids.lifegroups]);
  if (ids.networks.length) await client.query('DELETE FROM networks WHERE id=ANY($1::bigint[])', [ids.networks]);
  if (ids.people.length) {
    await client.query("DELETE FROM audit_log WHERE entity_id=ANY($1::text[])", [ids.people.map(String)]);
    await client.query('DELETE FROM people WHERE id=ANY($1::bigint[])', [ids.people]);
  }
}

let exitCode = 0;
try {
  // ---------------------------------------------------------------- fixtures
  const leaderMale = await person('Reg Test Leadermale', 'male');
  const leaderFemale = await person('Reg Test Leaderfemale', 'female');
  const netMale = await person('Reg Test Netmale', 'male');
  const netFemale = await person('Reg Test Netfemale', 'female');

  const netM = await allocate('networks');
  await client.query("INSERT INTO networks(id,name,gender,leader_person_id,is_active) VALUES($1,$2,'boys',$3,true)", [netM, `${MARK}Male Network`, netMale]);
  ids.networks.push(netM);
  const netF = await allocate('networks');
  await client.query("INSERT INTO networks(id,name,gender,leader_person_id,is_active) VALUES($1,$2,'girls',$3,true)", [netF, `${MARK}Female Network`, netFemale]);
  ids.networks.push(netF);

  const lgM = await allocate('lifegroups');
  await client.query("INSERT INTO lifegroups(id,name,gender,leader_person_id,network_id,network_manual) VALUES($1,$2,'boys',$3,$4,false)", [lgM, `${MARK}Male Cell`, leaderMale, netM]);
  ids.lifegroups.push(lgM);
  const lgF = await allocate('lifegroups');
  await client.query("INSERT INTO lifegroups(id,name,gender,leader_person_id,network_id,network_manual) VALUES($1,$2,'girls',$3,$4,false)", [lgF, `${MARK}Female Cell`, leaderFemale, netF]);
  ids.lifegroups.push(lgF);
  // The structural "<Network Leader> Leaders" team group must never be offered.
  const teamM = await allocate('lifegroups');
  await client.query("INSERT INTO lifegroups(id,name,gender,leader_person_id,network_id,network_manual) VALUES($1,$2,'boys',$3,$4,false)", [teamM, `${MARK}Netmale Leaders`, netMale, netM]);
  ids.lifegroups.push(teamM);

  const email1 = `test-reg-${Date.now()}@example.com`;
  const email2 = `test-reg-${Date.now()}-b@example.com`;
  const email3 = `test-reg-${Date.now()}-c@example.com`;

  // ------------------------------------------------------------------ leaders
  section('LEADER DROPDOWN (gender-based, live data)');
  {
    const r = await api('/api/public/leaders?gender=male');
    const names = (r.json?.leaders || []).map((l) => l.leader_name);
    check('male request succeeds', r.status === 200, `status=${r.status}`);
    check('returns the male cell leader', names.includes('Reg Test Leadermale'), names.join(', '));
    check('does NOT return the female leader', !names.includes('Reg Test Leaderfemale'));
    check('does NOT return the network leader team group', !names.includes('Reg Test Netmale'));
    const leader = (r.json?.leaders || []).find((l) => l.leader_name === 'Reg Test Leadermale');
    check('leader carries their Lifegroup name', leader?.lifegroup_name === `${MARK}Male Cell`, leader?.lifegroup_name);
    check('leader carries the Network leader name', leader?.network_leader_name === 'Reg Test Netmale', leader?.network_leader_name);
  }
  {
    const f = await api('/api/public/leaders?gender=female');
    const names = (f.json?.leaders || []).map((l) => l.leader_name);
    check('female request returns the female leader', names.includes('Reg Test Leaderfemale'), names.join(', '));
    check('female request does NOT return the male leader', !names.includes('Reg Test Leadermale'));
    check('female leader carries the female network leader', (f.json?.leaders || [])[0]?.network_leader_name === 'Reg Test Netfemale');
  }
  {
    const o = await api('/api/public/leaders?gender=other');
    check('other / prefer not to say returns an empty list (no fabricated leader)', o.status === 200 && (o.json?.leaders || []).length === 0);
    const bad = await api('/api/public/leaders?gender=banana');
    check('invalid gender is rejected', bad.status === 400, `status=${bad.status}`);
  }

  // --------------------------------------------------------- regular attendee
  section('REGULAR REGISTRATION — verified leader');
  let person1 = null;
  {
    const r = await api('/api/public/registrations/regular', {
      method: 'POST',
      body: {
        full_name: 'Reg Test Attendee One', email: email1, birthdate: '2004-05-12', gender: 'male',
        school: 'Reg Test School', ministry: 'Worship Team', invited_by: 'A friend',
        leader_person_id: String(leaderMale), privacy_consent: true, idempotency_key: key(),
      },
      visitor: V(11),
    });
    check('registration succeeds', r.status === 201, `status=${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
    check('the person was created', r.json?.person_created === true);
    check('the Open cell membership was created', r.json?.membership?.created === true && r.json?.membership?.tier === 'new');
    check('the membership points at the leader\'s Lifegroup', String(r.json?.membership?.lifegroup_id) === String(lgM));
    check('no review flag for a verified leader', !r.json?.review?.needed);
    person1 = Number(r.json?.person?.id);
    if (person1) ids.people.push(person1);

    const p = (await client.query('SELECT id,sex,birthdate,email,ministry,school,inviter,status,registration_source,privacy_consent_at FROM people WHERE id=$1', [person1])).rows[0];
    check('person row stores gender + birthday', p?.sex === 'male' && day(p?.birthdate) === '2004-05-12', JSON.stringify(p));
    check('person row stores email + ministry + school', p?.email === email1 && p?.ministry === 'Worship Team' && p?.school === 'Reg Test School');
    check('person row is a first_timer from the public form', p?.status === 'first_timer' && p?.registration_source === 'public');
    check('privacy consent is recorded', Boolean(p?.privacy_consent_at));

    const m = (await client.query('SELECT lifegroup_id,role,tier,left_at FROM lifegroup_memberships WHERE person_id=$1', [person1])).rows;
    check('exactly one membership row', m.length === 1, `rows=${m.length}`);
    check('membership is the Open cell (tier new), never a closed cell', m[0]?.tier === 'new' && m[0]?.role === 'member' && String(m[0]?.lifegroup_id) === String(lgM));

    const audit = (await client.query("SELECT action FROM audit_log WHERE entity='people' AND entity_id=$1", [String(person1)])).rows.map((x) => x.action);
    check('the registration is in the audit log', audit.includes('public_registration'), audit.join(','));
  }

  section('DUPLICATE PROTECTION');
  {
    const r = await api('/api/public/registrations/regular', {
      method: 'POST',
      body: {
        full_name: 'Reg Test Attendee One', email: email1, birthdate: '2004-05-12', gender: 'male',
        school: 'Reg Test School', ministry: 'Worship Team',
        leader_person_id: String(leaderMale), privacy_consent: true, idempotency_key: key(),
      },
      visitor: V(11),
    });
    check('second submission still succeeds (idempotent, not an error)', r.status === 200, `status=${r.status}`);
    check('no second person is created', r.json?.person_created === false);
    check('no second membership is created', r.json?.membership?.created === false);
    const people = Number((await client.query('SELECT count(*)::int AS n FROM people WHERE lower(email)=$1', [email1])).rows[0].n);
    const memberships = Number((await client.query('SELECT count(*)::int AS n FROM lifegroup_memberships WHERE person_id=$1', [person1])).rows[0].n);
    check('one person row for that email', people === 1, `people=${people}`);
    check('one membership row for that person', memberships === 1, `memberships=${memberships}`);
  }

  section('MANUAL LEADER ENTRY');
  let person2 = null;
  {
    const r = await api('/api/public/registrations/regular', {
      method: 'POST',
      body: {
        full_name: 'Reg Test Attendee Two', email: email2, birthdate: '2001-02-02', gender: 'female',
        school: 'Reg Test School', ministry: 'Prayer', leader_name_manual: 'Reg Test Leaderfemale',
        privacy_consent: true, idempotency_key: key(),
      },
      visitor: V(12),
    });
    person2 = Number(r.json?.person?.id);
    if (person2) ids.people.push(person2);
    check('typed name that matches a real leader is matched to that leader', r.status === 201 && r.json?.leader?.leader_name === 'Reg Test Leaderfemale', JSON.stringify(r.json?.leader));
    check('the matched leader\'s Lifegroup is used', String(r.json?.membership?.lifegroup_id) === String(lgF));
    check('no review flag when the typed name matches', !r.json?.review?.needed);
  }
  let person3 = null;
  {
    const r = await api('/api/public/registrations/regular', {
      method: 'POST',
      body: {
        full_name: 'Reg Test Attendee Three', email: email3, birthdate: '2003-08-08', gender: 'female',
        school: 'Reg Test School', ministry: 'Ushering', leader_name_manual: 'Nonexistent Leader Person',
        privacy_consent: true, idempotency_key: key(),
      },
      visitor: V(13),
    });
    person3 = Number(r.json?.person?.id);
    if (person3) ids.people.push(person3);
    check('an unmatched typed name still registers the attendee', r.status === 201, `status=${r.status}`);
    check('it is flagged for admin review', r.json?.review?.needed === true && r.json?.review?.reason === 'manual_leader_unmatched', JSON.stringify(r.json?.review));
    const m = Number((await client.query('SELECT count(*)::int AS n FROM lifegroup_memberships WHERE person_id=$1', [person3])).rows[0].n);
    check('no membership is invented for an unmatched name', m === 0, `memberships=${m}`);
    const flagged = Number((await client.query("SELECT count(*)::int AS n FROM audit_log WHERE entity='people' AND entity_id=$1 AND action='public_registration_review'", [String(person3)])).rows[0].n);
    check('the review flag is visible on the person\'s activity', flagged >= 1);
    const fake = Number((await client.query("SELECT count(*)::int AS n FROM people WHERE lower(first_name) LIKE '%nonexistent%'")).rows[0].n);
    check('no fake leader person is created', fake === 0, `rows=${fake}`);
  }

  section('SERVER-SIDE VALIDATION (never trust the browser)');
  {
    const bad = await api('/api/public/registrations/regular', {
      method: 'POST',
      body: {
        full_name: 'Reg Test Tamper', email: `test-reg-${Date.now()}-d@example.com`, birthdate: '2000-01-01', gender: 'female',
        school: 'X', ministry: 'Prayer', leader_person_id: String(leaderMale),
        privacy_consent: true, idempotency_key: key(),
      },
      visitor: V(14),
    });
    check('a leader of the wrong gender is rejected', bad.status === 400, `status=${bad.status} ${bad.json?.message || ''}`);
  }
  {
    const base = { full_name: 'Reg Test Invalid', email: `test-reg-${Date.now()}-e@example.com`, birthdate: '2000-01-01', gender: 'male', school: 'X', ministry: 'Prayer', privacy_consent: true, idempotency_key: key() };
    const cases = [
      ['missing ministry', { ...base, ministry: '' }],
      ['ministry outside the approved list', { ...base, ministry: 'Freestyle Ministry' }],
      ['missing consent', { ...base, privacy_consent: false }],
      ['invalid email', { ...base, email: 'not-an-email' }],
      ['future birthday', { ...base, birthdate: '2999-01-01' }],
      ['honeypot filled', { ...base, website: 'spam' }],
      ['missing idempotency key', { ...base, idempotency_key: '' }],
      ['invalid gender', { ...base, gender: 'banana' }],
    ];
    const results = [];
    for (const [label, body] of cases) {
      const r = await api('/api/public/registrations/regular', { method: 'POST', body, visitor: V(15) });
      results.push(`${label}:${r.status}`);
      check(`invalid form rejected — ${label}`, r.status === 400, `status=${r.status}`);
    }
    check('no rows were written by the invalid attempts', Number((await client.query("SELECT count(*)::int AS n FROM people WHERE email LIKE 'test-reg-%-e@example.com'")).rows[0].n) === 0, results.join(' '));
  }

  section('VIP REGISTRATION (birthday + gender, recovery still works)');
  {
    const vipEmailName = `Reg Test Vip ${Date.now()}`;
    const r = await api('/api/public/registrations', {
      method: 'POST',
      body: {
        full_name: vipEmailName, gender: 'female', birthdate: '2005-03-03',
        school: 'Reg Test School', inviter: 'Reg Test Inviter', contact: '09170000000',
        privacy_consent: true, idempotency_key: key(),
      },
      visitor: V(16),
    });
    check('VIP registration with birthday + gender succeeds', r.status === 201, `status=${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
    check('a recovery code is still issued', typeof r.json?.recovery_code === 'string' && r.json.recovery_code.startsWith('LG-'));
    const pid = Number(r.json?.vip?.person_id);
    ids.people.push(pid);
    if (r.json?.vip?.id) ids.vip.push(Number(r.json.vip.id));
    const p = (await client.query('SELECT sex,birthdate,age FROM people WHERE id=$1', [pid])).rows[0];
    check('person row stores the chosen gender', p?.sex === 'female', JSON.stringify(p));
    check('person row stores the birthday', day(p?.birthdate) === '2005-03-03', String(p?.birthdate));
    const v = (await client.query('SELECT age FROM vip_registrations WHERE person_id=$1', [pid])).rows[0];
    const expectedAge = new Date().getFullYear() - 2005 - ((new Date().getMonth() + 1) < 3 ? 1 : 0);
    check('the computed age is stored for the existing portal logic', Math.abs(Number(v?.age) - expectedAge) <= 1, `stored=${v?.age} expected≈${expectedAge}`);
    // Recovery still works with the code that was just issued.
    const restore = await api('/api/public/vip/restore', { method: 'POST', body: { recovery_code: r.json.recovery_code }, visitor: V(16) });
    check('the recovery code opens the VIP portal', restore.status === 200 && restore.json?.vip, `status=${restore.status}`);
    // An older cached page that still posts `age` keeps working.
    const legacy = await api('/api/public/registrations', {
      method: 'POST',
      body: { full_name: `Reg Test Vip Legacy ${Date.now()}`, age: 19, school: 'Reg Test School', inviter: 'Reg Test Inviter', privacy_consent: true, idempotency_key: key() },
      visitor: V(17),
    });
    check('an older page posting age still registers', legacy.status === 201, `status=${legacy.status}`);
    if (legacy.json?.vip?.person_id) ids.people.push(Number(legacy.json.vip.person_id));
    if (legacy.json?.vip?.id) ids.vip.push(Number(legacy.json.vip.id));
  }
} catch (err) {
  console.error('\nUNEXPECTED ERROR:', err.message);
  exitCode = 1;
} finally {
  try { await cleanup(); console.log('\ncleanup done'); } catch (e) { console.error('cleanup failed:', e.message); exitCode = 1; }
  await client.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(exitCode || (fail ? 1 : 0));
