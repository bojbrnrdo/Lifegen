// Demo-only: puts example VIPs on the coming Sunday's announcement board so the
// fullscreen VIP welcome can be checked end to end on the local preview.
// Pair it with LOCAL_DEMO_CLOCK (see preview-db/README.md) so the clock is on
// that Sunday at service time. Runs over the wire gateway on 127.0.0.1:5433 only.
// Idempotent: re-running adds nothing new.
import pg from 'pg';

const SUNDAY = '2026-10-18';
const WINDOW_MINUTES = 120; // keep the board up for the whole demo service.
const VIPS = [
  // [first, last, inviter (null = not given), registered at (Manila)]
  ['Ana', 'Reyes', 'Maria Santos', '2026-10-17T09:15:00+08:00'],
  ['Mark', 'Villanueva', 'Jose Bautista', '2026-10-17T10:40:00+08:00'],
  ['Grace', 'Dela Cruz', 'Ruth Aquino', '2026-10-17T14:05:00+08:00'],
  ['Paolo', 'Garcia', null, '2026-10-17T18:20:00+08:00'],
];

const c = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'postgres', database: 'lifegen', ssl: false });
await c.connect();
await c.query('BEGIN');
const nextId = async (entity) => (await c.query('UPDATE id_counters SET last_id=last_id+1 WHERE entity=$1 RETURNING last_id', [entity])).rows[0].last_id;

// Make sure the Sunday exists as a service, like the regular demo seed does.
if (!(await c.query('SELECT 1 FROM services WHERE service_date=$1', [SUNDAY])).rows.length) {
  await c.query(`INSERT INTO services(id,service_date,service_type,is_demo,notes)
                 VALUES($1,$2,'lifegen',true,'Sunday demo seed for preview')`, [await nextId('services'), SUNDAY]);
}

// A 2-hour board window so the demo does not hand back to the countdown mid-service.
await c.query(`INSERT INTO settings(key,value) VALUES('vip_announce_minutes', to_jsonb($1::int))
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [WINDOW_MINUTES]);

let code = 9101;
for (const [first, last, inviter, at] of VIPS) {
  const full = `${first} ${last}`;
  let row = (await c.query('SELECT id FROM people WHERE first_name=$1 AND last_name=$2 AND is_demo=true', [first, last])).rows[0];
  const pid = row ? row.id : (await c.query(`INSERT INTO people(id,person_code,first_name,last_name,full_name,status,date_registered,registration_source,is_demo,notes)
      VALUES($1,$2,$3,$4,$5,'first_timer',$6,'staff',true,'Sunday demo seed for preview') RETURNING id`,
      [await nextId('people'), `2026-${code++}`, first, last, full, at.slice(0, 10)])).rows[0].id;
  // Attributed to the Sunday, exactly as the public registration endpoint would store it.
  await c.query(`INSERT INTO vip_registrations(id,person_id,full_name,age,school,inviter,contact,review_status,reviewed_at,created_at,service_date)
    SELECT $1,$2,$3,20,'Demo University',$4,'0900 000 0000','reviewed',now(),$5::timestamptz,$6::date
    WHERE NOT EXISTS (SELECT 1 FROM vip_registrations v WHERE v.person_id=$2 AND v.service_date=$6::date)`,
    [await nextId('vip_registrations'), pid, full, inviter, at, SUNDAY]);
}
await c.query('COMMIT');

const { rows } = await c.query('SELECT full_name, inviter FROM vip_registrations WHERE service_date=$1 ORDER BY created_at, id', [SUNDAY]);
console.log(`Sunday ${SUNDAY}: ${rows.length} VIP(s) on the board:`, rows.map((r) => `${r.full_name} (invited by ${r.inviter || 'not given'})`).join('; '));
await c.end();
process.exit(0);
