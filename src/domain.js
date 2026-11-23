/** Server-side domain rules, adapted from the supplied tracker. No browser storage. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { sundaysBetween } from './vip-attendance.js';
export const domainContext = new AsyncLocalStorage();
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Manila';
const load = () => { const c=domainContext.getStore(); if(!c) throw new Error('Domain operation requires a database transaction'); return c.data; };
const save = () => { domainContext.getStore().dirty = true; };
const nextId = (table) => ++load().seq[table];
const ADMIN = new Proxy({}, {get:(_,k)=>domainContext.getStore()?.actor?.[k] ?? ({id:null,display_name:'Imported / system'})[k]});
// Keep write validation aligned with database/001_init.sql. The visitor outcome
// labels that appeared in an older import format remain readable for legacy
// display/filter compatibility, but cannot be written as current statuses.
const STATUSES = ['first_timer','new_believer','regular','member','leader','volunteer','inactive'];
const LEGACY_DISPLAY_STATUSES = ['visitor_3','visitor_2','visitor_1','no_returns'];
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
// Attendance is tracked only for VIPs and first timers, and the check-in is the
// record. There is no general Sunday roster any more, so "attended" means a
// validated vip_checkins row. See src/vip-attendance.js for the SQL definition.
function attendedSundaysOf(personId) {
  const d = load();
  const regs = new Set((d.vip_registrations || []).filter((r) => Number(r.person_id) === Number(personId)).map((r) => Number(r.id)));
  return [...new Set((d.vip_checkins || [])
    .filter((c) => regs.has(Number(c.registration_id)) && c.status === 'valid')
    .map((c) => c.date_key))].sort();
}
function decorate(p) {
  const dates = attendedSundaysOf(p.id);
  return { ...p, sundays_attended: dates.length, last_attended: dates.at(-1) || null };
}
function findPerson(id) { return load().people.find((p) => p.id === Number(id)); }

/** Sticky promotion: only verified/present attendance counts, and later corrections do not downgrade a Member. */
export function promoteVipMemberIfEligible(personId) {
  const d = load();
  const person = findPerson(personId);
  if (!person || !VIP_PROMOTION_STATUSES.has(person.status)) return false;
  if (!(d.vip_registrations || []).some((registration) => Number(registration.person_id) === person.id)) return false;
  const attendedSundays = attendedSundaysOf(person.id).length;
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
  const attended = new Set(attendedSundaysOf(person.id).filter((dt) => dt >= monthStart && dt <= t));
  const sundays = sundaysBetween(monthStart, t);
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
    else if (status !== 'all' && (STATUSES.includes(status) || LEGACY_DISPLAY_STATUSES.includes(status))) rows = rows.filter((p) => p.status === status);
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
function demoStatus() { const d = load(); const people = d.people.filter((p) => p.is_demo).length; return { loaded: people > 0, people, services: 0 }; }
function demoLoad() {
  if (demoStatus().loaded) return { ...demoStatus(), message: 'Demo data is already loaded.' };
  const d = load(); const sundays = lastSundays(10);
  const statuses = ['regular', 'regular', 'member', 'member', 'new_believer', 'volunteer', 'first_timer'];
  let seed = 42; const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const created = [];
  for (let i = 1; i <= 24; i++) {
    const joinIdx = Math.min(sundays.length - 1, Math.floor(rand() * rand() * sundays.length));
    const p = { id: nextId('people'), first_name: 'Demo', last_name: `Person ${pad(i)}`, middle_name: null, photo: null, birthdate: null, sex: i % 2 ? 'male' : 'female',
      contact_number: `0900 000 ${pad(i).padStart(4, '0')}`, email: null, address: null, school: i % 3 === 0 ? 'Demo University' : null, course_year: i % 3 === 0 ? `Year ${(i % 4) + 1}` : null, occupation: null,
      status: joinIdx >= sundays.length - 1 ? 'first_timer' : statuses[i % statuses.length], date_registered: sundays[joinIdx], date_first_attended: null,
      notes: 'DEMO DATA — not a real person', is_demo: 1, created_at: nowSql(), updated_at: nowSql() };
    p.person_code = nextPersonCode(p.date_registered);
    d.people.push(p); created.push({ p, joinIdx });
  }
  // Attendance is only tracked for VIPs, so demo attendance is demo check-ins:
  // each demo person gets a VIP registration and one validated check-in per
  // Sunday they were "present" from their joining Sunday onwards.
  d.vip_registrations = d.vip_registrations || [];
  d.vip_checkins = d.vip_checkins || [];
  for (const { p, joinIdx } of created) {
    const reg = { id: (d.seq.vip_registrations = (d.seq.vip_registrations || 0) + 1), person_id: p.id, review_status: 'reviewed', created_at: nowSql() };
    d.vip_registrations.push(reg);
    for (let idx = joinIdx; idx < sundays.length; idx++) {
      p.date_first_attended = p.date_first_attended || sundays[joinIdx];
      d.vip_checkins.push({ id: (d.seq.vip_checkins = (d.seq.vip_checkins || 0) + 1), registration_id: reg.id, date_key: sundays[idx], status: 'valid', validated_at: nowSql(), created_at: nowSql() });
    }
  }
  save();
  return { ...demoStatus(), message: 'Demo data loaded.' };
}
function demoRemove() {
  const d = load();
  const demoIds = new Set(d.people.filter((p) => p.is_demo).map((p) => p.id));
  const demoRegs = new Set((d.vip_registrations || []).filter((r) => demoIds.has(Number(r.person_id))).map((r) => Number(r.id)));
  d.vip_checkins = (d.vip_checkins || []).filter((c) => !demoRegs.has(Number(c.registration_id)));
  d.vip_registrations = (d.vip_registrations || []).filter((r) => !demoIds.has(Number(r.person_id)));
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
    // Attendance history exists only for VIPs: one entry per validated check-in.
    const regs = new Set((d.vip_registrations || []).filter((r) => Number(r.person_id) === p.id).map((r) => Number(r.id)));
    const history = (d.vip_checkins || []).filter((c) => regs.has(Number(c.registration_id)) && c.status === 'valid')
      .map((c) => ({ id: c.id, date_key: c.date_key, service_date: c.date_key, status: 'present', classification: null, recorded_at: c.validated_at || c.created_at, recorded_by: null }))
      .sort((a, b) => b.service_date.localeCompare(a.service_date));
    const dec = decorate(p);
    return { ...dec, history, services_since: history.length, attendance_rate: null };
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
    if (p.archived_at) throw httpError(409, 'Restore the archived person before editing.');
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
  archivePerson: async_((id) => {
    const p = findPerson(id);
    if (!p) throw httpError(404, 'Person not found.');
    if (!p.archived_at) {
      const d = load();
      const leadsNetwork = d.networks.some(n => Number(n.leader_person_id) === p.id && Boolean(n.is_active));
      const leadsCell = d.lifegroups.some(g => Number(g.leader_person_id) === p.id && Boolean(g.is_active));
      if (leadsNetwork || leadsCell)
        throw httpError(409, 'Reassign or deactivate active Network and Cell leadership before archiving this person.');
      p.archived_at = nowSql();
      p.updated_at = nowSql();
      save();
    }
    return decorate(p);
  }),
  restorePerson: async_((id) => { const p = findPerson(id); if (!p) throw httpError(404, 'Person not found.'); if (p.archived_at) { p.archived_at = null; p.updated_at = nowSql(); save(); } return decorate(p); }),
  activity: async_(() => []),
  setPersonStatus: async_((id, status) => {
    const p = findPerson(id); if (!p) throw httpError(404, 'Person not found.');
    if (p.archived_at) throw httpError(409, 'Restore the archived person before changing status.');
    if (!STATUSES.includes(status)) throw httpError(400, 'Invalid status.');
    p.status = status; p.updated_at = nowSql(); save();
    return decorate(p);
  }),
  deletePerson: async_((id) => {
    if (!findPerson(Number(id))) throw httpError(404, 'Person not found.');
    throw httpError(409, 'Permanent deletion is disabled to protect Lifegroup and attendance history. Archive the person instead.');
  }),

  // dashboard / reports
  search: async_((q, extra = {}) => { q = clean(q); if (!q || q.length < 2) return { people: [] }; const sex = ['male', 'female'].includes(extra.sex) ? extra.sex : null; return { people: listPeople({ q, status: 'all' }).filter((p) => !p.archived_at && (!sex || p.sex === sex)).sort((a, b) => (a.status === 'inactive') - (b.status === 'inactive') || byName(a, b)).slice(0, 12) }; }),

  saveSettings: async_((data) => { const d = load(); for (const k of ['church_name', 'service_name', 'church_address', 'church_contact', 'privacy_contact']) if (data?.[k] !== undefined) { const v = clean(data[k]) || ''; if (!v && (k === 'church_name' || k === 'service_name')) throw httpError(400, `${k.replace('_', ' ')} cannot be empty.`); if (v.length > 300) throw httpError(400, `${k.replace('_', ' ')} is too long (max 300 characters).`); d.settings[k] = v; } save(); return { ...d.settings }; }),
  demoStatus: async_(demoStatus), demoLoad: async_(demoLoad), demoRemove: async_(demoRemove),
  snapshot: async_(() => structuredClone(load())),
};
export { httpError, today, nowSql, isValidDate, isSunday, monthRange, fullNameSafe };
function fullNameSafe(p) { return p.full_name || [p.first_name,p.last_name].filter(Boolean).join(' '); }
