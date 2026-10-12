import { query, transaction, runDomain, logAction } from './db.js';
import { isSunday, today, httpError } from './domain.js';
import { serviceSummaries } from './read-model.js';

const num = (v) => Number(v || 0);
const isoDate = (v) => {
  const value = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const idOf = (v, label = 'record ID') => {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, `Invalid ${label}.`);
  return id;
};
const permissions = (actor) => new Set(actor?.permissions || []);

function lockState(date, actor) {
  const live = date === today() && isSunday(date);
  const canCorrect = permissions(actor).has('attendance:correct');
  return {
    enabled: true,
    live,
    can_correct: canCorrect,
    church_date: today(),
    message: live ? '' : canCorrect
      ? `Correction mode — ${date} is not today's Sunday; explain every change so it is recorded in the audit log.`
      : `Attendance can only be marked on the Sunday itself (church date: ${today()}). An Admin can correct past Sundays.`,
  };
}

function validateSunday(value) {
  const date = String(value || '').trim();
  if (!isoDate(date) || !isSunday(date)) throw httpError(400, 'Lifegen attendance is Sunday only — please choose a valid Sunday.');
  if (date > today()) throw httpError(400, 'Future Sundays cannot be recorded yet.');
  return date;
}

async function assertEditable(serviceId, actor, reasonValue) {
  const row = (await query('SELECT service_date::text AS service_date FROM services WHERE id=$1', [serviceId])).rows[0];
  if (!row) throw httpError(404, 'Service not found.');
  const lock = lockState(row.service_date, actor);
  if (!lock.live && !lock.can_correct) throw httpError(403, lock.message);
  const reason = String(reasonValue || '').trim();
  if (!lock.live && !reason) throw httpError(400, 'Give a reason for this correction.');
  return { date: row.service_date, correction: !lock.live, reason: reason.slice(0, 200) };
}

export async function listServices(filters = {}) {
  const from = filters.from || (filters.year ? `${filters.year}-01-01` : null);
  const to = filters.to || (filters.year ? `${filters.year}-12-31` : null);
  const rows = await serviceSummaries({ from, to });
  const limit = Math.max(1, Math.min(Number(filters.limit) || 500, 2000));
  return rows.slice(-limit).reverse();
}

export async function serviceByDate(value, actor) {
  const date = String(value || '').trim();
  if (!isoDate(date) || !isSunday(date)) throw httpError(400, 'Lifegen attendance is Sunday only — please choose a valid Sunday.');
  const lock = lockState(date, actor);
  const row = (await query('SELECT id FROM services WHERE service_date=$1 AND service_type=$2', [date, 'lifegen'])).rows[0];
  if (!row) return { exists: false, service_date: date, lock };
  return { exists: true, service: await serviceDetail(row.id), lock };
}

export async function serviceDetail(value) {
  const id = idOf(value, 'service ID');
  const service = (await serviceSummaries({}, id))[0];
  if (!service) throw httpError(404, 'Service not found.');
  const { rows } = await query(`SELECT p.id,p.person_code,p.first_name,p.last_name,p.photo,p.sex,p.status,
      p.contact_number,p.date_first_attended::text AS date_first_attended,p.date_registered::text AS date_registered,
      p.is_demo,r.id AS record_id,r.status AS att_status,r.classification,r.recorded_at,
      coalesce(u.display_name,r.recorded_by_name) AS recorded_by,
      EXISTS(SELECT 1 FROM records before_r JOIN services before_s ON before_s.id=before_r.service_id
        WHERE before_r.person_id=p.id AND before_r.status='present' AND before_s.service_date<s.service_date) AS attended_before,
      coalesce(stats.sundays_attended,0)::int AS sundays_attended,stats.last_attended::text AS last_attended
    FROM services s CROSS JOIN people p
    LEFT JOIN records r ON r.service_id=s.id AND r.person_id=p.id
    LEFT JOIN staff_users u ON u.id=r.recorded_by
    LEFT JOIN LATERAL (SELECT count(*)::int AS sundays_attended,max(ss.service_date) AS last_attended
      FROM records rr JOIN services ss ON ss.id=rr.service_id
      WHERE rr.person_id=p.id AND rr.status='present') stats ON true
    WHERE s.id=$1 AND ((p.status<>'inactive' AND p.archived_at IS NULL) OR r.id IS NOT NULL)
    ORDER BY lower(p.last_name),lower(p.first_name),p.id`, [id]);
  const roster = rows.map((p) => ({
    ...p,
    id: Number(p.id),
    record_id: p.record_id == null ? null : Number(p.record_id),
    att_status: p.att_status || null,
    expected_classification: p.classification || (p.attended_before || (p.date_first_attended && p.date_first_attended < service.service_date) ? 'returning' : 'first_timer'),
  }));
  return { ...service, roster };
}

