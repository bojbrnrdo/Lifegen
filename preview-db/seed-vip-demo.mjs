// Seeds demo VIP registrations + October attendance so the Registrations
// "This month" column can show the full 1st→4th-timer progression in preview.
// Runs over the wire gateway (start server.mjs first). Idempotent.
import pg from 'pg';
const c = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'postgres', database: 'lifegen', ssl: false });
await c.connect();
await c.query('BEGIN');
const nextId = async (entity) => (await c.query('UPDATE id_counters SET last_id=last_id+1 WHERE entity=$1 RETURNING last_id', [entity])).rows[0].last_id;

// Demo services for the later October Sundays (future dates, demo-only).
for (const d of ['2026-10-18', '2026-10-25']) {
  await c.query(`INSERT INTO services(id,service_date,service_type,is_demo,notes)
                 SELECT $1,$2,'lifegen',true,'Demo seed for monthly timer preview'
                 WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.service_date=$2)`, [await nextId('services'), d]);
}
const svc = {};
for (const r of (await c.query(`SELECT id, service_date::text AS d FROM services
  WHERE service_date IN ('2026-10-04','2026-10-11','2026-10-18','2026-10-25')`)).rows) svc[r.d] = r.id;

const specs = [
  ['Demo', 'FourWeeks',  ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']], // 4 timer, complete
  ['Demo', 'ThreeWeeks', ['2026-10-04', '2026-10-11', '2026-10-18']],               // 3 timer
  ['Demo', 'TwoWeeks',   ['2026-10-04', '2026-10-11']],                              // 2 timer
  ['Demo', 'OneWeek',    ['2026-10-04']],                                            // streak resets to 0 if they miss Oct 11
  ['Demo', 'TodayOnly',  ['2026-10-11']],                                            // streak 1
  ['Demo', 'LastTwoWeeks',['2026-10-18','2026-10-25']],                              // streak 2 late in the month
  ['Demo', 'ThreeInARow',['2026-10-11','2026-10-18','2026-10-25']],                  // streak 3 late in the month
];

let code = 9001;
for (const [fn, ln, days] of specs) {
  const full = `${fn} ${ln}`;
  let row = (await c.query(`SELECT id FROM people WHERE first_name=$1 AND last_name=$2 AND is_demo=true`, [fn, ln])).rows[0];
  let pid;
  if (row) pid = row.id;
  else {
    pid = (await c.query(`INSERT INTO people(id,person_code,first_name,last_name,full_name,status,date_registered,registration_source,is_demo,notes)
      VALUES($1,$2,$3,$4,$5,'first_timer','2026-10-01','staff',true,'Demo seed for monthly timer preview') RETURNING id`,
      [await nextId('people'), `2026-${code++}`, fn, ln, full])).rows[0].id;
  }
  await c.query(`INSERT INTO vip_registrations(id,person_id,full_name,age,school,inviter,contact,review_status,reviewed_at)
    SELECT $1,$2,$3,20,'Demo University','Walk-in','0900 000 0000','reviewed',now()
    WHERE NOT EXISTS (SELECT 1 FROM vip_registrations v WHERE v.person_id=$2)`, [await nextId('vip_registrations'), pid, full]);
  for (const d of days) {
    await c.query(`INSERT INTO records(id,service_id,person_id,status,classification,source,recorded_by_name)
      SELECT $1,$2,$3,'present','first_timer','staff','Demo seed'
      WHERE NOT EXISTS (SELECT 1 FROM records r WHERE r.service_id=$2 AND r.person_id=$3)`, [await nextId('records'), svc[d], pid]);
  }
}
await c.query('COMMIT');
console.log('seeded demo VIP timers:', specs.map(s => s[1]).join(', '));
process.exit(0);
