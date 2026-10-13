// VIP Gift Tracker — who among the VIPs has reached four Sunday attendances, and
// who has already received the gift that is handed out in person.
//
// Read path: derived live from records that already exist. There is no sync job,
// no copy of the attendance data and no change to the registration or attendance
// workflows. records.status='present' is the single source: staff marking a
// person present and a validated VIP check-in both land on that same row.
//
// Write path: one additive row in vip_gift_handouts per VIP, recorded by an
// admin or attendance staff member, and removable again as the approved Undo.

import { query, allocateId, logAction } from './db.js';
import { httpError } from './domain.js';

/** Sunday attendances that make a VIP eligible for the gift. */
export const GIFT_SUNDAYS_REQUIRED = 4;

// Distinct Sundays this person was actually present. Same definition the VIP
// registrations list already uses for "sundays_attended".
const ATTENDED = `(SELECT count(DISTINCT s.service_date)::int
   FROM records r JOIN services s ON s.id = r.service_id
  WHERE r.person_id = p.id AND r.status = 'present')`;

// Ready-for-gift rows first, then the ones still building up (closest first),
// then everyone already recorded.
const GIFT_ORDER = `CASE WHEN g.marked_at IS NOT NULL THEN 2
                         WHEN ${ATTENDED} >= ${GIFT_SUNDAYS_REQUIRED} THEN 0
                         ELSE 1 END`;

export const GIFT_ROWS_SQL = `SELECT p.id AS person_id,p.full_name,p.person_code,
   (SELECT vr.inviter FROM vip_registrations vr WHERE vr.person_id=p.id ORDER BY vr.id LIMIT 1) AS inviter,
   ${ATTENDED} AS sundays_attended,g.marked_at,g.marked_by_name
  FROM people p LEFT JOIN vip_gift_handouts g ON g.person_id=p.id
 WHERE p.archived_at IS NULL
   AND EXISTS (SELECT 1 FROM vip_registrations vr WHERE vr.person_id=p.id)
 ORDER BY ${GIFT_ORDER},${ATTENDED} DESC,p.full_name
 LIMIT 1000`;

const shapeRow = (r) => ({
  person_id: String(r.person_id),
  full_name: r.full_name,
  person_code: r.person_code,
  inviter: r.inviter || null,
  sundays_attended: Number(r.sundays_attended) || 0,
  gift_given: Boolean(r.marked_at),
  gift_given_at: r.marked_at ? new Date(r.marked_at).toISOString() : null,
  gift_given_by: r.marked_by_name || null,
});

/** Every VIP in the tracker, with the counts shown at the top of the card. */
export async function listGiftTracker() {
  const { rows } = await query(GIFT_ROWS_SQL);
  const items = rows.map(shapeRow);
  return {
    target: GIFT_SUNDAYS_REQUIRED,
    counts: {
      active_vips: items.length,
      gift_eligible: items.filter((i) => i.sundays_attended >= GIFT_SUNDAYS_REQUIRED && !i.gift_given).length,
      gift_given: items.filter((i) => i.gift_given).length,
    },
    items,
  };
}

/** Record that this VIP received the gift. One row per person, ever. */
export async function markGiftGiven({ personId, actor }, client) {
  const id = Number(personId);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'Invalid VIP.');
  const person = (await client.query(`SELECT p.id,p.full_name,${ATTENDED} AS sundays_attended FROM people p WHERE p.id=$1`, [id])).rows[0];
  if (!person) throw httpError(404, 'That VIP record was not found.');
  if (Number(person.sundays_attended) < GIFT_SUNDAYS_REQUIRED) {
    throw httpError(400, `This VIP has ${Number(person.sundays_attended)}/${GIFT_SUNDAYS_REQUIRED} Sunday attendances. The gift can be recorded at ${GIFT_SUNDAYS_REQUIRED}/${GIFT_SUNDAYS_REQUIRED}.`);
  }
  const registration = (await client.query('SELECT id FROM vip_registrations WHERE person_id=$1 ORDER BY id LIMIT 1', [id])).rows[0];
  const rowId = await allocateId(client, 'vip_gift_handouts');
  // ON CONFLICT DO NOTHING is the race guard for "one gift per person": if two
  // staff press the button together, only the first insert wins.
  const inserted = (await client.query(
    'INSERT INTO vip_gift_handouts(id,person_id,registration_id,marked_by,marked_by_name) VALUES($1,$2,$3,$4,$5) ON CONFLICT (person_id) DO NOTHING RETURNING id',
    [rowId, id, registration ? registration.id : null, actor?.id || null, actor?.display_name || null],
  )).rows[0];
  if (!inserted) return { person_id: String(id), full_name: person.full_name, already_recorded: true };
  await logAction(client, actor, 'vip_gift_handouts', inserted.id, 'gift_recorded', { person_id: id, sundays_attended: Number(person.sundays_attended) });
  return { person_id: String(id), full_name: person.full_name, recorded: true };
}

/** Undo a mis-click: remove the recording. Both events stay in the audit log. */
export async function undoGiftGiven({ personId, actor }, client) {
  const id = Number(personId);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'Invalid VIP.');
  const removed = (await client.query('DELETE FROM vip_gift_handouts WHERE person_id=$1 RETURNING id', [id])).rows[0];
  if (!removed) return { person_id: String(id), removed: false };
  await logAction(client, actor, 'vip_gift_handouts', removed.id, 'gift_undo', { person_id: id });
  return { person_id: String(id), removed: true };
}
