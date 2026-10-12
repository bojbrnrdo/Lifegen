// Seeds demo VIP registrations + attendance so the Registrations page can show
// both the monthly prize streaks AND the 4-week lifegroup export outcomes.
// Each VIP's 4-week window starts on their invitation (registration) date; when
// the window closes the person is exported to the tracker as Regular Attendee
// (4/4) or a label that fits how many window Sundays they came back.
// Runs over the wire gateway (start server.mjs first). Idempotent.
import pg from 'pg';
const c = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'postgres', database: 'lifegen', ssl: false });
await c.connect();
await c.query('BEGIN');
const nextId = async (entity) => (await c.query('UPDATE id_counters SET last_id=last_id+1 WHERE entity=$1 RETURNING last_id', [entity])).rows[0].last_id;

// Demo services (future/extra dates, demo-only).
for (const d of ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-18', '2026-10-25']) {
  await c.query(`INSERT INTO services(id,service_date,service_type,is_demo,notes)
                 SELECT $1,$2,'lifegen',true,'Demo seed for preview'
                 WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.service_date=$2)`, [await nextId('services'), d]);
}
const svc = {};
for (const r of (await c.query(`SELECT id, service_date::text AS d FROM services
  WHERE service_date IN ('2026-09-06','2026-09-13','2026-09-20','2026-09-27','2026-10-04','2026-10-11','2026-10-18','2026-10-25')`)).rows) svc[r.d] = r.id;

// [first, last, invitation date, attended Sundays]
const specs = [
  ['Demo', 'FourWeeks',   '2026-09-06', ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11']], // closed window 4/4 -> Regular Attendee
  ['Demo', 'SepThree',    '2026-09-06', ['2026-09-06', '2026-09-13', '2026-09-27']],                                            // closed window 3/4 -> 3-Time Visitor
  ['Demo', 'NoReturns',   '2026-09-06', []],                                                                                     // closed window 0/4 -> No Returns
  ['Demo', 'ThreeWeeks',  '2026-10-04', ['2026-10-04', '2026-10-11', '2026-10-18']],                                             // open window 3/4
  ['Demo', 'TwoWeeks',    '2026-10-04', ['2026-10-04', '2026-10-11']],                                                            // open window 2/4
  ['Demo', 'OneWeek',     '2026-10-04', ['2026-10-04']],                                                                          // open window 1/4
  ['Demo', 'TodayOnly',   '2026-10-11', ['2026-10-11']],                                                                          // open window 1/4
  ['Demo', 'LastTwoWeeks','2026-10-04', ['2026-10-18', '2026-10-25']],                                                            // open window, upcoming
  ['Demo', 'ThreeInARow', '2026-10-04', ['2026-10-11', '2026-10-18', '2026-10-25']],                                              // open window, upcoming
];

let code = 9001;
for (const [fn, ln, invite, days] of specs) {
  const full = `${fn} ${ln}`;
  let row = (await c.query(`SELECT id FROM people WHERE first_name=$1 AND last_name=$2 AND is_demo=true`, [fn, ln])).rows[0];
  let pid;
  if (row) pid = row.id;
  else {
    pid = (await c.query(`INSERT INTO people(id,person_code,first_name,last_name,full_name,status,date_registered,registration_source,is_demo,notes)
      VALUES($1,$2,$3,$4,$5,'first_timer',$6,'staff',true,'Demo seed for preview') RETURNING id`,
      [await nextId('people'), `2026-${code++}`, fn, ln, full, invite])).rows[0].id;
  }
  await c.query(`INSERT INTO vip_registrations(id,person_id,full_name,age,school,inviter,contact,review_status,reviewed_at,created_at)
    SELECT $1,$2,$3,20,'Demo University','Walk-in','0900 000 0000','reviewed',now(),$4::timestamptz
    WHERE NOT EXISTS (SELECT 1 FROM vip_registrations v WHERE v.person_id=$2)`, [await nextId('vip_registrations'), pid, full, invite + 'T09:00:00+08:00']);
  await c.query(`UPDATE vip_registrations SET created_at=$1::timestamptz WHERE person_id=$2`, [invite + 'T09:00:00+08:00', pid]);
  for (const d of days) {
    await c.query(`INSERT INTO records(id,service_id,person_id,status,classification,source,recorded_by_name)
      SELECT $1,$2,$3,'present','first_timer','staff','Demo seed'
      WHERE NOT EXISTS (SELECT 1 FROM records r WHERE r.service_id=$2 AND r.person_id=$3)`, [await nextId('records'), svc[d], pid]);
  }
}
await c.query('COMMIT');
console.log('seeded demo VIP timers:', specs.map((s) => s[1]).join(', '));
process.exit(0);
