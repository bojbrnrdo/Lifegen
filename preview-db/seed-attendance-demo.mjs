// Demo polish for the Service Attendance page: members marked in for the
// current Sunday, inviters + cells on the VIPs, one token already given.
// Local demo only (PGlite gateway on 127.0.0.1:5433). Idempotent.
import pg from 'pg';
const db = new pg.Client({ connectionString: 'postgres://postgres@127.0.0.1:5433/lifegen' });
await db.connect();
const q = (sql, args = []) => db.query(sql, args);

const { rows: [today] } = await q("SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text AS d");
const { rows: [sunday] } = await q("SELECT ($1::date - (extract(dow from $1::date))::int)::text AS d", [today.d]);
const S = sunday.d;

// Everyone on the roll call for this Sunday, members first.
const { rows: people } = await q(`SELECT p.id, p.full_name, p.status,
    EXISTS(SELECT 1 FROM vip_registrations v WHERE v.person_id=p.id) AS vip
  FROM people p WHERE p.archived_at IS NULL AND p.status<>'inactive'
   AND p.date_registered <= $1::date
  ORDER BY (EXISTS(SELECT 1 FROM vip_registrations v WHERE v.person_id=p.id)), p.id`, [S]);
const members = people.filter((p) => !p.vip).slice(0, 6);
console.log('members on the roll call:', members.length);

let marked = 0;
for (const m of members) {
  const r = await q(`INSERT INTO service_attendance(id, date_key, person_id, marked_by_name, marked_at)
    VALUES ((SELECT coalesce(max(id),0)+1 FROM service_attendance), $1::date, $2, 'Demo Admin', now())
    ON CONFLICT (date_key, person_id) DO NOTHING RETURNING id`, [S, m.id]);
  marked += r.rowCount;
}
console.log('members marked in for', S, ':', marked);

// Inviters, the way the door sheet shows them, and a cell for most VIPs.
const INVITERS = ['Zxai', 'Maria', 'Joy', 'Yhail'];
let invited = 0;
const vips = people.filter((p) => p.vip);
for (let i = 0; i < vips.length; i++) {
  if (i % 5 === 4) continue; // some VIPs still have no inviter
  const r = await q(`UPDATE vip_registrations SET inviter=coalesce(inviter,$1)
    WHERE person_id=$2 AND id=(SELECT min(id) FROM vip_registrations WHERE person_id=$2)`,
  [INVITERS[i % INVITERS.length], vips[i].id]);
  invited += r.rowCount;
}
console.log('inviters set on', invited, 'VIPs');

// A few first timers: a VIP registration and a check-in on this Sunday only, so
// the roll call shows the FIRST TIMER chip and 1/4 the way the draft did.
const FIRST_TIMERS = [
  ['Chaddy', 'Enriquez', 'Zxai'],
  ['Mark', 'Castillo', 'Zxai'],
  ['Liza', 'Ocampo', 'Maria'],
];
for (const [i, [first, last, inviter]] of FIRST_TIMERS.entries()) {
  const code = `2026-F${String(i + 1).padStart(3, '0')}`;
  let person = (await q('SELECT id FROM people WHERE person_code=$1', [code])).rows[0];
  if (!person) {
    person = (await q(`INSERT INTO people(id, person_code, first_name, last_name, full_name, status,
        inviter, date_registered, registration_source, is_demo)
      VALUES ((SELECT coalesce(max(id),0)+1 FROM people), $1, $2, $3, $4, 'first_timer', $5, $6::date, 'staff', true)
      RETURNING id`, [code, first, last, `${first} ${last}`, inviter, S])).rows[0];
  }
  let reg = (await q('SELECT id FROM vip_registrations WHERE person_id=$1', [person.id])).rows[0];
  if (!reg) {
    reg = (await q(`INSERT INTO vip_registrations(id, person_id, full_name, inviter, review_status, service_date)
      VALUES ((SELECT coalesce(max(id),0)+1 FROM vip_registrations), $1, $2, $3, 'reviewed', $4::date) RETURNING id`,
    [person.id, `${first} ${last}`, inviter, S])).rows[0];
  }
  await q(`INSERT INTO vip_checkins(id, registration_id, date_key, status, validated_at)
    VALUES ((SELECT coalesce(max(id),0)+1 FROM vip_checkins), $1, $2::date, 'valid', now())
    ON CONFLICT DO NOTHING`, [reg.id, S]).catch(() => {});
}
console.log('first timers on', S, ':', FIRST_TIMERS.length);

// One token already handed over, so the chip is not always zero.
const { rows: cells } = await q(`SELECT id FROM lifegroups WHERE is_active ORDER BY id LIMIT 1`).catch(() => ({ rows: [] }));
if (cells.length) {
  let inCell = 0;
  for (const [n, p] of vips.slice(0, 4).entries()) {
    if (n === 1) continue; // one VIP still has no cell yet, like the draft
    const r = await q(`INSERT INTO lifegroup_memberships(id, lifegroup_id, person_id, joined_at)
      SELECT (SELECT coalesce(max(id),0)+1 FROM lifegroup_memberships), $1, $2, $3::date
      WHERE NOT EXISTS (SELECT 1 FROM lifegroup_memberships WHERE person_id=$2 AND left_at IS NULL)`,
    [cells[0].id, p.id, S]).catch(() => ({ rowCount: 0 }));
    inCell += r.rowCount || 0;
  }
  console.log('VIPs put in a cell:', inCell);
}
const { rows: [ready] } = await q(`SELECT p.id FROM people p
  WHERE EXISTS(SELECT 1 FROM vip_registrations v WHERE v.person_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM vip_gift_handouts g WHERE g.person_id=p.id)
    AND (SELECT count(DISTINCT c.date_key) FROM vip_checkins c
          JOIN vip_registrations v ON v.id=c.registration_id
         WHERE v.person_id=p.id AND c.status='valid') >= 4
  ORDER BY p.id LIMIT 1`);
if (ready) {
  await q(`INSERT INTO vip_gift_handouts(id, person_id, marked_by_name)
    VALUES ((SELECT coalesce(max(id),0)+1 FROM vip_gift_handouts), $1, 'Demo Admin')
    ON CONFLICT (person_id) DO NOTHING`, [ready.id]);
  console.log('one token given to person', ready.id);
}
await db.end();