export async function serviceAudit(value) {
  const id = idOf(value, 'service ID');
  return (await query(`SELECT a.id,a.service_id,a.person_id,a.action,a.old_status,a.new_status,
      a.old_classification,a.new_classification,a.created_at,
      coalesce(u.display_name,a.user_name) AS user_name,p.first_name,p.last_name,p.person_code
    FROM audit a LEFT JOIN staff_users u ON u.id=a.user_id LEFT JOIN people p ON p.id=a.person_id
    WHERE a.service_id=$1 ORDER BY a.id DESC LIMIT 200`, [id])).rows;
}

export async function openService(value, actor) {
  const date = validateSunday(value);
  const lock = lockState(date, actor);
  if (!lock.live && !lock.can_correct) throw httpError(403, lock.message);
  return runDomain('openService', [date], actor, true);
}

export async function markAttendance(value, personValue, status, classification, reasonValue, actor) {
  const serviceId = idOf(value, 'service ID'), personId = idOf(personValue, 'person ID');
  const edit = await assertEditable(serviceId, actor, reasonValue);
  const result = await runDomain('mark', [serviceId, personId, status, classification], actor, true);
  if (edit.correction) await transaction((client) => logAction(client, actor, 'records', result.record?.id || `${serviceId}:${personId}`, 'attendance_correction', {
    service_id: serviceId, person_id: personId, reason: edit.reason, status, classification: classification || null,
  }));
  return result;
}

export async function undoAttendance(value, personValue, reasonValue, actor) {
  const serviceId = idOf(value, 'service ID'), personId = idOf(personValue, 'person ID');
  const edit = await assertEditable(serviceId, actor, reasonValue);
  const result = await runDomain('undoMark', [serviceId, personId], actor, true);
  if (edit.correction) await transaction((client) => logAction(client, actor, 'records', `${serviceId}:${personId}`, 'attendance_correction_undo', {
    service_id: serviceId, person_id: personId, reason: edit.reason,
  }));
  return result;
}

export async function updateService(value, body = {}, actor) {
  const id = idOf(value, 'service ID');
  const notes = String(body.notes || '').trim();
  if (notes.length > 2000) throw httpError(400, 'Notes are too long (maximum 2,000 characters).');
  await transaction(async (client) => {
    const row = (await client.query('UPDATE services SET notes=$1,updated_at=now() WHERE id=$2 RETURNING id', [notes || null, id])).rows[0];
    if (!row) throw httpError(404, 'Service not found.');
    await logAction(client, actor, 'services', id, 'update_notes');
  });
  return (await serviceSummaries({}, id))[0];
}

export async function reportYears() {
  const { rows } = await query('SELECT DISTINCT extract(year FROM service_date)::int AS year FROM services ORDER BY year DESC');
  const years = rows.map((r) => Number(r.year));
  if (!years.length) years.push(Number(today().slice(0, 4)));
  return years;
}

function monthRange(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [from, `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`];
}

