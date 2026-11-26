// Service Attendance — the Sunday register for everyone in the room.
//
// Two sources answer "who was here on Sunday", and this module is the only
// place that combines them:
//
//   1. vip_checkins (status='valid')  the attendance record for VIPs and first
//      timers. Migration 017 made this the one place a VIP's Sunday lives, and
//      the VIP portal, the prize streak and the Gift Tracker all read it. This
//      page does not copy it — it reads it, and marking a VIP here writes it.
//   2. service_attendance             the roster for everyone else (members), and
//      any staff override of who counts as a VIP that day.
//
// A person is in the list for a Sunday when they already existed by that
// Sunday: registered and, for a VIP, first seen on or before it. That keeps a
// past Sunday's numbers stable instead of growing every time someone registers.
//
// Roll-call categories match the original prototype: Member / VIP first timer /
// VIP returning / Headcount. Headcount is stored per Sunday in
// service_headcounts and never belongs to a named person.

import { query, allocateId, logAction } from './db.js';
import { httpError, isSunday, today } from './domain.js';

/** Categories that can be pinned on a single Sunday (NULL = from the record). */
const CATEGORIES = ['member', 'vip'];

/** Sundays of one calendar month, in order. */
export function sundaysOfMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw httpError(400, 'Choose a month.');
  const [y, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) throw httpError(400, 'Choose a month.');
  const out = [];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (isSunday(key)) out.push(key);
  }
  return out;
}

/** The month a Sunday belongs to, and the Sundays of that month. */
function monthFor(dateKey) {
  return { month: dateKey.slice(0, 7), sundays: sundaysOfMonth(dateKey.slice(0, 7)) };
}

