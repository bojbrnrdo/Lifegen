/** Server-side domain rules, adapted from the supplied tracker. No browser storage. */
import { AsyncLocalStorage } from 'node:async_hooks';
export const domainContext = new AsyncLocalStorage();
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Manila';
const load = () => { const c=domainContext.getStore(); if(!c) throw new Error('Domain operation requires a database transaction'); return c.data; };
const save = () => { domainContext.getStore().dirty = true; };
const nextId = (table) => ++load().seq[table];
const ADMIN = new Proxy({}, {get:(_,k)=>domainContext.getStore()?.actor?.[k] ?? ({id:null,display_name:'Imported / system'})[k]});
const STATUSES = ['first_timer','new_believer','regular','visitor_3','visitor_2','visitor_1','no_returns','member','leader','volunteer','inactive'];
// Promote linked VIP profiles after five distinct Sunday attendances (more than four visits).
export const VIP_MEMBER_ATTENDANCE_THRESHOLD = 5;
const VIP_PROMOTION_STATUSES = new Set(['first_timer','new_believer','regular']);
export const DEFAULT_SETTINGS = {church_name:'Lifegiver Church of Faith',service_name:'Lifegen / 3rd Service',church_address:'',church_contact:'',privacy_contact:'',monthly_prize:'No prize set yet'};
// Helpers (mirror src/lib/util.js)
// ---------------------------------------------------------------------------
class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
const httpError = (s, m, d) => new HttpError(s, m, d);
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => process.env.NODE_ENV === 'test' && process.env.APP_TEST_DATE ? process.env.APP_TEST_DATE : toISO(new Date());
const nowSql = () => new Date().toISOString();
const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T12:00:00').getTime()) && toISO(new Date(s + 'T12:00:00')) === s;
const isSunday = (s) => isValidDate(s) && new Date(s + 'T12:00:00').getDay() === 0;
const clean = (v) => { if (v === undefined || v === null) return null; const s = String(v).trim(); return s === '' ? null : s; };
const quarterOf = (s) => Math.floor((Number(s.slice(5, 7)) - 1) / 3) + 1;
const monthRange = (y, m) => ({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` });
const quarterRange = (y, q) => ({ from: `${y}-${pad((q - 1) * 3 + 1)}-01`, to: monthRange(y, q * 3).to });
const byName = (a, b) => a.last_name.localeCompare(b.last_name, undefined, { sensitivity: 'base' }) || a.first_name.localeCompare(b.first_name, undefined, { sensitivity: 'base' });
const digitsOf = (s) => String(s || '').replace(/\D/g, '');
const round1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
function presentRecordsOf(personId) {
  const d = load();
  return d.records.filter((r) => r.person_id === personId && r.status === 'present').map((r) => ({ ...r, service: d.services.find((s) => s.id === r.service_id) })).filter((r) => r.service);
}
function decorate(p) {
  const pres = presentRecordsOf(p.id);
  return { ...p, sundays_attended: pres.length, last_attended: pres.length ? pres.map((r) => r.service.service_date).sort().at(-1) : null };
}
function findPerson(id) { return load().people.find((p) => p.id === Number(id)); }

/** Sticky promotion: only verified/present attendance counts, and later corrections do not downgrade a Member. */
export function promoteVipMemberIfEligible(personId) {
  const d = load();
  const person = findPerson(personId);
  if (!person || !VIP_PROMOTION_STATUSES.has(person.status)) return false;
  if (!(d.vip_registrations || []).some((registration) => Number(registration.person_id) === person.id)) return false;
  const attendedSundays = new Set(presentRecordsOf(person.id).map((record) => record.service.service_date)).size;
  if (attendedSundays < VIP_MEMBER_ATTENDANCE_THRESHOLD) return false;
  person.status = 'member';
  person.updated_at = nowSql();
  save();
  return true;
}

/** Graduate a VIP to Regular attendee once they complete 4 consecutive Sundays
 *  within the current month. Regular attendees are out of the VIP prize pool;
 *  the later Member promotion (5 distinct Sundays) still applies on top. */
export function promoteVipRegularIfCompleted(personId) {
  const d = load();
  const person = findPerson(personId);
  if (!person || !['first_timer', 'new_believer'].includes(person.status)) return false;
  if (!(d.vip_registrations || []).some((registration) => Number(registration.person_id) === person.id)) return false;
  const t = today(); const monthStart = t.slice(0, 8) + '01';
  const attended = new Set(presentRecordsOf(person.id).map((record) => record.service.service_date).filter((dt) => dt >= monthStart && dt <= t));
  const sundays = d.services.map((x) => x.service_date).filter((dt) => dt >= monthStart && dt <= t).sort();
  let best = 0, run = 0;
  for (const dt of sundays) { if (attended.has(dt)) { run++; if (run > best) best = run; } else run = 0; }
  if (best < 4) return false;
  person.status = 'regular';
  person.updated_at = nowSql();
  save();
  return true;
}

function nextPersonCode(dateRegistered) {
  const year = String(dateRegistered).slice(0, 4);
  const max = load().people.filter((p) => (p.person_code || '').startsWith(`LG-${year}-`)).reduce((m, p) => Math.max(m, Number(p.person_code.slice(8)) || 0), 0);
  return `LG-${year}-${String(max + 1).padStart(4, '0')}`;
}

function validatePerson(body, existing = null) {
  const src = existing ? { ...existing, ...body } : body;
  const data = {
    first_name: clean(src.first_name), last_name: clean(src.last_name) || '', middle_name: clean(src.middle_name), full_name: clean(src.full_name), age: src.age === '' || src.age == null ? null : Number(src.age), ministry: clean(src.ministry), inviter: clean(src.inviter), registration_source: clean(src.registration_source) || existing?.registration_source || 'staff',
    photo: src.photo === undefined ? (existing ? existing.photo : null) : clean(src.photo),
    facebook_url: clean(src.facebook_url), instagram_url: clean(src.instagram_url),
    tiktok_url: clean(src.tiktok_url), x_url: clean(src.x_url), youtube_url: clean(src.youtube_url),
    birthdate: clean(src.birthdate), sex: clean(src.sex), contact_number: clean(src.contact_number), email: clean(src.email),
    address: clean(src.address), school: clean(src.school), course_year: clean(src.course_year), occupation: clean(src.occupation),
    status: clean(src.status) || 'first_timer', date_registered: clean(src.date_registered) || today(),
    date_first_attended: clean(src.date_first_attended), notes: clean(src.notes),
    preferred_area: clean(src.preferred_area), preferred_day: clean(src.preferred_day), preferred_time: clean(src.preferred_time), preferred_category: clean(src.preferred_category),
    privacy_consent_at: body.privacy_consent === undefined ? (existing ? existing.privacy_consent_at || null : null) : (body.privacy_consent ? (existing?.privacy_consent_at || today()) : null),
  };
  if (existing && (body.first_name !== undefined || body.last_name !== undefined || body.middle_name !== undefined) && (body.first_name !== existing.first_name || body.last_name !== existing.last_name || body.middle_name !== existing.middle_name)) data.full_name = [data.first_name,data.middle_name,data.last_name].filter(Boolean).join(' ');
  const errors = [];
  if (data.preferred_day && !LG_DAYS.includes(data.preferred_day)) errors.push('Invalid preferred day.');
  if (data.preferred_time && !LG_TIMES.includes(data.preferred_time)) errors.push('Invalid preferred time.');
  if (!data.first_name) errors.push('First name is required.');
  if (!data.last_name && !data.full_name) errors.push('Last name is required.');
  if (data.contact_number && digitsOf(data.contact_number).length < 7) errors.push('Contact number looks too short.');
  if (data.age !== null && (!Number.isInteger(data.age) || data.age < 1 || data.age > 120)) errors.push('Age must be a whole number from 1 to 120.');
  if (data.sex && !['male', 'female', 'other', 'prefer_not_to_say'].includes(data.sex)) errors.push('Invalid sex value.');
  if (!STATUSES.includes(data.status)) errors.push('Invalid status.');
  if (data.birthdate && !isValidDate(data.birthdate)) errors.push('Birthday must be a valid date.');
  if (!isValidDate(data.date_registered)) errors.push('Date registered must be a valid date.');
  if (data.date_first_attended && !isValidDate(data.date_first_attended)) errors.push('Date first attended must be a valid date.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('Email address looks invalid.');
  const socialHosts = {
    facebook_url: ['facebook.com','fb.com'],
    instagram_url: ['instagram.com'],
    tiktok_url: ['tiktok.com'],
    x_url: ['x.com','twitter.com'],
    youtube_url: ['youtube.com','youtu.be'],
  };
  for(const [key,allowed] of Object.entries(socialHosts)){
    const value=data[key];
    if(!value)continue;
    try {
      const url=new URL(value);
      const host=url.hostname.toLowerCase().replace(/^www\./,'');
      if(url.protocol!=='https:'||!allowed.some(domain=>host===domain||host.endsWith('.'+domain))||
        url.username||url.password||value.length>500)throw new Error('Invalid link');
    }catch{errors.push(key.replace('_url','')+' must be a valid HTTPS profile link.');}
  }
  if (data.photo && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data.photo) || data.photo.length > 400 * 1024)) errors.push('Photo must be an image under 300 KB.');
  if (errors.length) throw httpError(400, errors.join(' '), errors);
  return data;
}

function listPeople(params = {}) {
  const d = load();
  let rows = d.people.map(decorate);
  const q = clean(params.q);
  if (q) {
    const ql = q.toLowerCase(); const dg = digitsOf(q);
    rows = rows.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(ql) || `${p.last_name}, ${p.first_name}`.toLowerCase().includes(ql)
      || `${p.last_name} ${p.first_name}`.toLowerCase().includes(ql) || (p.person_code || '').toLowerCase().includes(ql) || (dg.length >= 3 && digitsOf(p.contact_number).includes(dg)));
  }
  const status = clean(params.status) || 'active';
  if (status === 'archived') rows = rows.filter((p) => p.archived_at);
  else {
    rows = rows.filter((p) => !p.archived_at);
    if (status === 'active') rows = rows.filter((p) => p.status !== 'inactive');
    else if (status !== 'all' && STATUSES.includes(status)) rows = rows.filter((p) => p.status === status);
  }
  if (params.first_timer === '1' || params.first_timer === 1) rows = rows.filter((p) => p.status === 'first_timer');
  const sort = params.sort;
  if (sort === 'recent') rows.sort((a, b) => b.id - a.id);
  else if (sort === 'attendance') rows.sort((a, b) => b.sundays_attended - a.sundays_attended || byName(a, b));
  else if (sort === 'last_attended') rows.sort((a, b) => (a.last_attended ? 0 : 1) - (b.last_attended ? 0 : 1) || String(b.last_attended).localeCompare(String(a.last_attended)) || byName(a, b));
  else rows.sort(byName);
  if (params.paged === 1 || params.paged === '1') {
    const limit = Math.min(Math.max(Number(params.limit) || 1000, 1), 2000); const offset = Math.max(Number(params.offset) || 0, 0);
    return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset, has_more: offset + limit < rows.length };
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Services & statistics (mirror src/services/stats.js)
// ---------------------------------------------------------------------------
function registeredBase(date) {
  return load().people.filter((p) => p.status !== 'inactive' && !p.archived_at && (p.date_first_attended && p.date_first_attended < p.date_registered ? p.date_first_attended : p.date_registered) <= date).length;
}
function summary(s) {
  const recs = load().records.filter((r) => r.service_id === s.id);
  const present = recs.filter((r) => r.status === 'present');
  const base = registeredBase(s.service_date);
  return {
    ...s,
    present_count: present.length,
    first_timer_count: present.filter((r) => r.classification === 'first_timer').length,
    returning_count: present.filter((r) => r.classification === 'returning').length,
    absent_count: recs.filter((r) => r.status === 'absent').length,
    recorded_count: recs.length,
    registered_base: base,
    attendance_rate: base > 0 ? round1((present.length / base) * 100) : null,
  };
}
function summaries({ from, to } = {}) {
  return load().services.filter((s) => (!from || s.service_date >= from) && (!to || s.service_date <= to)).sort((a, b) => a.service_date.localeCompare(b.service_date)).map(summary);
}
function aggregate(rows) {
  const n = rows.length; const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const present = sum('present_count'); const rated = rows.filter((r) => r.attendance_rate !== null);
  return {
    services: n, total_attendance: present, first_timers: sum('first_timer_count'), returning: sum('returning_count'), absent: sum('absent_count'),
    average_attendance: n ? round1(present / n) : 0,
    highest: n ? rows.reduce((a, r) => (r.present_count > a.present_count ? r : a), rows[0]) : null,
    lowest: n ? rows.reduce((a, r) => (r.present_count < a.present_count ? r : a), rows[0]) : null,
    average_rate: rated.length ? round1(rated.reduce((a, r) => a + r.attendance_rate, 0) / rated.length) : null,
  };
}
function monthlyBreakdown(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.service_date.slice(0, 7);
    const m = map.get(key) || { month: key, services: 0, present: 0, first_timers: 0, returning: 0, absent: 0 };
    m.services++; m.present += r.present_count; m.first_timers += r.first_timer_count; m.returning += r.returning_count; m.absent += r.absent_count;
    map.set(key, m);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, average: m.services ? round1(m.present / m.services) : 0 }));
}
function findService(id) { return load().services.find((s) => s.id === Number(id)); }
function attendedBefore(personId, date) {
  const d = load();
  return d.records.some((r) => r.person_id === personId && r.status === 'present' && (d.services.find((s) => s.id === r.service_id)?.service_date || '') < date);
}
function autoClassify(person, date) {
  return attendedBefore(person.id, date) || (person.date_first_attended && person.date_first_attended < date) ? 'returning' : 'first_timer';
}
function roster(service) {
  const d = load();
  return d.people.filter((p) => (p.status !== 'inactive' && !p.archived_at) || d.records.some((r) => r.service_id === service.id && r.person_id === p.id)).sort(byName).map((p) => {
    const r = d.records.find((x) => x.service_id === service.id && x.person_id === p.id);
    const before = attendedBefore(p.id, service.service_date);
    const expected = before || (p.date_first_attended && p.date_first_attended < service.service_date) ? 'returning' : 'first_timer';
    return { ...p, record_id: r?.id || null, att_status: r?.status || null, classification: r?.classification || null, recorded_at: r?.recorded_at || null,
      recorded_by: r ? r.recorded_by_name || 'Imported staff' : null, attended_before: before ? 1 : 0, expected_classification: r?.classification || expected };
  });
}
function rollbackFirstAttended(person, serviceDate) {
  if (person.date_first_attended !== serviceDate) return;
  const dates = presentRecordsOf(person.id).map((r) => r.service.service_date).sort();
  person.date_first_attended = dates[0] || null;
}
function audit(entry) { load().audit.push({ id: nextId('audit'), user_id: ADMIN.id, created_at: nowSql(), user_name: ADMIN.display_name, ...entry }); }

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------
const LG_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LG_TIMES = ['morning', 'afternoon', 'evening'];
const timeBucket = (t) => { if (!t) return null; const h = Number(String(t).slice(0, 2)); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };
function lastSundays(n) {
  const out = []; const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - d.getDay());
  for (let i = 0; i < n; i++) { const c = new Date(d); c.setDate(d.getDate() - i * 7); out.push(toISO(c)); }
  return out.reverse();
}
function demoStatus() { const d = load(); const people = d.people.filter((p) => p.is_demo).length; const services = d.services.filter((s) => s.is_demo).length; return { loaded: people > 0, people, services }; }
function demoLoad() {
  if (demoStatus().loaded) return { ...demoStatus(), message: 'Demo data is already loaded.' };
  const d = load(); const sundays = lastSundays(10);
  const statuses = ['regular', 'regular', 'member', 'member', 'new_believer', 'volunteer', 'first_timer'];
  let seed = 42; const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const people = [];
  for (let i = 1; i <= 24; i++) {
    const joinIdx = Math.min(sundays.length - 1, Math.floor(rand() * rand() * sundays.length));
    const p = { id: nextId('people'), first_name: 'Demo', last_name: `Person ${pad(i)}`, middle_name: null, photo: null, birthdate: null, sex: i % 2 ? 'male' : 'female',
      contact_number: `0900 000 ${pad(i).padStart(4, '0')}`, email: null, address: null, school: i % 3 === 0 ? 'Demo University' : null, course_year: i % 3 === 0 ? `Year ${(i % 4) + 1}` : null, occupation: null,
      status: joinIdx >= sundays.length - 1 ? 'first_timer' : statuses[i % statuses.length], date_registered: sundays[joinIdx], date_first_attended: null,
      notes: 'DEMO DATA — not a real person', is_demo: 1, created_at: nowSql(), updated_at: nowSql() };
    p.person_code = nextPersonCode(p.date_registered);
    d.people.push(p); people.push({ p, joinIdx, faithfulness: 0.45 + rand() * 0.5 });
  }
  sundays.forEach((date, idx) => {
    let s = d.services.find((x) => x.service_date === date);
    if (!s) { s = { id: nextId('services'), service_date: date, service_type: 'lifegen', notes: 'DEMO DATA', is_demo: 1, created_at: nowSql(), updated_at: nowSql() }; d.services.push(s); }
    for (const { p, joinIdx, faithfulness } of people) {
      if (idx < joinIdx) continue;
      const present = idx === joinIdx ? true : rand() < faithfulness;
      d.records.push({ id: nextId('records'), service_id: s.id, person_id: p.id, status: present ? 'present' : 'absent', classification: present ? (idx === joinIdx ? 'first_timer' : 'returning') : null,
        recorded_by: ADMIN.id, recorded_by_name: ADMIN.display_name, source: 'staff', recorded_at: `${date} ${pad(7 + Math.floor(rand() * 3))}:${pad(10 + Math.floor(rand() * 40))}:00`, updated_at: nowSql() });
      if (present && (!p.date_first_attended || p.date_first_attended > date)) p.date_first_attended = date;
    }
  });
  save();
  return { ...demoStatus(), message: 'Demo data loaded.' };
}
function demoRemove() {
  const d = load();
  const demoIds = new Set(d.people.filter((p) => p.is_demo).map((p) => p.id));
  d.records = d.records.filter((r) => !demoIds.has(r.person_id));
  d.audit = d.audit.filter((a) => !a.person_id || !demoIds.has(a.person_id));
  d.services = d.services.filter((s) => !s.is_demo || d.records.some((r) => r.service_id === s.id));
  d.people = d.people.filter((p) => !demoIds.has(p.id));
  save();
  return { ...demoStatus(), message: 'Demo data removed.' };
}
const async_ = fn => (...a) => Promise.resolve().then(() => fn(...a));
export const domain = {
  // people
  people: async_((params) => listPeople(params)),
  person: async_((id) => {
    const p = findPerson(id); if (!p) throw httpError(404, 'Person not found.');
    const d = load();
    const history = d.records.filter((r) => r.person_id === p.id).map((r) => { const s = findService(r.service_id); return { id: r.id, service_id: s.id, service_date: s.service_date, status: r.status, classification: r.classification, recorded_at: r.recorded_at, recorded_by: r.recorded_by_name || 'Imported staff' }; })
      .sort((a, b) => b.service_date.localeCompare(a.service_date));
    const since = p.date_first_attended || p.date_registered;
    const servicesSince = d.services.filter((s) => s.service_date >= since).length;
    const dec = decorate(p);
    return { ...dec, history, services_since: servicesSince, attendance_rate: servicesSince ? round1((dec.sundays_attended / servicesSince) * 100) : null };
  }),
  createPerson: async_((body) => {
    const data = validatePerson(body || {}); const d = load();
    const p = { id: nextId('people'), ...data, is_demo: 0, created_at: nowSql(), updated_at: nowSql() };
    p.person_code = nextPersonCode(p.date_registered);
    d.people.push(p); save();
    return decorate(p);
  }),
  updatePerson: async_((id, body) => {
    const p = findPerson(id); if (!p) throw httpError(404, 'Person not found.');
    Object.assign(p, validatePerson(body || {}, p), { updated_at: nowSql() }); save();
    return decorate(p);
  }),
  duplicates: async_((params = {}) => {
    const first = (clean(params.first_name) || '').toLowerCase(), last = (clean(params.last_name) || '').toLowerCase();
    const dg = digitsOf(clean(params.contact_number) || ''); const email = (clean(params.email) || '').toLowerCase(); const ex = Number(params.exclude_id) || 0;
    const matches = [];
    for (const p of load().people) {
      if (p.id === ex) continue;
      const why = [];
      if (dg.length >= 7 && digitsOf(p.contact_number) === dg) why.push('same contact number');
      if (email && (p.email || '').toLowerCase() === email) why.push('same email');
      if (first && last && p.first_name.toLowerCase() === first && p.last_name.toLowerCase() === last) why.push(params.birthdate && p.birthdate === params.birthdate ? 'same name and birthday' : 'same name');
      if (why.length) matches.push({ id: p.id, person_code: p.person_code, first_name: p.first_name, last_name: p.last_name, status: p.status, archived_at: p.archived_at || null, reasons: why });
    }
    return { matches: matches.slice(0, 10) };
  }),
  archivePerson: async_((id) => { const p = findPerson(id); if (!p) throw httpError(404, 'Person not found.'); if (!p.archived_at) { p.archived_at = nowSql(); p.updated_at = nowSql(); save(); } return decorate(p); }),
  restorePerson: async_((id) => { const p = findPerson(id); if (!p) throw httpError(404, 'Person not found.'); if (p.archived_at) { p.archived_at = null; p.updated_at = nowSql(); save(); } return decorate(p); }),
  activity: async_(() => []),
  setPersonStatus: async_((id, status) => {
    const p = findPerson(id); if (!p) throw httpError(404, 'Person not found.');
    if (!STATUSES.includes(status)) throw httpError(400, 'Invalid status.');
    p.status = status; p.updated_at = nowSql(); save();
    return decorate(p);
  }),
  deletePerson: async_((id) => {
    if (!findPerson(id)) throw httpError(404, 'Person not found.');
    // Hard deletion cascades attendance, memberships and VIP history in PostgreSQL.
    // Archive is reversible and preserves the related history.
    throw httpError(409, 'Permanent deletion is disabled to protect attendance and membership history. Archive the person instead.');
  }),

  // services / attendance
  openService: async_((service_date) => {
    if (!isSunday(service_date)) throw httpError(400, 'Lifegen attendance is Sunday only — please choose a Sunday.');
    if (service_date > today()) throw httpError(400, 'Future Sundays cannot be recorded yet.');
    const d = load(); let s = d.services.find((x) => x.service_date === service_date);
    if (!s) { s = { id: nextId('services'), service_date, service_type: 'lifegen', notes: null, is_demo: 0, created_at: nowSql(), updated_at: nowSql() }; d.services.push(s); save(); }
    return summary(s);
  }),
  mark: async_((serviceId, personId, status, classification) => {
    const s = findService(serviceId); if (!s) throw httpError(404, 'Service not found.');
    const p = findPerson(personId); if (!p) throw httpError(404, 'Person not found.');
    if (!['present', 'absent'].includes(status)) throw httpError(400, 'Status must be present or absent.');
    if (classification && !['first_timer', 'returning'].includes(classification)) throw httpError(400, 'Invalid classification.');
    const d = load();
    let r = d.records.find((x) => x.service_id === s.id && x.person_id === p.id);
    const old = r ? { ...r } : null;
    if (status === 'present') classification = classification || old?.classification || autoClassify(p, s.service_date); else classification = null;
    if (r && r.status === status && (r.classification || null) === (classification || null)) {
      if (status === 'present') { promoteVipRegularIfCompleted(p.id); promoteVipMemberIfEligible(p.id); }
      return { record: { ...r, recorded_by_name: ADMIN.display_name }, summary: summary(s), already_marked: true };
    }
    if (r) Object.assign(r, { status, classification, recorded_by: ADMIN.id, recorded_by_name: ADMIN.display_name, source: 'staff', updated_at: nowSql() });
    else { r = { id: nextId('records'), service_id: s.id, person_id: p.id, status, classification, recorded_by: ADMIN.id, recorded_by_name: ADMIN.display_name, source: 'staff', recorded_at: nowSql(), updated_at: nowSql() }; d.records.push(r); }
    audit({ service_id: s.id, person_id: p.id, action: old ? 'update' : 'mark', old_status: old?.status || null, new_status: status, old_classification: old?.classification || null, new_classification: classification });
    if (status === 'present') { if (!p.date_first_attended || p.date_first_attended > s.service_date) p.date_first_attended = s.service_date; promoteVipRegularIfCompleted(p.id); promoteVipMemberIfEligible(p.id); }
    else if (old?.status === 'present') rollbackFirstAttended(p, s.service_date);
    save();
    return { record: { ...r, recorded_by_name: ADMIN.display_name }, summary: summary(s), already_marked: false };
  }),
  undoMark: async_((serviceId, personId) => {
    const d = load(); const r = d.records.find((x) => x.service_id === Number(serviceId) && x.person_id === Number(personId));
    if (!r) throw httpError(404, 'No attendance record to undo.');
    d.records = d.records.filter((x) => x !== r);
    audit({ service_id: r.service_id, person_id: r.person_id, action: 'undo', old_status: r.status, new_status: null, old_classification: r.classification, new_classification: null });
    if (r.status === 'present') rollbackFirstAttended(findPerson(r.person_id), findService(r.service_id).service_date);
    save();
    return { summary: summary(findService(serviceId)) };
  }),

  // dashboard / reports
  search: async_((q, extra = {}) => { q = clean(q); if (!q || q.length < 2) return { people: [] }; const sex = ['male', 'female'].includes(extra.sex) ? extra.sex : null; return { people: listPeople({ q, status: 'all' }).filter((p) => !p.archived_at && (!sex || p.sex === sex)).sort((a, b) => (a.status === 'inactive') - (b.status === 'inactive') || byName(a, b)).slice(0, 12) }; }),

  saveSettings: async_((data) => { const d = load(); for (const k of ['church_name', 'service_name', 'church_address', 'church_contact', 'privacy_contact']) if (data?.[k] !== undefined) { const v = clean(data[k]) || ''; if (!v && (k === 'church_name' || k === 'service_name')) throw httpError(400, `${k.replace('_', ' ')} cannot be empty.`); if (v.length > 300) throw httpError(400, `${k.replace('_', ' ')} is too long (max 300 characters).`); d.settings[k] = v; } save(); return { ...d.settings }; }),
  demoStatus: async_(demoStatus), demoLoad: async_(demoLoad), demoRemove: async_(demoRemove),
  snapshot: async_(() => structuredClone(load())),
};
export { httpError, today, nowSql, isValidDate, isSunday, monthRange, fullNameSafe };
function fullNameSafe(p) { return p.full_name || [p.first_name,p.last_name].filter(Boolean).join(' '); }
