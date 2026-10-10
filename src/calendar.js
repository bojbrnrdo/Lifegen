// LIFEGEN events calendar: pure helpers + database access.
// All event times are naive Asia/Manila wall-clock times ("HH:MM"), matching the rest of the app.
import { query, allocateId } from './db.js';
import { today, httpError } from './domain.js';

export const EVENT_CATEGORIES = ['service', 'worship', 'prayer', 'youth', 'lifegroup', 'outreach', 'special'];
export const CATEGORY_LABELS = {
  service: 'Sunday service', worship: 'Worship night', prayer: 'Prayer gathering',
  youth: 'Youth', lifegroup: 'Lifegroup', outreach: 'Outreach', special: 'Special event',
};
export const SUNDAY_SERVICE = { title: 'LIFEGEN Sunday Service', description: 'Weekly Sunday service — everyone is welcome. Stay afterwards, we would love to meet you.', start_time: '13:00', end_time: '15:00', location: 'Lifegiver Church of Faith — Central', category: 'service' };
const pad = (n) => String(n).padStart(2, '0');
const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T12:00:00').getTime()) && `${new Date(s + 'T12:00:00').getFullYear()}-${pad(new Date(s + 'T12:00:00').getMonth() + 1)}-${pad(new Date(s + 'T12:00:00').getDate())}` === s;
const isValidTime = (s) => s === null || (/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s));

// ---------------------------------------------------------------------------
// Shapes and merging (pure — covered by tests/calendar.test.mjs)
// ---------------------------------------------------------------------------
// Public shape of one event. `date` is ISO, times are "HH:MM" or null (all day).
export function publicShape(e) {
  const recurring = Boolean(e.recurring);
  return {
    id: String(e.id), title: e.title, description: e.description || '', location: e.location || '',
    category: e.category, date: e.event_date || e.date, start_time: e.all_day ? null : (e.start_time || null),
    end_time: e.all_day ? null : (e.end_time || null), all_day: Boolean(e.all_day),
    recurring, published: e.is_published === undefined ? true : Boolean(e.is_published),
    label: recurring ? 'Every Sunday' : (CATEGORY_LABELS[e.category] || 'Event'),
  };
}
export const byStart = (a, b) => a.date.localeCompare(b.date) || String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')) || String(a.title).localeCompare(String(b.title));
export const weeklySundayShape = (date) => publicShape({ id: `sun-${date}`, event_date: date, recurring: true, is_published: true, ...SUNDAY_SERVICE });

// Merge shaped stored events with the built-in weekly Sunday service. A stored,
// published 'service' event takes over that date so nothing is duplicated.
export function mergeWithWeeklySundays(events, from, to) {
  const serviceDates = new Set(events.filter((e) => e.category === 'service').map((e) => e.date));
  const weekly = sundaysInRange(from, to).filter((date) => !serviceDates.has(date)).map(weeklySundayShape);
  return [...events, ...weekly].sort(byStart);
}

// Every Sunday (ISO date) with from<=date<to. Ranges are [from,to) ISO dates.
export function sundaysInRange(from, to) {
  const out = [];
  const d = new Date(from + 'T12:00:00');
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // next Sunday (or same day)
  while (d.toISOString().slice(0, 10) < to) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 7); }
  return out;
}

