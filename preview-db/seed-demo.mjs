// Seeds the preview database DIRECTLY via PGlite (gateway must be STOPPED).
// Creates: demo admin user, 24 demo people, last 10 Sunday services with
// attendance spread, calendar events, monthly prize, and the QA VIP rows
// (person id=25 / registration 901 / checkins 801-802).
// Usage: node seed-demo.mjs
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PGW_DATA || path.join(here, 'data');
const db = new PGlite(DATA);
await db.waitReady;

const iso = (d) => d.toISOString().slice(0, 10);
// Last N Sundays (most recent first), in the sandbox's local clock.
function lastSundays(n) {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - d.getDay());
  const out = [];
  for (let i = 0; i < n; i++) { const c = new Date(d); c.setDate(d.getDate() - i * 7); out.push(iso(c)); }
  return out;
}

async function nextId(entity) {
  const { rows } = await db.query('UPDATE id_counters SET last_id=last_id+1 WHERE entity=$1 RETURNING last_id', [entity]);
  return rows[0].last_id;
}

// ---- demo admin user -----------------------------------------------------
const seededUser = (await db.query("SELECT id FROM staff_users WHERE username=$1", ['demo@lifegen.local'])).rows[0];
if (!seededUser) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('LifegenDemo2026!', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  await db.query("INSERT INTO staff_users(username,display_name,password_hash,role_id) VALUES($1,$2,$3,'admin')",
    ['demo@lifegen.local', 'Demo Admin', `scrypt$32768$${salt}$${hash}`]);
  console.log('seeded staff user demo@lifegen.local');
}

// ---- demo people ---------------------------------------------------------
const personCount = (await db.query("SELECT count(*)::int AS n FROM people WHERE is_demo=true")).rows[0].n;
const personIds = [];
if (!personCount) {
  for (let i = 1; i <= 24; i++) {
    const first = 'Demo', last = `Person ${String(i).padStart(2, '0')}`;
    const status = i % 8 === 0 ? 'member' : i % 5 === 0 ? 'regular' : 'first_timer';
    const { rows } = await db.query(
      `INSERT INTO people(id,person_code,first_name,last_name,full_name,status,date_registered,registration_source,is_demo)
       VALUES($1,$2,$3,$4,$5,$6,$7,'staff',true) RETURNING id`,
      [await nextId('people'), `2026-${String(i).padStart(4, '0')}`, first, last, `${first} ${last}`, status, iso(new Date(Date.now() - (i * 3 + 5) * 86400000))]);
    personIds.push(rows[0].id);
  }
  console.log('seeded 24 demo people');
} else {
  const { rows } = await db.query('SELECT id FROM people WHERE is_demo=true ORDER BY id');
  rows.forEach(r => personIds.push(r.id));
}

// ---- services: last 10 Sundays -------------------------------------------
const sundays = lastSundays(10);
const svcIds = {};
for (const d of sundays) {
  const existing = (await db.query('SELECT id FROM services WHERE service_date=$1', [d])).rows[0];
  if (existing) { svcIds[d] = existing.id; continue; }
  const { rows } = await db.query(
    "INSERT INTO services(id,service_date,service_type,is_demo,notes) VALUES($1,$2,'lifegen',true,'Demo seed') RETURNING id",
    [await nextId('services'), d]);
  svcIds[d] = rows[0].id;
}
console.log('services ready:', sundays.length);

// ---- attendance records (deterministic spread) ----------------------------
let recCount = 0;
for (let i = 0; i < personIds.length; i++) {
  const keep = 3 + ((i * 7) % 8); // attends 3..10 most recent Sundays
  for (let s = 0; s < Math.min(keep, sundays.length); s++) {
    if ((i + s) % 9 === 7) continue; // occasional absence
    const d = sundays[s];
    const exists = (await db.query('SELECT 1 FROM records WHERE service_id=$1 AND person_id=$2', [svcIds[d], personIds[i]])).rows[0];
    if (exists) continue;
    await db.query(
      `INSERT INTO records(id,service_id,person_id,status,classification,source,recorded_by_name)
       VALUES($1,$2,$3,'present',$4,'staff','Demo seed')`,
      [await nextId('records'), svcIds[d], personIds[i], s >= keep - 1 ? 'first_timer' : 'returning']);
    recCount++;
  }
}
console.log('attendance records added:', recCount);

