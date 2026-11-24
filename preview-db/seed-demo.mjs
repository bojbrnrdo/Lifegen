// Seeds the preview database DIRECTLY via PGlite (gateway must be STOPPED).
// Creates: demo admin and restricted Youth Welfare users, 24 demo people,
// ministry-only sample categories, VIP check-ins across the last 10 Sundays,
// calendar events, monthly prize, and the QA VIP rows
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
const seededYouthUser = (await db.query("SELECT id FROM staff_users WHERE username=$1", ['demo-youth@lifegen.local'])).rows[0];
if (!seededYouthUser) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('DemoYouthWelfare2026!', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  await db.query("INSERT INTO staff_users(username,display_name,password_hash,role_id) VALUES($1,$2,$3,'youth_welfare_admin')",
    ['demo-youth@lifegen.local', 'Demo Youth Welfare', `scrypt$32768$${salt}$${hash}`]);
  console.log('seeded restricted Youth Welfare preview user demo-youth@lifegen.local');
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
// Synthetic category overrides demonstrate the ministry-only classifier. They
// never change the seeded People registration answers and are not production data.
const demoYouthCategories = ['student', 'working_student', 'young_professional', 'working_employed', 'not_studying', 'unable_to_continue'];
for (let i = 0; i < Math.min(demoYouthCategories.length, personIds.length); i++) {
  await db.query(`INSERT INTO youth_welfare_categories(person_id,category)
    VALUES($1,$2) ON CONFLICT(person_id) DO NOTHING`, [personIds[i], demoYouthCategories[i]]);
}
// Add a few harmless, fictional administrative tasks only to a fresh preview DB.
// These never create or edit People records and demonstrate the reminder flow.
const youthUserId = seededYouthUser?.id || (await db.query("SELECT id FROM staff_users WHERE username='demo-youth@lifegen.local'")).rows[0]?.id;
const taskCount = (await db.query('SELECT count(*)::int AS n FROM youth_welfare_follow_up_tasks')).rows[0].n;
if (!taskCount && personIds.length >= 2 && youthUserId) {
  const dueSoon = new Date(); dueSoon.setDate(dueSoon.getDate() + 2);
  const overdue = new Date(); overdue.setDate(overdue.getDate() - 3);
  await db.query(`INSERT INTO youth_welfare_follow_up_tasks(person_id,task_type,title,notes,status,assigned_to,due_date,created_by,updated_by)
    VALUES($1,'data_verification','Confirm school field on the regular registration','Administrative demo task only. Do not enter sensitive details.','needs_review',$3,$4,$3,$3),
          ($2,'registration_review','Review an incomplete regular registration','Administrative demo task only. Do not enter sensitive details.','in_progress',$3,$5,$3,$3)`,
  [personIds[0],personIds[1],youthUserId,iso(dueSoon),iso(overdue)]);
}
await db.query(`INSERT INTO youth_welfare_saved_views(user_id,name,filters)
  VALUES($1,'Demo · Incomplete details','{"q":"","category":"all","missing":"incomplete"}'::jsonb)
  ON CONFLICT(user_id,lower(btrim(name))) DO NOTHING`,[youthUserId]);
await db.query(`INSERT INTO youth_welfare_report_templates(user_id,name,config)
  VALUES($1,'Demo · Monthly registration events','{"type":"registration_summary","period":"month","category":"all"}'::jsonb)
  ON CONFLICT(user_id,lower(btrim(name))) DO NOTHING`,[youthUserId]);

// ---- Youth Welfare people -------------------------------------------------
// The VIP block below gives every demo person a VIP registration, and the Youth
// Welfare portal intentionally excludes VIP-linked people. Without regular
// members of its own the portal would open empty, so add a small set of People
// who went through a regular registration and never became VIPs.
const YOUTH_PEOPLE = [
  ['Angelica', 'Bautista', 'currently_studying', 'college_first_year', 'female', 19],
  ['Bryan', 'Delos Santos', 'currently_studying', 'senior_high_grade_11', 'male', 17],
  ['Cristine', 'Pascual', 'out_of_school', 'junior_high_grade_10', 'female', 16],
  ['Dennis', 'Navarro', 'working_student', 'college_second_year', 'male', 20],
  ['Erika Mae', 'Salazar', 'currently_als', 'als_senior_high', 'female', 18],
  ['Francis', 'Ibarra', 'out_of_school', null, 'male', 21],
  ['Grace Ann', 'Quiambao', 'currently_studying', 'junior_high_grade_9', 'female', 15],
  ['Harvey', 'Magbanua', 'currently_studying', 'college_third_year', 'male', 21],
  ['Isabel', 'Soriano', 'out_of_school', 'senior_high_grade_12', 'female', 18],
  ['Jerome', 'Valdez', 'working_student', 'college_fourth_year', 'male', 22],
  ['Katrina', 'Fajardo', 'currently_studying', 'senior_high_grade_12', 'female', 17],
  ['Lorenzo', 'Domingo', 'currently_studying', 'college_first_year', 'male', 18],
];
const YOUTH_CATEGORIES = ['student', 'student', 'not_studying', 'working_student', 'student', 'unable_to_continue', 'student', 'student', 'not_studying', 'working_student', 'student', 'young_professional'];
const demoYouthIds = [];
const haveYouth = new Set((await db.query('SELECT person_id FROM youth_welfare_categories')).rows.map((r) => String(r.person_id)));
// Candidate for conversion on an already-seeded database: a demo person who is
// not a VIP and has no Youth Welfare category yet. `converting` turns a few of
// those into Youth Welfare people in place instead of requiring a rebuild.
const youthCandidate = async () => (await db.query(
  `SELECT p.id FROM people p
   WHERE p.is_demo=true AND NOT EXISTS (SELECT 1 FROM vip_registrations v WHERE v.person_id=p.id)
     AND NOT EXISTS (SELECT 1 FROM youth_welfare_categories y WHERE y.person_id=p.id)
   ORDER BY p.id LIMIT 1`)).rows[0]?.id;
for (let i = 0; i < YOUTH_PEOPLE.length; i++) {
  const [first, last, education, grade, sex, age] = YOUTH_PEOPLE[i];
  const code = `2026-Y${String(i + 1).padStart(3, '0')}`;
  let row = (await db.query('SELECT id FROM people WHERE person_code=$1', [code])).rows[0];
  if (!row) {
    row = (await db.query(
      `INSERT INTO people(id,person_code,first_name,last_name,full_name,status,sex,age,date_registered,registration_source,is_demo)
       VALUES($1,$2,$3,$4,$5,'regular',$6,$7,$8,'public',true) RETURNING id`,
      [await nextId('people'), code, first, last, `${first} ${last}`, sex, age,
        iso(new Date(Date.now() - (i * 4 + 11) * 86400000))])).rows[0];
  } else {
    const converted = (await youthCandidate()) ?? row.id;
    await db.query("UPDATE people SET first_name=$2,last_name=$3,full_name=$4,status='regular',sex=$5,age=$6,registration_source='public' WHERE id=$1",
      [converted, first, last, `${first} ${last}`, sex, age]);
    await db.query('DELETE FROM vip_registrations WHERE person_id=$1', [converted]);
    row = { id: converted };
  }
  demoYouthIds.push(row.id);
  if (haveYouth.has(String(row.id))) continue; // a category override already marks this person as Youth Welfare
  await db.query(`INSERT INTO youth_welfare_categories(person_id,category) VALUES($1,$2) ON CONFLICT(person_id) DO NOTHING`,
    [row.id, YOUTH_CATEGORIES[i]]);
  const hasConsent = i % 3 !== 0;
  await db.query(
    `INSERT INTO youth_welfare_records(person_id,education_status,grade_year_level,continue_studies,
       school_stop_reasons,verification_status,verified_at,source,welfare_consent_at,welfare_consent_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,'staff_entry',$8,$9)
     ON CONFLICT(person_id) DO NOTHING`,
    [row.id, education, grade,
      education === 'out_of_school' ? (i % 2 ? 'yes_need_help' : 'not_right_now') : null,
      education === 'out_of_school' ? ['financial_problem'] : [],
      i % 2 ? 'verified' : 'pending', i % 2 ? new Date() : null,
      hasConsent ? new Date() : null, hasConsent ? 'demo-v1' : null]);
}
console.log('seeded Youth Welfare people:', demoYouthIds.length);

// The tasks above were written before those people were known not to be VIPs.
// Re-point them (and any other demo task) at Youth Welfare people so the task
// list the portal filters on is not empty. Safe to re-run.
if (demoYouthIds.length >= 2) {
  await db.query(
    `UPDATE youth_welfare_follow_up_tasks SET person_id=$1 WHERE person_id=$3 AND task_type='data_verification'`,
    [demoYouthIds[0], demoYouthIds[1], personIds[0]]);
  await db.query(
    `UPDATE youth_welfare_follow_up_tasks SET person_id=$1 WHERE person_id=$3 AND task_type='registration_review'`,
    [demoYouthIds[1], demoYouthIds[0], personIds[1]]);
}

// ---- VIP attendance: last 10 Sundays --------------------------------------
// Attendance is tracked only for VIPs, so each demo person is given a VIP
// registration and a validated check-in per Sunday they "attended". There is no
// general Sunday roster any more. People seeded for the Youth Welfare portal are
// skipped: that portal excludes anyone with a VIP registration.
const sundays = lastSundays(10);
const youthOnly = new Set(demoYouthIds.map(String));
let recCount = 0;
for (let i = 0; i < personIds.length; i++) {
  const pid = personIds[i];
  if (youthOnly.has(String(pid))) continue;
  const keep = 3 + ((i * 7) % 8); // attends 3..10 most recent Sundays
  let reg = (await db.query('SELECT id FROM vip_registrations WHERE person_id=$1 ORDER BY id LIMIT 1', [pid])).rows[0];
  if (!reg) {
    reg = (await db.query(
      `INSERT INTO vip_registrations(id,person_id,full_name,review_status,service_date)
       SELECT $1,p.id,coalesce(nullif(p.full_name,''),concat_ws(' ',p.first_name,p.last_name)),'reviewed',$2
       FROM people p WHERE p.id=$3 RETURNING id`,
      [await nextId('vip_registrations'), sundays[0], pid])).rows[0];
  }
  if (!reg) continue;
  for (let s = 0; s < Math.min(keep, sundays.length); s++) {
    if ((i + s) % 9 === 7) continue; // occasional absence
    const d = sundays[s];
    const exists = (await db.query('SELECT 1 FROM vip_checkins WHERE registration_id=$1 AND date_key=$2', [reg.id, d])).rows[0];
    if (exists) continue;
    await db.query(
      `INSERT INTO vip_checkins(id,registration_id,date_key,status,validated_at)
       VALUES($1,$2,$3,'valid',now())`, [await nextId('vip_checkins'), reg.id, d]);
    recCount++;
  }
}
console.log('VIP attendance check-ins added:', recCount);

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
for (const [cid, d] of [[801, sundays[1]], [802, sundays[0]]]) {
  const exists = (await db.query('SELECT 1 FROM vip_checkins WHERE id=$1', [cid])).rows[0];
  if (exists) continue;
  await db.query(
    `INSERT INTO vip_checkins(id,registration_id,date_key,status) VALUES($1,901,$2,'valid')`, [cid, d]);
}
console.log('QA rows ready (person 25 / reg 901 / checkins 801-802)');

// Keep ID generators ahead of the fixed QA IDs, so the VIP preview seed and
// subsequent app writes do not collide with person 25 / registration 901.
for (const [entity, table] of Object.entries({
  people: 'people',
  vip_registrations: 'vip_registrations', vip_checkins: 'vip_checkins',
  community_posts: 'community_posts', calendar_events: 'calendar_events',
})) {
  await db.query(
    `UPDATE id_counters SET last_id=GREATEST(last_id, COALESCE((SELECT max(id) FROM ${table}), 0)) WHERE entity=$1`,
    [entity],
  );
}

await db.close();
console.log('seed complete');