// Validate admin input -> normalized fields. Throws HttpError with a clear message.
export function validateEventInput(input = {}) {
  const title = String(input.title ?? '').trim().replace(/\s+/g, ' ');
  const description = String(input.description ?? '').trim();
  const location = String(input.location ?? '').trim();
  const category = String(input.category ?? 'special').trim();
  const event_date = String(input.date ?? '').trim();
  const all_day = input.all_day === true;
  const start_time = all_day ? null : String(input.start_time ?? '').trim() || null;
  const end_time = all_day ? null : String(input.end_time ?? '').trim() || null;
  const is_published = input.is_published !== false;
  if (title.length < 2 || title.length > 200) throw httpError(400, 'Give the event a title between 2 and 200 characters.');
  if (description.length > 2000) throw httpError(400, 'Keep the description within 2000 characters.');
  if (location.length > 200) throw httpError(400, 'Keep the location within 200 characters.');
  if (!EVENT_CATEGORIES.includes(category)) throw httpError(400, 'Choose a valid event category.');
  if (!isValidDate(event_date)) throw httpError(400, 'Enter a valid event date (YYYY-MM-DD).');
  if (!isValidTime(start_time) || !isValidTime(end_time)) throw httpError(400, 'Times must use 24-hour HH:MM format.');
  if (start_time && end_time && end_time <= start_time) throw httpError(400, 'The end time must be after the start time.');
  return { title, description: description || null, location: location || null, category, event_date, start_time, end_time, all_day, is_published };
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------
const MAX_RANGE_DAYS = 400;
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Published (or all, for admins) stored events for an ISO date range [from,to).
export async function storedEvents(from, to, { includeDrafts = false } = {}) {
  const { rows } = await query(
    `SELECT id,title,description,location,category,event_date::text AS event_date,
            to_char(start_time,'HH24:MI') AS start_time,to_char(end_time,'HH24:MI') AS end_time,
            all_day,is_published FROM calendar_events
       WHERE event_date>=$1::date AND event_date<$2::date ${includeDrafts ? '' : 'AND is_published=true'}
       ORDER BY event_date,start_time NULLS FIRST,title`,
    [from, to],
  );
  return rows;
}

const defaultFrom = () => `${today().slice(0, 7)}-01`;
const defaultTo = (from) => addDays(`${from.slice(0, 7)}-01`, 62); // this month + the next
const clampRange = (fromArg, toArg) => {
  const from = isValidDate(fromArg) ? fromArg : defaultFrom();
  let to = isValidDate(toArg) && toArg > from ? toArg : defaultTo(from);
  if (to > addDays(from, MAX_RANGE_DAYS)) to = addDays(from, MAX_RANGE_DAYS);
  return [from, to];
};

// Public calendar payload for the website: validated range, stored + weekly events.
export async function publicCalendar(fromArg, toArg) {
  const [from, to] = clampRange(fromArg, toArg);
  const events = mergeWithWeeklySundays((await storedEvents(from, to)).map(publicShape), from, to);
  return { from, to, today: today(), events };
}

// Upcoming published events starting today (weekly Sundays included), for sidebars and ICS.
export async function upcomingEvents(days = 90, limit = 12) {
  const base = today();
  const end = addDays(base, Math.min(Math.max(Number(days) || 90, 1), MAX_RANGE_DAYS));
  return mergeWithWeeklySundays((await storedEvents(base, end)).map(publicShape), base, end).slice(0, Math.max(1, Math.min(Number(limit) || 12, 60)));
}

// ---------------------------------------------------------------------------
// ICS export (RFC 5545). Manila has no daylight saving: UTC = wall clock − 8h.
// ---------------------------------------------------------------------------
const padIcs = (n) => String(n).padStart(2, '0');
export function manilaToUtcStamp(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = String(time || '00:00').split(':').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, hh - 8, mm));
  return `${utc.getUTCFullYear()}${padIcs(utc.getUTCMonth() + 1)}${padIcs(utc.getUTCDate())}T${padIcs(utc.getUTCHours())}${padIcs(utc.getUTCMinutes())}00Z`;
}
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsFold = (line) => {
  // Fold lines longer than 75 octets with a leading space, per RFC 5545 §3.1.
  let out = '', chunk = '';
  for (const ch of line) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 73) { out += (out ? '\r\n ' : '') + chunk; chunk = ch; } else chunk += ch;
  }
  return out + (out ? '\r\n ' : '') + chunk;
};
function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const total = (h * 60 + m + minutes) % 1440;
  return `${padIcs(Math.floor(total / 60))}:${padIcs(total % 60)}`;
}
export function eventToIcs(e, stamp) {
  const uid = e.recurring ? `${e.id}@lifegen` : `event-${e.id}@lifegen`;
  const start = e.all_day ? e.date.replaceAll('-', '') : manilaToUtcStamp(e.date, e.start_time || '00:00');
  const end = e.all_day ? manilaToUtcStamp(addDays(e.date, 1), '00:00').slice(0, 8) : manilaToUtcStamp(e.date, e.end_time || addMinutes(e.start_time || '00:00', 60));
  const lines = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART${e.all_day ? ';VALUE=DATE' : ''}:${start}`, `DTEND${e.all_day ? ';VALUE=DATE' : ''}:${end}`];
  if (e.recurring) lines.push('RRULE:FREQ=WEEKLY;BYDAY=SU');
  lines.push(`SUMMARY:${icsEsc(e.title)}`);
  if (e.location) lines.push(`LOCATION:${icsEsc(e.location)}`);
  const desc = `${e.description ? `${e.description}\n` : ''}${e.recurring ? 'Weekly LIFEGEN Sunday service (1–3 PM Asia/Manila).' : `Category: ${CATEGORY_LABELS[e.category] || 'Event'}. Times are Asia/Manila.`}`;
  if (desc.trim()) lines.push(`DESCRIPTION:${icsEsc(desc.trim())}`);
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(`${e.title} starts in one hour.`)}`, 'END:VALARM', 'END:VEVENT');
  return lines.map(icsFold).join('\r\n');
}
export function calendarToIcs(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LIFEGEN//Events calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:LIFEGEN Events', 'X-WR-TIMEZONE:Asia/Manila', ...events.map((e) => eventToIcs(e, stamp)), 'END:VCALENDAR', ''].join('\r\n');
}

// ---------------------------------------------------------------------------
// Admin operations (run inside a transaction by the caller)
// ---------------------------------------------------------------------------
export async function insertEvent(client, fields, actorId) {
  const id = await allocateId(client, 'calendar_events');
  const { rows } = await client.query(
    `INSERT INTO calendar_events(id,title,description,location,category,event_date,start_time,end_time,all_day,is_published,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [id, fields.title, fields.description, fields.location, fields.category, fields.event_date, fields.start_time, fields.end_time, fields.all_day, fields.is_published, actorId],
  );
  return rows[0];
}
export async function updateEvent(client, id, fields) {
  const { rows } = await client.query(
    `UPDATE calendar_events SET title=$2,description=$3,location=$4,category=$5,event_date=$6,start_time=$7,end_time=$8,all_day=$9,is_published=$10,updated_at=now()
      WHERE id=$1 RETURNING *`,
    [id, fields.title, fields.description, fields.location, fields.category, fields.event_date, fields.start_time, fields.end_time, fields.all_day, fields.is_published],
  );
  return rows[0] || null;
}
export const getEvent = async (id) => (await query('SELECT * FROM calendar_events WHERE id=$1', [id])).rows[0] || null;