export function resolveReportRange(params = {}) {
  const year = Number(params.year) || null;
  const month = Number(params.month) || null;
  const quarter = Number(params.quarter) || null;
  let from = params.from || null, to = params.to || null, label = '';
  if (year && month) {
    if (month < 1 || month > 12) throw httpError(400, 'Invalid report month.');
    [from, to] = monthRange(year, month);
    label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } else if (year && quarter) {
    if (quarter < 1 || quarter > 4) throw httpError(400, 'Invalid report quarter.');
    const startMonth = (quarter - 1) * 3 + 1;
    [from] = monthRange(year, startMonth);
    [, to] = monthRange(year, startMonth + 2);
    label = `Q${quarter} ${year}`;
  } else if (year && !from && !to) {
    from = `${year}-01-01`; to = `${year}-12-31`; label = String(year);
  }
  if (!from && !to) {
    const now = today();
    const [start] = monthRange(Number(now.slice(0, 4)), Number(now.slice(5, 7)));
    from = start; to = now;
  } else {
    from ||= '1900-01-01'; to ||= today();
  }
  if (!isoDate(from) || !isoDate(to) || from > to) throw httpError(400, 'Choose a valid report date range.');
  if (!label) {
    if (from === to) label = new Date(`${from}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    else if (from.slice(0, 7) === to.slice(0, 7)) label = new Date(`${from}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    else label = `${from} – ${to}`;
  }
  return { from, to, label };
}

function monthRows(rows) {
  const byMonth = new Map();
  for (const row of rows) {
    const month = String(row.service_date).slice(0, 7);
    const item = byMonth.get(month) || { month, services: 0, present: 0, first_timers: 0, returning: 0, absent: 0 };
    item.services++;
    item.present += num(row.present_count);
    item.first_timers += num(row.first_timer_count);
    item.returning += num(row.returning_count);
    item.absent += num(row.absent_count);
    byMonth.set(month, item);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, average: m.services ? Math.round(m.present / m.services * 10) / 10 : 0 }));
}

async function reportSummaryData(params = {}) {
  const range = resolveReportRange(params);
  const weekly = await serviceSummaries(range);
  const values = (key) => weekly.reduce((sum, row) => sum + num(row[key]), 0);
  const rated = weekly.filter((row) => row.attendance_rate != null);
  const totals = {
    services: weekly.length,
    total_attendance: values('present_count'),
    average_attendance: weekly.length ? Math.round(values('present_count') / weekly.length * 10) / 10 : 0,
    first_timers: values('first_timer_count'),
    returning: values('returning_count'),
    absent: values('absent_count'),
    average_rate: rated.length ? Math.round(rated.reduce((sum, row) => sum + Number(row.attendance_rate), 0) / rated.length * 10) / 10 : null,
    highest: weekly.length ? weekly.reduce((best, row) => row.present_count > best.present_count ? row : best, weekly[0]) : null,
    lowest: weekly.length ? weekly.reduce((best, row) => row.present_count < best.present_count ? row : best, weekly[0]) : null,
  };
  const [unique, registrations] = await Promise.all([
    query(`SELECT count(DISTINCT r.person_id)::int AS n FROM records r JOIN services s ON s.id=r.service_id
      WHERE r.status='present' AND s.service_date BETWEEN $1::date AND $2::date`, [range.from, range.to]),
    query('SELECT count(*)::int AS n FROM people WHERE date_registered BETWEEN $1::date AND $2::date', [range.from, range.to]),
  ]);
  totals.unique_attendees = num(unique.rows[0]?.n);
  totals.new_registrations = num(registrations.rows[0]?.n);
  return { range, totals, weekly, monthly: monthRows(weekly) };
}

export async function reportSummary(params = {}) { return reportSummaryData(params); }

const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const csv = (headers, rows) => `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

export async function exportAttendanceCsv(type, params = {}) {
  const report = await reportSummaryData(params);
  if (type === 'weekly') return csv(['Sunday', 'Present', 'First timers', 'Returning', 'Absent', 'Registered base', 'Rate %'], report.weekly.map((r) => [r.service_date, r.present_count, r.first_timer_count, r.returning_count, r.absent_count, r.registered_base, r.attendance_rate]));
  if (type === 'monthly') return csv(['Month', 'Sundays', 'Present', 'Average', 'First timers', 'Returning', 'Absent'], report.monthly.map((r) => [r.month, r.services, r.present, r.average, r.first_timers, r.returning, r.absent]));
  if (type === 'detail') {
    const { rows } = await query(`SELECT s.service_date::text AS service_date,p.person_code,p.first_name,p.last_name,r.status,r.classification
      FROM records r JOIN services s ON s.id=r.service_id JOIN people p ON p.id=r.person_id
      WHERE s.service_date BETWEEN $1::date AND $2::date ORDER BY s.service_date,lower(p.last_name),lower(p.first_name)`, [report.range.from, report.range.to]);
    return csv(['Sunday', 'Person ID', 'First name', 'Last name', 'Attendance', 'Classification'], rows.map((r) => [r.service_date, r.person_code, r.first_name, r.last_name, r.status, r.classification]));
  }
  throw httpError(404, 'Unknown attendance export.');
}