/** The Sunday service date a request is about. Only Sundays exist. */
function serviceDate(value, { fallbackToday = false } = {}) {
  const key = String(value || '').trim();
  if (!key && fallbackToday) {
    const t = today();
    const d = new Date(`${t}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().slice(0, 10);
  }
  if (!isSunday(key)) throw httpError(400, 'Choose a Sunday service date.');
  return key;
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

/**
 * Who can be marked for `dateKey`: everyone who was already in the system by
 * that Sunday, plus their category and whether they are marked present.
 *
 * `headcount` is the stored number of people in the room who are not in the
 * list — the total is present people plus this number.
 */
export async function serviceAttendanceRegister({ dateKey } = {}) {
  const date = serviceDate(dateKey, { fallbackToday: true });
  const { month, sundays } = monthFor(date);

  const people = (await query(
    `SELECT p.id, p.person_code, p.full_name, p.status, p.sex,
            p.date_first_attended::text AS date_first_attended,
            p.date_registered::text AS date_registered,
            m.id AS lifegroup_id, m.name AS lifegroup_name,
            EXISTS (SELECT 1 FROM vip_registrations vr WHERE vr.person_id = p.id) AS is_vip_person,
            (SELECT count(DISTINCT c.date_key)::int
               FROM vip_checkins c JOIN vip_registrations vr ON vr.id = c.registration_id
              WHERE vr.person_id = p.id AND c.status = 'valid' AND c.date_key <= $1::date) AS vip_sundays_to_date,
            (SELECT min(c.date_key)::text
               FROM vip_checkins c JOIN vip_registrations vr ON vr.id = c.registration_id
              WHERE vr.person_id = p.id AND c.status = 'valid') AS vip_first_attended,
            (SELECT v.inviter FROM vip_registrations v WHERE v.person_id = p.id ORDER BY v.id LIMIT 1) AS inviter,
            ck.id AS checkin_id,
            sa.id AS override_id, sa.category AS override_category,
            sa.marked_by_name AS marked_by_name, sa.marked_at
       FROM people p
       LEFT JOIN lifegroup_memberships lm
              ON lm.person_id = p.id AND lm.left_at IS NULL
       LEFT JOIN lifegroups m ON m.id = lm.lifegroup_id AND m.is_active
       LEFT JOIN vip_checkins ck
              ON ck.registration_id = (SELECT vr2.id FROM vip_registrations vr2
                                        WHERE vr2.person_id = p.id ORDER BY vr2.id LIMIT 1)
             AND ck.date_key = $1::date AND ck.status = 'valid'
       LEFT JOIN service_attendance sa ON sa.person_id = p.id AND sa.date_key = $1::date
      WHERE p.archived_at IS NULL
        AND p.status <> 'inactive'
        AND p.date_registered <= $1::date
      ORDER BY coalesce(p.full_name, p.first_name || ' ' || p.last_name)`,
    [date],
  )).rows;

  const { rows: headRows } = await query('SELECT headcount FROM service_headcounts WHERE date_key=$1::date', [date]);
  const headcount = Number(headRows[0]?.headcount) || 0;

  // Tokens (the gift for four Sundays) already handed over. The Attendance page
  // only reports the number; the gift itself is recorded in the Gift Tracker.
  const { rows: giftRows } = await query('SELECT count(*)::int AS n FROM vip_gift_handouts');
  const tokensGiven = Number(giftRows[0]?.n) || 0;

  // Every Sunday of the month, per person, in one query: the VIP check-ins plus
  // the member roster. The gift counter and the history sheet need it, and one
  // query is what keeps the page from asking for each person separately.
  const { rows: monthRows } = await query(
    `SELECT DISTINCT person_id::text AS person_id, date_key::text AS d FROM (
       SELECT sa.person_id, sa.date_key FROM service_attendance sa
        WHERE sa.date_key BETWEEN $1::date AND $2::date
       UNION ALL
       SELECT vr.person_id, c.date_key FROM vip_checkins c
         JOIN vip_registrations vr ON vr.id = c.registration_id
        WHERE c.status='valid' AND c.date_key BETWEEN $1::date AND $2::date
     ) attended`,
    [sundays[0], sundays[sundays.length - 1]],
  );
  const monthAttendance = {};
  for (const r of monthRows) (monthAttendance[r.person_id] = monthAttendance[r.person_id] || []).push(r.d);
  for (const key of Object.keys(monthAttendance)) monthAttendance[key].sort();

  // The nearest Sunday each person was present, for "not yet here" and for the
  // 4/4 gift counter. vip_checkins is the VIP source; service_attendance rows
  // are the member source.
  const personIds = people.map((p) => Number(p.id));
  const lastSeen = new Map();
  if (personIds.length) {
    const { rows } = await query(
      `SELECT person_id, max(date_key)::text AS last_seen FROM (
         SELECT sa.person_id, sa.date_key FROM service_attendance sa
          WHERE sa.date_key <= $1::date AND sa.person_id = ANY($2::bigint[])
         UNION ALL
         SELECT vr.person_id, c.date_key FROM vip_checkins c
           JOIN vip_registrations vr ON vr.id = c.registration_id
          WHERE c.status='valid' AND c.date_key <= $1::date AND vr.person_id = ANY($2::bigint[])
       ) seen GROUP BY person_id`,
      [date, personIds],
    );
    for (const r of rows) lastSeen.set(Number(r.person_id), r.last_seen);
  }

  const items = people.map((p) => {
    const vipCheckin = Boolean(p.checkin_id);
    const override = p.override_category || null;
    const storedCategory = p.is_vip_person ? 'vip' : 'member';
    const category = override || storedCategory;
    const present = vipCheckin || Boolean(p.override_id);
    // "First timer" is only meaningful for a VIP's very first Sunday.
    const firstTimer = category === 'vip' && Number(p.vip_sundays_to_date || 0) === 0 && !vipCheckin;
    return {
      person_id: Number(p.id),
      person_code: p.person_code,
      full_name: p.full_name || '',
      status: p.status,
      sex: p.sex || null,
      category,
      category_source: override ? 'override' : 'record',
      stored_category: storedCategory,
      present,
      // Where presence comes from, so the UI can explain an untoggleable row.
      present_source: vipCheckin ? 'vip_checkin' : p.override_id ? 'roster' : null,
      first_timer: firstTimer,
      vip_sundays: Number(p.vip_sundays_to_date || 0),
      gift_ready: category === 'vip' && Number(p.vip_sundays_to_date || 0) >= 4,
      lifegroup_id: p.lifegroup_id ? Number(p.lifegroup_id) : null,
      lifegroup_name: p.lifegroup_name || null,
      // Who invited them — the roll call shows it the way the door team knows people.
      inviter: p.inviter || null,
      last_seen: lastSeen.get(Number(p.id)) || null,
      marked_by_name: p.marked_by_name || null,
      marked_at: iso(p.marked_at),
    };
  });

  return {
    date: date,
    month,
    sundays,
    today: today(),
    is_future: date > today(),
    // The headcount is the people in the room who were never checked in by name.
    // The totals themselves are derived from `items` + `headcount` on the client
    // (see stats() in views/attendance.js) so there is one definition of them.
    headcount,
    // Tokens handed over so far, for the chip under the totals.
    tokens_given: tokensGiven,
    items,
    month_attendance: monthAttendance,
  };
}

/**
 * One month at a glance — one row per Sunday with its totals. This is the
 * "Report" panel of the original page, now kept as history.
 */
export async function serviceAttendanceReport({ month } = {}) {
  const key = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : today().slice(0, 7);
  const sundays = sundaysOfMonth(key);
  if (!sundays.length) throw httpError(400, 'Choose a month that has a Sunday.');
  const from = sundays[0];
  const to = sundays[sundays.length - 1];
  const t = today();

  const { rows: rosterRows } = await query(
    `SELECT sa.date_key::text AS d,
            count(*) FILTER (WHERE coalesce(sa.category, CASE WHEN vip.person_id IS NULL THEN 'member' ELSE 'vip' END) = 'member')::int AS members,
            count(*) FILTER (WHERE coalesce(sa.category, CASE WHEN vip.person_id IS NULL THEN 'member' ELSE 'vip' END) = 'vip')::int AS vips
       FROM service_attendance sa
       LEFT JOIN LATERAL (SELECT 1 AS person_id FROM vip_registrations vr WHERE vr.person_id = sa.person_id LIMIT 1) vip ON true
      WHERE sa.date_key BETWEEN $1::date AND $2::date
      GROUP BY sa.date_key`,
    [from, to],
  );
  const { rows: headRows } = await query(
    'SELECT date_key::text AS d, headcount::int AS headcount FROM service_headcounts WHERE date_key BETWEEN $1::date AND $2::date',
    [from, to],
  );

  const byDate = new Map(sundays.map((d) => [d, { date: d, members: 0, vips: 0, headcount: 0, held: false }]));
  for (const r of rosterRows) {
    const row = byDate.get(r.d);
    if (!row) continue;
    row.members += Number(r.members) || 0;
    row.vips += Number(r.vips) || 0;
    row.held = true;
  }
  // A VIP check-in is attendance too; only count the people not already on the roster.
  const { rows: rosterPeople } = await query(
    `SELECT sa.date_key::text AS d, sa.person_id FROM service_attendance sa WHERE sa.date_key BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const rosterSet = new Set(rosterPeople.map((r) => `${r.d}:${r.person_id}`));
  const { rows: checkinPeople } = await query(
    `SELECT c.date_key::text AS d, vr.person_id FROM vip_checkins c
       JOIN vip_registrations vr ON vr.id = c.registration_id
      WHERE c.status='valid' AND c.date_key BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const seen = new Set(rosterSet);
  for (const r of checkinPeople) {
    const key2 = `${r.d}:${r.person_id}`;
    if (seen.has(key2)) continue;
    seen.add(key2);
    const row = byDate.get(r.d);
    if (row) { row.vips += 1; row.held = true; }
  }
  for (const r of headRows) {
    const row = byDate.get(r.d);
    if (row) { row.headcount = Number(r.headcount) || 0; row.held = true; }
  }

  const days = sundays.map((d) => {
    const row = byDate.get(d);
    return { ...row, total: row.members + row.vips + row.headcount, future: d > t, today: d === t };
  });
  const held = days.filter((d) => d.held && !d.future);
  const sum = (k) => days.reduce((n, d) => n + d[k], 0);
  return {
    month: key,
    today: t,
    sundays: days,
    // Totals count the Sundays that have actually happened, so an empty future
    // Sunday never drags the average down.
    totals: {
      services: held.length,
      members: sum('members'),
      vips: sum('vips'),
      headcount: sum('headcount'),
      total: sum('total'),
      average: held.length ? Math.round(held.reduce((n, d) => n + d.total, 0) / held.length) : 0,
      best: held.reduce((best, d) => (d.total > (best?.total || 0) ? d : best), null),
    },
  };
}

/**
 * Mark or clear one person's presence for a Sunday.
 *
 * VIPs are written to vip_checkins (the record every other screen reads);
 * members are written to service_attendance. Removing a VIP's presence only
 * deletes a check-in this page created (extras.service_attendance = true) — a
 * validated by hand or submitted from the mobile QR stays, and is reported
 * back as still present instead of silently disagreeing with the list.
 */
export async function setServiceAttendance({ dateKey, personId, present, category }, actor, client) {
  const date = serviceDate(dateKey);
  const id = Number(personId);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'Choose a person.');
  const want = present === true;

  const person = (await client.query(
    `SELECT p.id, p.full_name, p.status, p.date_registered::text AS date_registered, p.archived_at,
            EXISTS (SELECT 1 FROM vip_registrations vr WHERE vr.person_id = p.id) AS is_vip
       FROM people p WHERE p.id=$1 FOR UPDATE`,
    [id],
  )).rows[0];
  if (!person || person.archived_at) throw httpError(404, 'That person is not an active record.');
  if (person.date_registered > date) throw httpError(409, 'That person had not joined yet on this Sunday.');

  const registration = (await client.query(
    'SELECT id FROM vip_registrations WHERE person_id=$1 ORDER BY id LIMIT 1',
    [id],
  )).rows[0];
  const pinned = CATEGORIES.includes(String(category || '')) ? String(category) : null;

  if (want) {
    if (registration) {
      const existing = (await client.query(
        'SELECT id, status FROM vip_checkins WHERE registration_id=$1 AND date_key=$2::date',
        [registration.id, date],
      )).rows[0];
      if (!existing) {
        const checkinId = await allocateId(client, 'vip_checkins');
        await client.query(
          `INSERT INTO vip_checkins(id, registration_id, date_key, status, validated_by, validated_at, extras)
           VALUES($1,$2,$3::date,'valid',$4,now(),$5::jsonb)`,
          [checkinId, registration.id, date, actor?.id || null, JSON.stringify({ service_attendance: true, marked_by_name: actor?.display_name || null })],
        );
      } else if (existing.status !== 'valid') {
        await client.query("UPDATE vip_checkins SET status='valid', validated_by=$2, validated_at=now() WHERE id=$1", [existing.id, actor?.id || null]);
      }
      // The VIP check-in is the record; a roster row would double-count them.
      await client.query('DELETE FROM service_attendance WHERE date_key=$1::date AND person_id=$2', [date, id]);
      await client.query(
        `UPDATE people SET date_first_attended=$1::date, updated_at=now()
          WHERE id=$2 AND (date_first_attended IS NULL OR date_first_attended > $1::date)`,
        [date, id],
      );
    } else {
      const rosterId = await allocateId(client, 'service_attendance');
      await client.query(
        `INSERT INTO service_attendance(id, date_key, person_id, category, marked_by, marked_by_name)
         VALUES($1,$2::date,$3,$4,$5,$6)
         ON CONFLICT (date_key, person_id) DO UPDATE
           SET category=EXCLUDED.category, marked_by=EXCLUDED.marked_by,
               marked_by_name=EXCLUDED.marked_by_name, marked_at=now()`,
        [rosterId, date, id, pinned, actor?.id || null, actor?.display_name || null],
      );
    }
    if (person.status === 'member' || person.status === 'leader' || person.status === 'volunteer') {
      await client.query(
        `UPDATE people SET date_first_attended=$1::date, updated_at=now()
          WHERE id=$2 AND date_first_attended IS NULL`,
        [date, id],
      );
    }
    await logAction(client, actor, 'service_attendance', id, 'present', { date, category: pinned || (registration ? 'vip' : 'member') });
    return { person_id: id, present: true, source: registration ? 'vip_checkin' : 'roster' };
  }

  // Clearing presence.
  let note = null;
  if (registration) {
    const existing = (await client.query(
      'SELECT id, extras, validated_by FROM vip_checkins WHERE registration_id=$1 AND date_key=$2::date',
      [registration.id, date],
    )).rows[0];
    if (existing) {
      const ours = Boolean(existing.extras && existing.extras.service_attendance);
      if (!ours) {
        // Submitted from the mobile QR or validated by hand elsewhere. This page
        // does not get to delete that silently.
        note = 'This VIP checked in through the service QR (or staff validation), so the presence stays. Manage it in Registration → Check-ins.';
        return { person_id: id, present: true, source: 'vip_checkin', locked: true, message: note };
      }
      await client.query('DELETE FROM vip_checkins WHERE id=$1', [existing.id]);
    }
  }
  await client.query('DELETE FROM service_attendance WHERE date_key=$1::date AND person_id=$2', [date, id]);
  await logAction(client, actor, 'service_attendance', id, 'absent', { date });
  return { person_id: id, present: false, source: null };
}

/** Pin a different roll-call category for one Sunday, or clear the pin. */
export async function setServiceAttendanceCategory({ dateKey, personId, category }, actor, client) {
  const date = serviceDate(dateKey);
  const id = Number(personId);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'Choose a person.');
  const person = (await client.query('SELECT id, full_name, archived_at FROM people WHERE id=$1', [id])).rows[0];
  if (!person || person.archived_at) throw httpError(404, 'That person is not an active record.');
  const value = category === null || category === '' || category === 'record' ? null : String(category);
  if (value && !CATEGORIES.includes(value)) throw httpError(400, 'Choose Member or VIP.');
  const existing = (await client.query('SELECT id FROM service_attendance WHERE date_key=$1::date AND person_id=$2', [date, id])).rows[0];
  if (existing) {
    if (value) await client.query('UPDATE service_attendance SET category=$1 WHERE id=$2', [value, existing.id]);
    else await client.query('UPDATE service_attendance SET category=NULL WHERE id=$1', [existing.id]);
  } else {
    // A category without presence is only meaningful for someone already
    // present through a VIP check-in; store it so the roll call agrees with
    // what was chosen that day.
    const rosterId = await allocateId(client, 'service_attendance');
    await client.query(
      `INSERT INTO service_attendance(id, date_key, person_id, category, marked_by, marked_by_name)
       VALUES($1,$2::date,$3,$4,$5,$6)`,
      [rosterId, date, id, value, actor?.id || null, actor?.display_name || null],
    );
  }
  await logAction(client, actor, 'service_attendance', id, 'category', { date, category: value });
  return { person_id: id, category: value };
}

/** Save the "not checked in" headcount for a Sunday. */
export async function setServiceHeadcount({ dateKey, headcount }, actor, client) {
  const date = serviceDate(dateKey);
  const n = Number(headcount);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw httpError(400, 'Headcount must be a whole number from 0 to 100 000.');
  await client.query(
    `INSERT INTO service_headcounts(date_key, headcount, updated_by, updated_at) VALUES($1::date,$2,$3,now())
     ON CONFLICT (date_key) DO UPDATE SET headcount=EXCLUDED.headcount, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [date, n, actor?.id || null],
  );
  await logAction(client, actor, 'service_headcounts', date, 'headcount', { headcount: n });
  return { date_key: date, headcount: n };
}

/**
 * Add someone who is not in the directory yet — a walk-in. They become a real
 * person record (and a VIP, when the roll call says so) so no attendance is
 * ever orphaned, then they are marked present for this Sunday.
 */
export async function addServiceAttendancePerson({ dateKey, fullName, category, invitedBy, markedPresent }, actor, client) {
  const date = serviceDate(dateKey);
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw httpError(400, 'Enter the person\'s full name (2–120 characters).');
  const parts = name.split(' ');
  const first = parts[0];
  const last = parts.slice(1).join(' ') || '—';
  const isVip = String(category || 'vip') === 'vip';
  const inviter = String(invitedBy || '').trim().slice(0, 200) || null;

  const personId = await allocateId(client, 'people');
  const year = date.slice(0, 4);
  const { rows: codeRows } = await client.query(
    `SELECT coalesce(max((split_part(person_code,'-',3))::int),0) + 1 AS n
       FROM people WHERE person_code LIKE $1`,
    [`LG-${year}-%`],
  );
  const personCode = `LG-${year}-${String(Number(codeRows[0]?.n) || 1).padStart(4, '0')}`;
  await client.query(
    `INSERT INTO people(id, person_code, first_name, last_name, full_name, status, inviter,
                        date_registered, registration_source, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,'service_attendance',now())`,
    [personId, personCode, first, last, name, isVip ? 'first_timer' : 'member', inviter, date],
  );

  let registrationId = null;
  if (isVip) {
    registrationId = await allocateId(client, 'vip_registrations');
    await client.query(
      `INSERT INTO vip_registrations(id, person_id, full_name, inviter) VALUES($1,$2,$3,$4)`,
      [registrationId, personId, name, inviter],
    );
  }

  if (markedPresent !== false) {
    if (registrationId) {
      const checkinId = await allocateId(client, 'vip_checkins');
      await client.query(
        `INSERT INTO vip_checkins(id, registration_id, date_key, status, validated_by, validated_at, extras)
         VALUES($1,$2,$3::date,'valid',$4,now(),$5::jsonb)`,
        [checkinId, registrationId, date, actor?.id || null, JSON.stringify({ service_attendance: true, walk_in: true, marked_by_name: actor?.display_name || null })],
      );
      await client.query('UPDATE people SET date_first_attended=$1::date, updated_at=now() WHERE id=$2', [date, personId]);
    } else {
      const rosterId = await allocateId(client, 'service_attendance');
      await client.query(
        `INSERT INTO service_attendance(id, date_key, person_id, category, marked_by, marked_by_name)
         VALUES($1,$2::date,$3,'member',$4,$5)`,
        [rosterId, date, personId, actor?.id || null, actor?.display_name || null],
      );
      await client.query('UPDATE people SET date_first_attended=$1::date, updated_at=now() WHERE id=$2', [date, personId]);
    }
  }
  await logAction(client, actor, 'people', personId, 'walk_in_registration', { date, category: isVip ? 'vip' : 'member', marked_present: markedPresent !== false });
  return { person_id: personId, person_code: personCode, full_name: name, category: isVip ? 'vip' : 'member', registration_id: registrationId };
}

/**
 * The "care" list of the original page: every one of the five most recent
 * Sundays nobody has recorded anything for, so a forgotten Sunday is visible
 * instead of silently reading as zero attendance.
 */
export async function serviceAttendanceUnrecorded({ weeks = 8 } = {}) {
  const count = Math.min(Math.max(Number(weeks) || 8, 1), 26);
  const t = today();
  const base = new Date(`${t}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - base.getUTCDay());
  const sundays = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i * 7);
    sundays.push(d.toISOString().slice(0, 10));
  }
  const { rows } = await query(
    `SELECT d::text AS date_key,
            EXISTS (SELECT 1 FROM service_attendance sa WHERE sa.date_key = d) AS has_roster,
            EXISTS (SELECT 1 FROM service_headcounts h WHERE h.date_key = d) AS has_headcount,
            EXISTS (SELECT 1 FROM vip_checkins c WHERE c.date_key = d AND c.status='valid') AS has_checkins
       FROM unnest($1::date[]) AS d`,
    [sundays],
  );
  return rows.map((r) => ({
    date: r.date_key,
    recorded: r.has_roster || r.has_headcount || r.has_checkins,
    today: r.date_key === t,
    future: r.date_key > t,
  }));
}
