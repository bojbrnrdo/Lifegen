// VIP attendance — the one place that defines what "attended" means now.
//
// Attendance is tracked ONLY for VIPs and first timers. A validated VIP check-in
// (vip_checkins.status = 'valid', date_key = the Sunday) is the attendance
// record; there is no separate Sunday roster for regular members. Whether a
// member is continuous is the Cell Leader's call, recorded per Cell meeting in
// lifegroup_meeting_attendance.
//
// Anything that needs "how many Sundays has this person attended" or "which
// Sundays were those" uses these helpers so the definition cannot drift.

import { query } from './db.js';
import { isSunday, today } from './domain.js';

/**
 * SQL expression: distinct Sundays the person identified by `personColumn`
 * attended, as an int. `personColumn` is a SQL expression naming a person id,
 * normally `p.id` from an enclosing query.
 *
 * Joins vip_registrations because a check-in hangs off a registration, and a
 * person may have more than one registration over time.
 */
export function vipAttendedSundays(personColumn = 'p.id') {
  return `(SELECT count(DISTINCT c.date_key)::int
     FROM vip_checkins c JOIN vip_registrations vr ON vr.id = c.registration_id
    WHERE vr.person_id = ${personColumn} AND c.status = 'valid')`;
}

/** SQL expression: the most recent Sunday the person attended, or NULL. */
export function vipLastAttended(personColumn = 'p.id') {
  return `(SELECT max(c.date_key)
     FROM vip_checkins c JOIN vip_registrations vr ON vr.id = c.registration_id
    WHERE vr.person_id = ${personColumn} AND c.status = 'valid')`;
}

/**
 * Sundays between two ISO dates inclusive. Used where the old code read the
 * list of service dates out of the `services` table, which no longer exists.
 * A month's Sundays are a calendar fact, not stored data.
 */
export function sundaysBetween(from, to) {
  const out = [];
  if (!from || !to) return out;
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (isSunday(iso)) out.push(iso);
  }
  return out;
}

/**
 * person_id -> Set of attended Sundays, for the people matching a filter.
 * `registrationIds` narrows the query when the caller already has them.
 */
export async function attendedByPerson({ from, to, personIds = null } = {}) {
  const params = [];
  let where = `c.status='valid'`;
  if (from) { params.push(from); where += ` AND c.date_key >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` AND c.date_key <= $${params.length}::date`; }
  if (personIds && personIds.length) { params.push(personIds); where += ` AND vr.person_id = ANY($${params.length}::bigint[])`; }
  const { rows } = await query(`SELECT vr.person_id, c.date_key::text AS d
    FROM vip_checkins c JOIN vip_registrations vr ON vr.id=c.registration_id
    WHERE ${where}`, params);
  const map = new Map();
  for (const r of rows) {
    const key = Number(r.person_id);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(r.d);
  }
  return map;
}

/** Sundays in the current month up to today — the window the streak logic uses. */
export function currentMonthSundays() {
  const t = today();
  const monthStart = `${t.slice(0, 7)}-01`;
  return { monthStart, today: t, sundays: sundaysBetween(monthStart, t) };
}