// ---- calendar events -------------------------------------------------------
const evCount = (await db.query('SELECT count(*)::int AS n FROM calendar_events')).rows[0].n;
if (!evCount) {
  const events = [
    ['Sunday Worship Service', 'Weekly worship with the LIFEGEN family.', 'Main Hall', 'service', 0],
    ['Prayer Night', 'An evening of prayer and intercession.', 'Chapel', 'prayer', 5],
    ['Youth Hangout', 'Games, worship, and fellowship for the youth.', 'Fellowship Hall', 'youth', 9],
    ['LifeGroup Leaders Meeting', 'Monthly sync for LifeGroup leaders.', 'Room 2', 'lifegroup', 12],
    ['Community Outreach', 'Feeding program and fellowship in the neighborhood.', 'Barangay Court', 'outreach', 16],
    ['Worship Rehearsal', 'Open rehearsal for the worship team.', 'Main Hall', 'worship', 3],
    ['Family Day', 'A special afternoon for families of the church.', 'Grounds', 'special', 20],
  ];
  for (const [title, description, location, category, plusDays] of events) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + plusDays);
    await db.query(
      `INSERT INTO calendar_events(id,title,description,location,category,event_date,start_time,end_time,is_demo)
       VALUES($1,$2,$3,$4,$5,$6,'13:00','15:00',true)`,
      [await nextId('calendar_events'), title, description, location, category, iso(d)]);
  }
  console.log('seeded calendar events:', events.length);
}

// ---- monthly prize ----------------------------------------------------------
await db.query("INSERT INTO monthly_prizes(month,description) VALUES($1,$2) ON CONFLICT(month) DO NOTHING",
  [new Date().toISOString().slice(0, 7), 'Gift basket + lunch date with the pastors']);

// ---- QA rows: Test VIP (person id=25, registration 901, checkins 801-802) ---
const qaPerson = (await db.query("SELECT id FROM people WHERE id=25")).rows[0];
if (!qaPerson) {
  await db.query(
    `INSERT INTO people(id,person_code,first_name,last_name,full_name,status,date_registered,registration_source,is_demo)
     VALUES(25,'2026-0099','Test','VIP','Test VIP','first_timer',$1,'vip',true)`, [iso(new Date())]);
}
const qaReg = (await db.query('SELECT id FROM vip_registrations WHERE id=901')).rows[0];
if (!qaReg) {
  await db.query(
    `INSERT INTO vip_registrations(id,person_id,full_name,age,school,inviter,contact,review_status)
     VALUES(901,25,'Test VIP',25,'QA University','Walk-in','0917 000 0099','reviewed')`);
}
const today = sundays[0];
const qaRec = (await db.query('SELECT 1 FROM records WHERE service_id=$1 AND person_id=25', [svcIds[today]])).rows[0];
if (!qaRec) {
  await db.query(
    `INSERT INTO records(id,service_id,person_id,status,classification,source,recorded_by_name)
     VALUES($1,$2,25,'present','first_timer','vip_self','QA seed')`, [await nextId('records'), svcIds[today]]);
}
for (const [cid, d] of [[801, sundays[1]], [802, sundays[0]]]) {
  const exists = (await db.query('SELECT 1 FROM vip_checkins WHERE id=$1', [cid])).rows[0];
  if (exists) continue;
  await db.query(
    `INSERT INTO vip_checkins(id,registration_id,date_key,status) VALUES($1,901,$2,'valid')`, [cid, d]);
}
console.log('QA rows ready (person 25 / reg 901 / checkins 801-802)');

await db.close();
console.log('seed complete');
