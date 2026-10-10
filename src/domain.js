/** Server-side domain rules, adapted from the supplied tracker. No browser storage. */
import { AsyncLocalStorage } from 'node:async_hooks';
export const domainContext = new AsyncLocalStorage();
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Manila';
const load = () => { const c=domainContext.getStore(); if(!c) throw new Error('Domain operation requires a database transaction'); return c.data; };
const save = () => { domainContext.getStore().dirty = true; };
const nextId = (table) => ++load().seq[table];
const ADMIN = new Proxy({}, {get:(_,k)=>domainContext.getStore()?.actor?.[k] ?? ({id:null,display_name:'Imported / system'})[k]});
const STATUSES = ['first_timer','new_believer','regular','member','leader','volunteer','inactive'];
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
  if (data.sex && !['male', 'female'].includes(data.sex)) errors.push('Invalid sex value.');
  if (!STATUSES.includes(data.status)) errors.push('Invalid status.');
  if (data.birthdate && !isValidDate(data.birthdate)) errors.push('Birthday must be a valid date.');
  if (!isValidDate(data.date_registered)) errors.push('Date registered must be a valid date.');
  if (data.date_first_attended && !isValidDate(data.date_first_attended)) errors.push('Date first attended must be a valid date.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('Email address looks invalid.');
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
// Lifegroups (mirror src/routes/lifegroups.js)
// ---------------------------------------------------------------------------
const LG_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LG_TIMES = ['morning', 'afternoon', 'evening'];
const timeBucket = (t) => { if (!t) return null; const h = Number(String(t).slice(0, 2)); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };
function findGroup(id) { return load().lifegroups.find((g) => g.id === Number(id)); }
function groupShape(g) {
  const d = load();
  const lp = g.leader_person_id ? d.people.find((p) => p.id === g.leader_person_id) : null;
  const member_count = d.memberships.filter((m) => m.lifegroup_id === g.id && !m.left_at && !d.people.find((p) => p.id === m.person_id)?.archived_at).length;
  const n = g.network_id ? d.networks.find((x) => x.id === g.network_id) : null; const ns = n ? networkShape(n) : null;
  return { ...g, leader_name: lp ? `${lp.first_name} ${lp.last_name}` : g.leader_name, leader_code: lp?.person_code || null, leader_contact: lp?.contact_number || null,
    network: ns ? ns.name : g.network || null, network_gender: ns ? ns.gender || null : null, network_leader_name: ns ? ns.leader_name : null, network_leader_person_id: ns ? ns.leader_person_id : null,
    member_count, time_bucket: timeBucket(g.schedule_time), slots: g.capacity == null ? null : Math.max(g.capacity - member_count, 0) };
}
function validateGroup(body, existing = null) {
  const src = existing ? { ...existing, ...body } : body;
  const data = { name: clean(src.name), gender: clean(src.gender), leader_person_id: src.leader_person_id ? Number(src.leader_person_id) : null, leader_name: clean(src.leader_name), network: clean(src.network), network_id: src.network_id ? Number(src.network_id) : null, area: clean(src.area),
    schedule_day: clean(src.schedule_day), schedule_time: clean(src.schedule_time), category: clean(src.category), capacity: src.capacity === '' || src.capacity == null ? null : Number(src.capacity),
    venue: clean(src.venue), notes: clean(src.notes), is_active: src.is_active === undefined ? 1 : (src.is_active ? 1 : 0) };
  const errors = [];
  if (!data.name) errors.push('Group name is required.');
  if (!['boys', 'girls'].includes(data.gender)) errors.push('Choose whether this is a boys group or a girls group.');
  if (data.leader_person_id && !findPerson(data.leader_person_id)) errors.push('Leader must be a registered person.');
  if (data.network_id && !load().networks.find((n) => n.id === data.network_id)) errors.push('Network not found.');
  if (data.schedule_day && !LG_DAYS.includes(data.schedule_day)) errors.push('Invalid schedule day.');
  if (data.schedule_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.schedule_time)) errors.push('Schedule time must be HH:MM.');
  if (data.capacity !== null && (!Number.isInteger(data.capacity) || data.capacity < 1 || data.capacity > 999)) errors.push('Capacity must be a whole number (1–999) or blank.');
  if (errors.length) throw httpError(400, errors.join(' '), errors);
  return data;
}
const SEX_OF = { boys: 'male', girls: 'female' };
const GENDER_LABEL = { boys: 'boys group', girls: 'girls group' };
function checkGenderRules(data, existingId = null) {
  const d = load();
  if (data.network_id) { const net = d.networks.find((n) => n.id === data.network_id); if (net && net.gender && net.gender !== data.gender) throw httpError(400, `${net.name} is a ${net.gender} network — a ${GENDER_LABEL[data.gender]} cannot be in it. Pick a ${data.gender} network.`); }
  if (data.leader_person_id) { const lp = findPerson(data.leader_person_id); if (lp && lp.sex && lp.sex !== SEX_OF[data.gender]) throw httpError(400, `${lp.first_name} ${lp.last_name} cannot lead a ${GENDER_LABEL[data.gender]} — groups are never mixed.`); }
  if (existingId) {
    const bad = d.memberships.filter((m) => m.lifegroup_id === existingId && !m.left_at).map((m) => findPerson(m.person_id)).filter((p) => p && !p.archived_at && p.sex !== SEX_OF[data.gender]).length;
    if (bad) throw httpError(400, `Cannot make this a ${GENDER_LABEL[data.gender]}: ${bad} current member${bad === 1 ? ' is' : 's are'} not ${data.gender}. Move them first.`);
  }
}
function membershipFor(personId) {
  const d = load();
  const rows = d.memberships.filter((m) => m.person_id === Number(personId)).map((m) => {
    const g = findGroup(m.lifegroup_id) || {}; const gs = g.id ? groupShape(g) : {};
    return { id: m.id, lifegroup_id: m.lifegroup_id, role: m.role, joined_at: m.joined_at, left_at: m.left_at, notes: m.notes || null, name: g.name, gender: g.gender || null, area: g.area, schedule_day: g.schedule_day, schedule_time: g.schedule_time,
      is_active: g.is_active, leader_person_id: g.leader_person_id, leader_name: gs.leader_name || null, network_id: g.network_id || null, network_name: gs.network || null, network_leader_name: gs.network_leader_name || null, network_leader_person_id: gs.network_leader_person_id || null, assigned_by_name: ADMIN.display_name };
  }).sort((a, b) => (a.left_at ? 1 : 0) - (b.left_at ? 1 : 0) || String(b.joined_at).localeCompare(String(a.joined_at)) || b.id - a.id);
  return { current: rows.find((r) => !r.left_at) || null, history: rows };
}
function recommendGroups(prefs) {
  const wanted = prefs.sex === 'male' ? 'boys' : prefs.sex === 'female' ? 'girls' : null;
  if (!wanted) return [];
  const area = (prefs.area || '').toLowerCase(), day = prefs.day || '', time = prefs.time || '', cat = (prefs.category || '').toLowerCase();
  return load().lifegroups.filter((g) => g.is_active && g.gender === wanted).map(groupShape).map((g) => {
    let score = 0; const reasons = [];
    if (area && g.area && g.area.toLowerCase() === area) { score += 3; reasons.push('same area'); }
    if (day && g.schedule_day === day) { score += 2; reasons.push('preferred day'); }
    if (time && g.time_bucket === time) { score += 1; reasons.push('preferred time'); }
    if (cat && g.category && g.category.toLowerCase() === cat) { score += 1; reasons.push('matching category'); }
    return { ...g, score, reasons };
  }).filter((g) => g.slots !== 0).sort((a, b) => b.score - a.score || (b.slots ?? 999) - (a.slots ?? 999) || a.name.localeCompare(b.name)).slice(0, 8);
}
function hasGroup(pid) { return load().memberships.some((m) => m.person_id === pid && !m.left_at); }
function lgOverview() {
  const d = load(); const active = d.lifegroups.filter((g) => g.is_active);
  const people = d.people.filter((p) => !p.archived_at && p.status !== 'inactive');
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60); const cut = toISO(cutoff);
  const leaders = new Set(active.map((g) => g.leader_person_id ? 'p' + g.leader_person_id : g.leader_name ? 'n' + g.leader_name : null).filter(Boolean));
  return { networks: d.networks.filter((n) => n.is_active).length, total_groups: d.lifegroups.length, active_groups: active.length, boys_groups: active.filter((g) => g.gender === 'boys').length, girls_groups: active.filter((g) => g.gender === 'girls').length, groups_with_slots: active.map(groupShape).filter((g) => g.slots !== 0).length, total_leaders: leaders.size,
    with_group: people.filter((p) => hasGroup(p.id)).length, without_group: people.filter((p) => !hasGroup(p.id)).length, new_needing_connection: people.filter((p) => !hasGroup(p.id) && p.date_registered >= cut).length };
}
function needsList(q) {
  const ql = (clean(q) || '').toLowerCase();
  return load().people.filter((p) => !p.archived_at && p.status !== 'inactive' && !hasGroup(p.id) && (!ql || `${p.first_name} ${p.last_name}`.toLowerCase().includes(ql) || (p.person_code || '').toLowerCase().includes(ql)))
    .map(decorate).sort((a, b) => (a.last_attended ? 0 : 1) - (b.last_attended ? 0 : 1) || String(b.last_attended).localeCompare(String(a.last_attended)) || String(b.date_registered).localeCompare(String(a.date_registered)));
}
function assignGroup(groupId, personId, { joined_at, role, notes } = {}) {
  const d = load(); const g = findGroup(groupId); if (!g) throw httpError(404, 'Lifegroup not found.');
  if (!g.is_active) throw httpError(400, 'That Lifegroup is inactive.');
  const p = findPerson(personId); if (!p) throw httpError(404, 'Person not found.');
  if (!p.sex) throw httpError(400, `Set Boy or Girl on ${p.first_name}'s profile first — ${g.name} is a ${GENDER_LABEL[g.gender] || 'group'} and groups are never mixed.`);
  if (g.gender && p.sex !== SEX_OF[g.gender]) throw httpError(409, `${p.first_name} ${p.last_name} cannot join ${g.name}: it is a ${GENDER_LABEL[g.gender]} and groups are never mixed.`);
  const date = joined_at || today(); if (!isValidDate(date)) throw httpError(400, 'Joined date must be a valid date.');
  if (role && !['member', 'leader', 'assistant'].includes(role)) throw httpError(400, 'Invalid role.');
  const cur = d.memberships.find((m) => m.person_id === p.id && !m.left_at);
  if (cur && cur.lifegroup_id === g.id) return { ...membershipFor(p.id), unchanged: true };
  const gs = groupShape(g);
  if (g.capacity != null && gs.member_count >= g.capacity) throw httpError(409, `${g.name} is full (${g.capacity}). Choose another group or raise its capacity.`);
  if (cur) cur.left_at = date;
  d.memberships.push({ id: nextId('memberships'), person_id: p.id, lifegroup_id: g.id, role: role || 'member', joined_at: date, left_at: null, notes: clean(notes), created_at: nowSql() });
  save();
  return { ...membershipFor(p.id), unchanged: false };
}

// ---------------------------------------------------------------------------
// Networks (mirror src/routes/networks.js): the layer above Lifegroups
// ---------------------------------------------------------------------------
function migrateNetworkText(d) {
  // older stores kept the network as free text on the group → turn it into Network rows (like migration 005)
  for (const g of d.lifegroups) {
    if (g.network_id || !g.network) continue;
    let n = d.networks.find((x) => x.name.toLowerCase() === g.network.toLowerCase());
    if (!n) { n = { id: ++d.seq.networks, name: g.network, leader_person_id: null, leader_name: null, parent_network_id: null, notes: null, is_active: 1, is_demo: g.is_demo ? 1 : 0, created_at: nowSql(), updated_at: nowSql() }; d.networks.push(n); }
    g.network_id = n.id;
  }
}
function migrateGenders(d) {
  // older stores had no boys/girls on groups → infer when every current member is one sex (like migration 006)
  for (const g of d.lifegroups) {
    if (g.gender) continue;
    const sexes = d.memberships.filter((m) => m.lifegroup_id === g.id && !m.left_at).map((m) => d.people.find((p) => p.id === m.person_id)?.sex);
    if (sexes.length && sexes.every((x) => x === 'male')) g.gender = 'boys';
    else if (sexes.length && sexes.every((x) => x === 'female')) g.gender = 'girls';
    else g.gender = null;
  }
  // networks: one type only — infer from groups, else from child networks (like migration 007)
  for (const n of d.networks || []) {
    if (n.gender) continue;
    const gs = d.lifegroups.filter((g) => g.network_id === n.id && g.is_active).map((g) => g.gender);
    const kids = (d.networks || []).filter((c) => c.parent_network_id === n.id).map((c) => c.gender);
    const pick = (arr) => (arr.length && arr.every((x) => x === 'boys') ? 'boys' : arr.length && arr.every((x) => x === 'girls') ? 'girls' : null);
    n.gender = pick(gs) || pick(kids) || null;
  }
}
function findNetwork(id) { return load().networks.find((n) => n.id === Number(id)); }
function networkShape(n) {
  const d = load();
  const lp = n.leader_person_id ? d.people.find((p) => p.id === n.leader_person_id) : null;
  const parent = n.parent_network_id ? d.networks.find((x) => x.id === n.parent_network_id) : null;
  const groups = d.lifegroups.filter((g) => g.network_id === n.id && g.is_active); const gids = groups.map((g) => g.id);
  const members = d.memberships.filter((m) => gids.includes(m.lifegroup_id) && !m.left_at).map((m) => d.people.find((p) => p.id === m.person_id)).filter((p) => p && !p.archived_at);
  return { ...n, leader_name: lp ? `${lp.first_name} ${lp.last_name}` : n.leader_name, leader_code: lp?.person_code || null, leader_contact: lp?.contact_number || null, parent_name: parent?.name || null,
    group_count: gids.length, people_count: members.length, boys: members.filter((p) => p.sex === 'male').length, girls: members.filter((p) => p.sex === 'female').length,
    boys_groups: groups.filter((g) => g.gender === 'boys').length, girls_groups: groups.filter((g) => g.gender === 'girls').length,
    leader_count: new Set(groups.filter((g) => g.leader_person_id || g.leader_name).map((g) => g.leader_person_id ? 'p' + g.leader_person_id : 'n' + g.leader_name)).size,
    child_count: d.networks.filter((c) => c.parent_network_id === n.id && c.is_active).length };
}
function withTotals(rows) {
  const byParent = new Map();
  rows.forEach((n) => { const k = n.parent_network_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(n); });
  const sum = (n, depth = 0) => {
    const t = { total_groups: n.group_count, total_people: n.people_count, total_boys: n.boys, total_girls: n.girls, total_leaders: n.leader_count, total_boys_groups: n.boys_groups, total_girls_groups: n.girls_groups };
    if (depth < 20) for (const c of byParent.get(n.id) || []) { const ct = sum(c, depth + 1); for (const k of Object.keys(t)) t[k] += ct[k]; }
    Object.assign(n, t); return t;
  };
  rows.filter((n) => !n.parent_network_id || !rows.some((x) => x.id === n.parent_network_id)).forEach((n) => sum(n));
  return rows;
}
function lifegroupReport() {
  const d = load(); const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const finish = (r) => ({ ...r, unknown: r.members - r.boys - r.girls, boys_pct: pct(r.boys, r.members), girls_pct: pct(r.girls, r.members) });
  const groups = d.lifegroups.filter((g) => g.is_active).map(groupShape).map((g) => {
    const ms = d.memberships.filter((m) => m.lifegroup_id === g.id && !m.left_at).map((m) => d.people.find((p) => p.id === m.person_id)).filter((p) => p && !p.archived_at);
    return { group_id: g.id, group_name: g.name, gender: g.gender || null, area: g.area, is_active: g.is_active, network_id: g.network_id || null, leader_name: g.leader_name, leader_person_id: g.leader_person_id, network_name: g.network || null, network_gender: g.network_gender || null, network_leader_name: g.network_leader_name || null,
      members: ms.length, boys: ms.filter((p) => p.sex === 'male').length, girls: ms.filter((p) => p.sex === 'female').length };
  }).sort((a, b) => (a.network_name ? 0 : 1) - (b.network_name ? 0 : 1) || String(a.network_name || '').localeCompare(String(b.network_name || '')) || a.group_name.localeCompare(b.group_name));
  const byNet = new Map();
  for (const g of groups) { const k = g.network_id || 0; if (!byNet.has(k)) byNet.set(k, { network_id: g.network_id, network_name: g.network_name || 'No network', network_gender: g.network_gender || null, network_leader_name: g.network_leader_name, groups: 0, boys_groups: 0, girls_groups: 0, members: 0, boys: 0, girls: 0 }); const n = byNet.get(k); n.groups += 1; n.members += g.members; n.boys += g.boys; n.girls += g.girls; if (g.gender === 'boys') n.boys_groups += 1; if (g.gender === 'girls') n.girls_groups += 1; }
  const totals = groups.reduce((t, g) => ({ groups: t.groups + 1, boys_groups: t.boys_groups + (g.gender === 'boys'), girls_groups: t.girls_groups + (g.gender === 'girls'), members: t.members + g.members, boys: t.boys + g.boys, girls: t.girls + g.girls }), { groups: 0, boys_groups: 0, girls_groups: 0, members: 0, boys: 0, girls: 0 });
  const nc = d.people.filter((p) => !p.archived_at && p.status !== 'inactive' && !hasGroup(p.id));
  const d30 = isoDaysAgo(30);
  const withGrowth = (g) => {
    const ms = d.memberships.filter((m) => m.lifegroup_id === g.group_id);
    const joined_30d = ms.filter((m) => m.joined_at >= d30).length, left_30d = ms.filter((m) => m.left_at && m.left_at >= d30).length;
    const net = joined_30d - left_30d, base = g.members - net;
    return { ...g, joined_30d, left_30d, net_30d: net, growth_30d_pct: base > 0 ? Math.round((net / base) * 1000) / 10 : (net > 0 ? null : 0) };
  };
  return { groups: groups.map(finish).map(withGrowth), networks: [...byNet.values()].map(finish), totals: finish(totals), not_connected: { total: nc.length, boys: nc.filter((p) => p.sex === 'male').length, girls: nc.filter((p) => p.sex === 'female').length }, growth: growthSeries() };
}
function isoDaysAgo(n) { const dt = new Date(); dt.setDate(dt.getDate() - n); return isoOf(dt); }
function isoOf(dt) { const pad = (x) => String(x).padStart(2, '0'); return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; }
/** Monthly growth of boys groups vs girls groups (members at month end, joined, left, % vs previous month). */
function growthSeries(months = 12) {
  const d = load(); const pad = (x) => String(x).padStart(2, '0');
  const gOf = new Map(d.lifegroups.map((g) => [g.id, g.gender])); const alive = new Set(d.people.filter((p) => !p.archived_at).map((p) => p.id));
  const ms = d.memberships.filter((m) => alive.has(m.person_id) && (gOf.get(m.lifegroup_id) === 'boys' || gOf.get(m.lifegroup_id) === 'girls'));
  const count = (k, start, end) => { const rows = ms.filter((m) => gOf.get(m.lifegroup_id) === k); return { at_end: rows.filter((m) => m.joined_at <= end && (!m.left_at || m.left_at > end)).length, joined: rows.filter((m) => m.joined_at >= start && m.joined_at <= end).length, left: rows.filter((m) => m.left_at && m.left_at >= start && m.left_at <= end).length }; };
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const firstS = ms.map((m) => m.joined_at).sort()[0]; const firstD = firstS ? new Date(firstS + 'T12:00:00') : null;
  const from = firstD && firstD > start ? new Date(firstD.getFullYear(), firstD.getMonth(), 1) : start;
  const out = []; const prev = { boys: null, girls: null };
  const pctOf = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : (a > 0 ? null : 0));
  for (let dt = new Date(from); dt <= now; dt.setMonth(dt.getMonth() + 1)) {
    const y = dt.getFullYear(), mo = dt.getMonth(); const startS = `${y}-${pad(mo + 1)}-01`; const endS = `${y}-${pad(mo + 1)}-${pad(new Date(y, mo + 1, 0).getDate())}`;
    const row = { month: `${y}-${pad(mo + 1)}` };
    for (const k of ['boys', 'girls']) { const r = count(k, startS, endS); row[`${k}_end`] = r.at_end; row[`${k}_joined`] = r.joined; row[`${k}_left`] = r.left; row[`${k}_growth_pct`] = prev[k] === null ? null : pctOf(r.at_end, prev[k]); prev[k] = r.at_end; }
    out.push(row);
  }
  const summary = {};
  for (const k of ['boys', 'girls']) { const cur = count(k, '0000-01-01', isoOf(now)).at_end, m1 = count(k, '0000-01-01', isoDaysAgo(30)).at_end, m3 = count(k, '0000-01-01', isoDaysAgo(90)).at_end; summary[k] = { now: cur, days30_ago: m1, days90_ago: m3, change_30d: cur - m1, pct_30d: pctOf(cur, m1), change_90d: cur - m3, pct_90d: pctOf(cur, m3) }; }
  return { months: out, summary };
}
function validateNetwork(body, existing = null) {
  const src = existing ? { ...existing, ...body } : body;
  const data = { name: clean(src.name), gender: clean(src.gender) || null, leader_person_id: src.leader_person_id ? Number(src.leader_person_id) : null, leader_name: clean(src.leader_name), parent_network_id: src.parent_network_id ? Number(src.parent_network_id) : null, notes: clean(src.notes), is_active: src.is_active === undefined ? 1 : (src.is_active ? 1 : 0) };
  const errors = []; const d = load();
  if (!data.name) errors.push('Network name is required.');
  // A Network is either a boys network or a girls network — never combined.
  if (!['boys', 'girls'].includes(data.gender)) errors.push('Choose whether this is a boys network or a girls network.');
  const other = data.gender === 'boys' ? 'girls' : 'boys';
  if (data.leader_person_id) {
    const lp = findPerson(data.leader_person_id);
    if (!lp) errors.push('Leader must be a registered person.');
    else if (data.gender && lp.sex && lp.sex !== SEX_OF[data.gender]) errors.push(`${lp.first_name} ${lp.last_name} cannot lead a ${data.gender} network — networks are never mixed.`);
    else if (data.gender && !lp.sex) errors.push(`Set Boy or Girl on ${lp.first_name} ${lp.last_name}'s profile first.`);
  }
  if (existing && data.gender && data.gender !== existing.gender) {
    const badGroups = d.lifegroups.filter((g) => g.network_id === existing.id && g.is_active && g.gender && g.gender !== data.gender).length;
    const badKids = d.networks.filter((c) => c.parent_network_id === existing.id && c.is_active && c.gender && c.gender !== data.gender).length;
    if (badGroups) errors.push(`This network still has ${badGroups} ${other} group${badGroups === 1 ? '' : 's'} — move them to another network first.`);
    if (badKids) errors.push(`This network still has ${badKids} ${other} sub-network${badKids === 1 ? '' : 's'} — move them first.`);
  }
  if (data.parent_network_id) {
    const parent = findNetwork(data.parent_network_id);
    if (existing && data.parent_network_id === existing.id) errors.push('A network cannot be its own parent.');
    else if (!parent) errors.push('Parent network not found.');
    else if (data.gender && parent.gender && parent.gender !== data.gender) errors.push(`${parent.name} is a ${parent.gender} network — a ${data.gender} network cannot be under it.`);
    else if (existing) { let cur = data.parent_network_id, hops = 0; while (cur && hops++ < 50) { if (cur === existing.id) { errors.push('That parent would create a loop.'); break; } cur = findNetwork(cur)?.parent_network_id; } }
  }
  if (errors.length) throw httpError(400, errors.join(' '), errors);
  return data;
}
function leadershipFor(personId) {
  const d = load(); const pid = Number(personId);
  const leads_groups = d.lifegroups.filter((g) => g.leader_person_id === pid && g.is_active).map((g) => ({ id: g.id, name: g.name, area: g.area, network_id: g.network_id || null, network_name: findNetwork(g.network_id)?.name || null }));
  const leads_networks = d.networks.filter((n) => n.leader_person_id === pid && n.is_active).map((n) => ({ id: n.id, name: n.name, parent_network_id: n.parent_network_id }));
  const chain = []; let networkId = null;
  const m = d.memberships.find((x) => x.person_id === pid && !x.left_at); const cur = m ? findGroup(m.lifegroup_id) : null;
  if (cur) { const gs = groupShape(cur); if (cur.leader_person_id !== pid && gs.leader_name) chain.push({ level: 'Lifegroup leader', name: gs.leader_name, person_id: cur.leader_person_id, via: cur.name, group_id: cur.id }); networkId = cur.network_id; }
  else if (leads_groups.length) networkId = leads_groups[0].network_id;
  else if (leads_networks.length) networkId = leads_networks[0].parent_network_id;
  let hops = 0;
  while (networkId && hops++ < 20) {
    const n = findNetwork(networkId); if (!n) break; const ns = networkShape(n);
    const last = chain[chain.length - 1];
    if (n.leader_person_id !== pid && ns.leader_name && !(last && last.person_id && last.person_id === n.leader_person_id)) chain.push({ level: 'Network leader', name: ns.leader_name, person_id: n.leader_person_id, via: n.name, network_id: n.id });
    networkId = n.parent_network_id;
  }
  return { leads_groups, leads_networks, reports_to: chain };
}

// ---------------------------------------------------------------------------
// Demo data (same shape as src/services/demo.js, clearly labelled)
// ---------------------------------------------------------------------------
function lastSundays(n) {
  const out = []; const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - d.getDay());
  for (let i = 0; i < n; i++) { const c = new Date(d); c.setDate(d.getDate() - i * 7); out.push(toISO(c)); }
  return out.reverse();
}
function demoStatus() { const d = load(); const people = d.people.filter((p) => p.is_demo).length; const services = d.services.filter((s) => s.is_demo).length; return { loaded: people > 0, people, services }; }
function demoLoad() {
  if (demoStatus().loaded) return { ...demoStatus(), message: 'Demo data is already loaded.' };
  const d = load(); const sundays = lastSundays(10);
  const statuses = ['regular', 'regular', 'member', 'member', 'new_believer', 'volunteer', 'leader', 'first_timer'];
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
  // Demo Lifegroups (about 60% of demo people connected; one has a move in history)
  const sundaysAsc = sundays;
  const mkNet = (name, gender, leader, parent) => { const row = { id: nextId('networks'), name, gender, leader_person_id: leader, leader_name: null, parent_network_id: parent, notes: 'DEMO DATA', is_active: 1, is_demo: 1, created_at: nowSql(), updated_at: nowSql() }; d.networks.push(row); return row.id; };
  // Networks and groups are never mixed: a boys network holds boys groups, a girls network girls groups.
  const malesD = people.filter((x) => x.p.sex === 'male'), femalesD = people.filter((x) => x.p.sex === 'female');
  const netBoys = mkNet('Demo Boys Network', 'boys', malesD[5].p.id, null);
  const netGirls = mkNet('Demo Girls Network', 'girls', femalesD[5].p.id, null);
  const netA = mkNet('Demo Network A (boys)', 'boys', malesD[9].p.id, netBoys);
  const netB = mkNet('Demo Network B (girls)', 'girls', femalesD[9].p.id, netGirls);
  // Groups are never mixed: boys groups get male leaders/members, girls groups female.
  const males = people.filter((x) => x.p.sex === 'male'), females = people.filter((x) => x.p.sex === 'female');
  const gdefs = [
    { name: 'Demo Joshua Group', gender: 'boys', leader: males[3].p.id, network_id: netA, network: 'Demo Network A (boys)', area: 'Kaybanban', schedule_day: 'sat', schedule_time: '17:00', category: 'Students', capacity: 12, venue: 'Demo venue 1' },
    { name: 'Demo Ruth Group', gender: 'girls', leader: females[3].p.id, network_id: netB, network: 'Demo Network B (girls)', area: 'Kaybanban', schedule_day: 'sat', schedule_time: '16:00', category: 'Students', capacity: 12, venue: 'Demo venue 2' },
    { name: 'Demo David Group', gender: 'boys', leader: males[7].p.id, network_id: netA, network: 'Demo Network A (boys)', area: 'Muzon', schedule_day: 'fri', schedule_time: '19:00', category: 'Young Pro', capacity: 10, venue: 'Demo venue 3' },
    { name: 'Demo Esther Group', gender: 'girls', leader: females[10].p.id, network_id: netB, network: 'Demo Network B (girls)', area: 'Tungkong Mangga', schedule_day: 'fri', schedule_time: '19:30', category: 'Mixed', capacity: null, venue: 'Demo venue 4' },
  ];
  const gids = gdefs.map(({ leader, ...g }) => { const row = { id: nextId('lifegroups'), ...g, leader_person_id: leader, leader_name: null, notes: 'DEMO DATA', is_active: 1, is_demo: 1, created_at: nowSql(), updated_at: nowSql() }; d.lifegroups.push(row); return row.id; });
  const [JOSHUA, RUTH, DAVID, ESTHER] = gids;
  const leaderOf = new Map([[males[3].p.id, JOSHUA], [females[3].p.id, RUTH], [males[7].p.id, DAVID], [females[10].p.id, ESTHER]]);
  const areas = ['Kaybanban', 'Muzon', 'Tungkong Mangga', 'Sapang Palay'];
  const addM = (pid, gid, role, joined, left) => d.memberships.push({ id: nextId('memberships'), person_id: pid, lifegroup_id: gid, role, joined_at: joined, left_at: left || null, notes: null, created_at: nowSql() });
  const mid = Math.floor(sundaysAsc.length / 2);
  people.forEach((x, i) => {
    const { p, joinIdx } = x;
    p.preferred_area = areas[i % areas.length]; p.preferred_day = i % 3 ? 'sat' : 'fri'; p.preferred_time = i % 2 ? 'evening' : 'afternoon';
    if (leaderOf.has(p.id)) return addM(p.id, leaderOf.get(p.id), 'leader', sundaysAsc[0]);
    if (i % 5 === 0) return;
    const k = (p.sex === 'male' ? males : females).indexOf(x);
    const g = p.sex === 'male' ? (k % 2 ? DAVID : JOSHUA) : (k % 2 ? ESTHER : RUTH);
    if (x === males[1]) { addM(p.id, DAVID, 'member', sundaysAsc[0], sundaysAsc[mid]); return addM(p.id, JOSHUA, 'member', sundaysAsc[mid]); }
    addM(p.id, g, 'member', sundaysAsc[Math.min(joinIdx + 1, sundaysAsc.length - 1)]);
  });
  save();
  return { ...demoStatus(), message: 'Demo data loaded.' };
}
function demoRemove() {
  const d = load();
  const demoIds = new Set(d.people.filter((p) => p.is_demo).map((p) => p.id));
  const demoGroups = new Set(d.lifegroups.filter((g) => g.is_demo).map((g) => g.id));
  d.memberships = d.memberships.filter((m) => !demoIds.has(m.person_id) && !demoGroups.has(m.lifegroup_id));
  d.lifegroups = d.lifegroups.filter((g) => !g.is_demo);
  d.networks = d.networks.filter((n) => !n.is_demo);
  d.people = d.people.filter((p) => !demoIds.has(p.id));
  d.records = d.records.filter((r) => !demoIds.has(r.person_id));
  d.audit = d.audit.filter((a) => !demoIds.has(a.person_id));
  d.services = d.services.filter((s) => !s.is_demo || d.records.some((r) => r.service_id === s.id));
  save();
  return { ...demoStatus(), message: 'Demo data removed.' };
}

// ---------------------------------------------------------------------------
// CSV export (replaces /api/reports/export/*.csv)
// ---------------------------------------------------------------------------
const csvCell = (v) => { if (v === null || v === undefined) return ''; let s = String(v); if (/^[=+\-@\t\r]/.test(s) || /^\s+[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (headers, rows) => [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\r\n') + '\r\n';
function downloadText(filename, text, type = 'text/csv;charset=utf-8') { return { filename, text, type }; }
function resolveRange(q) {
  const year = Number(q.year), quarter = Number(q.quarter), month = Number(q.month);
  let from = clean(q.from), to = clean(q.to), label;
  const nice = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  if (year && quarter >= 1 && quarter <= 4) { ({ from, to } = quarterRange(year, quarter)); label = `Q${quarter} ${year}`; }
  else if (year && month >= 1 && month <= 12) { ({ from, to } = monthRange(year, month)); label = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }); }
  else if (year) { from = `${year}-01-01`; to = `${year}-12-31`; label = `Year ${year}`; }
  else {
    if (from && !isValidDate(from)) throw httpError(400, 'Invalid "from" date.');
    if (to && !isValidDate(to)) throw httpError(400, 'Invalid "to" date.');
    if (from && to && from === to) label = `Sunday, ${nice(from)}`;
    else label = from || to ? `${from ? nice(from) : 'Beginning'} – ${to ? nice(to) : 'Today'}` : 'All time';
  }
  if (from && to && from > to) throw httpError(400, '"From" date must be before "to" date.');
  return { from, to, label };
}
function exportCsv(url) {
  const u = new URL(url, 'http://local/'); const q = Object.fromEntries(u.searchParams); const d = load();
  const which = u.pathname.split('/').pop();
  if (which === 'lifegroups.csv') {
    const r = lifegroupReport();
    const rows = r.groups.map((g) => ({ network: g.network_name || '', network_leader: g.network_leader_name || '', group: g.group_name, type: g.gender === 'boys' ? 'Boys group' : g.gender === 'girls' ? 'Girls group' : '', leader: g.leader_name || '', area: g.area || '', members: g.members, boys: g.boys, girls: g.girls, unknown: g.unknown, boys_pct: g.boys_pct ?? '', girls_pct: g.girls_pct ?? '', joined_30d: g.joined_30d, left_30d: g.left_30d, net_30d: g.net_30d, growth_30d_pct: g.growth_30d_pct ?? '' }));
    rows.push({ network: 'TOTAL', network_leader: '', group: '', type: `${r.totals.boys_groups} boys groups / ${r.totals.girls_groups} girls groups`, leader: '', area: '', members: r.totals.members, boys: r.totals.boys, girls: r.totals.girls, unknown: r.totals.unknown, boys_pct: r.totals.boys_pct ?? '', girls_pct: r.totals.girls_pct ?? '' });
    return downloadText('lifegen-lifegroups.csv', toCsv(['network', 'network_leader', 'group', 'type', 'leader', 'area', 'members', 'boys', 'girls', 'unknown', 'boys_pct', 'girls_pct', 'joined_30d', 'left_30d', 'net_30d', 'growth_30d_pct'], rows));
  }
  if (which === 'lifegroup-growth.csv') {
    const g = growthSeries();
    const rows = g.months.map((m) => ({ month: m.month, boys_members: m.boys_end, boys_joined: m.boys_joined, boys_left: m.boys_left, boys_growth_pct: m.boys_growth_pct ?? '', girls_members: m.girls_end, girls_joined: m.girls_joined, girls_left: m.girls_left, girls_growth_pct: m.girls_growth_pct ?? '' }));
    return downloadText('lifegen-lifegroup-growth.csv', toCsv(['month', 'boys_members', 'boys_joined', 'boys_left', 'boys_growth_pct', 'girls_members', 'girls_joined', 'girls_left', 'girls_growth_pct'], rows));
  }
  if (which === 'people.csv') {
    const rows = [...d.people].sort(byName).map((p) => ({ ...p, sundays_attended: presentRecordsOf(p.id).length }));
    return downloadText('lifegen-people.csv', toCsv(['person_code', 'last_name', 'first_name', 'middle_name', 'sex', 'birthdate', 'age', 'ministry', 'inviter', 'registration_source', 'contact_number', 'email', 'address', 'school', 'course_year', 'occupation', 'status', 'date_registered', 'date_first_attended', 'sundays_attended'], rows));
  }
  const range = resolveRange(q); const rows = summaries(range);
  if (which === 'weekly.csv') return downloadText(`lifegen-weekly-${(range.label || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`, toCsv(['sunday', 'service', 'present', 'first_timers', 'returning', 'absent', 'registered_base', 'attendance_rate_pct', 'notes'],
    rows.map((r) => ({ sunday: r.service_date, service: load().settings.service_name, present: r.present_count, first_timers: r.first_timer_count, returning: r.returning_count, absent: r.absent_count, registered_base: r.registered_base, attendance_rate_pct: r.attendance_rate ?? '', notes: r.notes || '' }))));
  if (which === 'monthly.csv') return downloadText('lifegen-monthly.csv', toCsv(['month', 'services', 'present', 'average', 'first_timers', 'returning', 'absent'], monthlyBreakdown(rows)));
  if (which === 'detail.csv') {
    const ids = new Set(rows.map((r) => r.id));
    const out = d.records.filter((r) => ids.has(r.service_id)).map((r) => { const s = findService(r.service_id); const p = findPerson(r.person_id) || {}; return { sunday: s.service_date, person_code: p.person_code, last_name: p.last_name, first_name: p.first_name, person_status: p.status, attendance: r.status, classification: r.classification, recorded_at: r.recorded_at, recorded_by: r.recorded_by_name || 'Imported staff' }; })
      .sort((a, b) => a.sunday.localeCompare(b.sunday) || String(a.last_name).localeCompare(String(b.last_name)));
    return downloadText('lifegen-attendance-detail.csv', toCsv(['sunday', 'person_code', 'last_name', 'first_name', 'person_status', 'attendance', 'classification', 'recorded_at', 'recorded_by'], out));
  }
  throw httpError(404, 'Unknown export.');
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
    const lg = membershipFor(p.id);
    return { ...dec, history, services_since: servicesSince, attendance_rate: servicesSince ? round1((dec.sundays_attended / servicesSince) * 100) : null, lifegroup: lg.current, lifegroup_history: lg.history, leadership: leadershipFor(p.id) };
  }),
  updatePreferences: async_((id, prefs) => {
    const p = findPerson(id); if (!p) throw httpError(404, 'Person not found.');
    const day = clean(prefs.preferred_day), time = clean(prefs.preferred_time);
    if (day && !LG_DAYS.includes(day)) throw httpError(400, 'Invalid preferred day.');
    if (time && !LG_TIMES.includes(time)) throw httpError(400, 'Invalid preferred time.');
    Object.assign(p, { preferred_area: clean(prefs.preferred_area), preferred_day: day, preferred_time: time, preferred_category: clean(prefs.preferred_category), updated_at: nowSql() });
    if (prefs.sex) { if (!['male', 'female'].includes(prefs.sex)) throw httpError(400, 'Invalid sex value.'); p.sex = prefs.sex; }
    save(); return decorate(p);
  }),
  lifegroups: async_((params = {}) => {
    const q = (clean(params.q) || '').toLowerCase(); const area = clean(params.area); const status = clean(params.status) || 'active';
    const nid = params.network_id ? Number(params.network_id) : null;
    return load().lifegroups.map(groupShape).filter((g) => (status === 'all' || (status === 'inactive' ? !g.is_active : g.is_active)) && (!area || g.area === area) && (!nid || g.network_id === nid)
      && (!q || [g.name, g.area, g.network, g.leader_name].some((v) => (v || '').toLowerCase().includes(q))))
      .sort((a, b) => b.is_active - a.is_active || String(a.area || '').localeCompare(String(b.area || '')) || a.name.localeCompare(b.name));
  }),
  lifegroup: async_((id) => {
    const g = findGroup(id); if (!g) throw httpError(404, 'Lifegroup not found.');
    const d = load();
    const members = d.memberships.filter((m) => m.lifegroup_id === g.id && !m.left_at).map((m) => { const p = decorate(findPerson(m.person_id)); return { ...p, role: m.role, joined_at: m.joined_at, membership_id: m.id }; })
      .sort((a, b) => (a.role === 'member') - (b.role === 'member') || byName(a, b));
    const former = d.memberships.filter((m) => m.lifegroup_id === g.id && m.left_at).map((m) => { const p = findPerson(m.person_id); return { id: p.id, person_code: p.person_code, first_name: p.first_name, last_name: p.last_name, joined_at: m.joined_at, left_at: m.left_at }; })
      .sort((a, b) => b.left_at.localeCompare(a.left_at)).slice(0, 50);
    return { ...groupShape(g), members, former };
  }),
  lifegroupOptions: async_(() => { const d = load(); const col = (k) => [...new Set(d.lifegroups.map((g) => g[k]).filter(Boolean))].sort(); return { areas: col('area'), categories: col('category'), networks: d.networks.filter((n) => n.is_active).map(networkShape).map((n) => ({ id: n.id, name: n.name, gender: n.gender || null, leader_name: n.leader_name })).sort((a, b) => a.name.localeCompare(b.name)), days: LG_DAYS, times: LG_TIMES }; }),
  lifegroupNeeds: async_((params = {}) => needsList(params.q)),
  lifegroupRecommend: async_((params = {}) => {
    let prefs = { sex: clean(params.sex), area: clean(params.area), day: clean(params.day), time: clean(params.time), category: clean(params.category) };
    if (params.person_id) { const p = findPerson(params.person_id); if (!p) throw httpError(404, 'Person not found.'); prefs = { sex: prefs.sex || p.sex, area: prefs.area || p.preferred_area, day: prefs.day || p.preferred_day, time: prefs.time || p.preferred_time, category: prefs.category || p.preferred_category }; }
    return { prefs, groups: recommendGroups(prefs) };
  }),
  networks: async_((params = {}) => { const status = clean(params.status) || 'active'; return withTotals(load().networks.map(networkShape).filter((n) => status === 'all' || (status === 'inactive' ? !n.is_active : n.is_active)).sort((a, b) => (b.is_active - a.is_active) || ((a.parent_network_id ? 1 : 0) - (b.parent_network_id ? 1 : 0)) || a.name.localeCompare(b.name))); }),
  reportLifegroups: async_(() => lifegroupReport()),
  network: async_((id) => {
    const n = findNetwork(id); if (!n) throw httpError(404, 'Network not found.'); const d = load();
    const groups = d.lifegroups.filter((g) => g.network_id === n.id).map(groupShape).map((g) => {
      const members = d.memberships.filter((m) => m.lifegroup_id === g.id && !m.left_at).map((m) => { const p = d.people.find((x) => x.id === m.person_id); return p && !p.archived_at ? { id: p.id, person_code: p.person_code, first_name: p.first_name, last_name: p.last_name, photo: p.photo, sex: p.sex, status: p.status, role: m.role, joined_at: m.joined_at } : null; }).filter(Boolean)
        .sort((a, b) => (a.role === 'member') - (b.role === 'member') || byName(a, b));
      return { id: g.id, name: g.name, gender: g.gender || null, area: g.area, schedule_day: g.schedule_day, schedule_time: g.schedule_time, capacity: g.capacity, is_active: g.is_active, leader_person_id: g.leader_person_id, leader_name: g.leader_name, member_count: g.member_count, members, boys: members.filter((m) => m.sex === 'male').length, girls: members.filter((m) => m.sex === 'female').length };
    }).sort((a, b) => (b.is_active - a.is_active) || a.name.localeCompare(b.name));
    const children = withTotals(d.networks.filter((c) => c.parent_network_id === n.id).map(networkShape).sort((a, b) => a.name.localeCompare(b.name)));
    return { ...networkShape(n), groups, children };
  }),
  createNetwork: async_((body) => { const d = load(); const data = validateNetwork(body || {}); const n = { id: nextId('networks'), ...data, is_demo: 0, created_at: nowSql(), updated_at: nowSql() }; d.networks.push(n); save(); return networkShape(n); }),
  updateNetwork: async_((id, body) => { const n = findNetwork(id); if (!n) throw httpError(404, 'Network not found.'); Object.assign(n, validateNetwork(body || {}, n), { updated_at: nowSql() }); save(); return networkShape(n); }),
  deleteNetwork: async_((id) => { const d = load(); const n = findNetwork(id); if (!n) throw httpError(404, 'Network not found.'); if (d.lifegroups.some((g) => g.network_id === n.id) || d.networks.some((c) => c.parent_network_id === n.id)) throw httpError(409, 'This Network still has Lifegroups or sub-networks. Move them first or mark the Network inactive.'); d.networks = d.networks.filter((x) => x !== n); save(); return null; }),
  createLifegroup: async_((body) => { const d = load(); const data = validateGroup(body || {}); checkGenderRules(data); const g = { id: nextId('lifegroups'), ...data, is_demo: 0, created_at: nowSql(), updated_at: nowSql() }; d.lifegroups.push(g); save(); return groupShape(g); }),
  updateLifegroup: async_((id, body) => { const g = findGroup(id); if (!g) throw httpError(404, 'Lifegroup not found.'); const data = validateGroup(body || {}, g); checkGenderRules(data, g.id); Object.assign(g, data, { updated_at: nowSql() }); save(); return groupShape(g); }),
  deleteLifegroup: async_((id) => { const d = load(); const g = findGroup(id); if (!g) throw httpError(404, 'Lifegroup not found.'); if (d.memberships.some((m) => m.lifegroup_id === g.id)) throw httpError(409, 'This Lifegroup has membership history and cannot be deleted. Mark it inactive instead.'); d.lifegroups = d.lifegroups.filter((x) => x !== g); save(); return null; }),
  assignLifegroup: async_((groupId, personId, extra = {}) => assignGroup(groupId, personId, extra)),
  leaveLifegroup: async_((groupId, personId, leftAt) => {
    const d = load(); const cur = d.memberships.find((m) => m.person_id === Number(personId) && m.lifegroup_id === Number(groupId) && !m.left_at);
    if (!cur) throw httpError(404, 'No current membership in that group.');
    const date = leftAt || today(); if (!isValidDate(date)) throw httpError(400, 'Left date must be a valid date.');
    cur.left_at = date; save(); return membershipFor(personId);
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
    const d = load(); const n = Number(id);
    if (!findPerson(n)) throw httpError(404, 'Person not found.');
    d.people = d.people.filter((p) => p.id !== n); d.records = d.records.filter((r) => r.person_id !== n); d.audit = d.audit.filter((a) => a.person_id !== n); d.memberships = d.memberships.filter(m => m.person_id !== n); d.lifegroups.forEach(g => {if(g.leader_person_id === n) g.leader_person_id = null;}); d.networks.forEach(g => {if(g.leader_person_id === n) g.leader_person_id = null;});
    save(); return {};
  }),

  // services / attendance
  services: async_((params = {}) => { let rows = summaries(params).reverse(); if (params.limit) rows = rows.slice(0, Number(params.limit)); return rows; }),
  serviceByDate: async_((date) => {
    if (!isSunday(date)) throw httpError(400, 'Lifegen attendance is Sunday only — please choose a Sunday.');
    const s = load().services.find((x) => x.service_date === date);
    return s ? { exists: true, service: summary(s) } : { exists: false, service_date: date };
  }),
  service: async_((id) => { const s = findService(id); if (!s) throw httpError(404, 'Service not found.'); return { ...summary(s), roster: roster(s) }; }),
  serviceAudit: async_((id) => load().audit.filter((a) => a.service_id === Number(id)).sort((a, b) => b.id - a.id).map((a) => { const p = findPerson(a.person_id); return { ...a, first_name: p?.first_name, last_name: p?.last_name, person_code: p?.person_code, user_name: a.user_name || 'Imported staff' }; })),
  openService: async_((service_date) => {
    if (!isSunday(service_date)) throw httpError(400, 'Lifegen attendance is Sunday only — please choose a Sunday.');
    if (service_date > today()) throw httpError(400, 'Future Sundays cannot be recorded yet.');
    const d = load(); let s = d.services.find((x) => x.service_date === service_date);
    if (!s) { s = { id: nextId('services'), service_date, service_type: 'lifegen', notes: null, is_demo: 0, created_at: nowSql(), updated_at: nowSql() }; d.services.push(s); save(); }
    return summary(s);
  }),
  updateService: async_((id, body) => { const s = findService(id); if (!s) throw httpError(404, 'Service not found.'); s.notes = clean(body?.notes); s.updated_at = nowSql(); save(); return summary(s); }),
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
      if (status === 'present') promoteVipMemberIfEligible(p.id);
      return { record: { ...r, recorded_by_name: ADMIN.display_name }, summary: summary(s), already_marked: true };
    }
    if (r) Object.assign(r, { status, classification, recorded_by: ADMIN.id, recorded_by_name: ADMIN.display_name, source: 'staff', updated_at: nowSql() });
    else { r = { id: nextId('records'), service_id: s.id, person_id: p.id, status, classification, recorded_by: ADMIN.id, recorded_by_name: ADMIN.display_name, source: 'staff', recorded_at: nowSql(), updated_at: nowSql() }; d.records.push(r); }
    audit({ service_id: s.id, person_id: p.id, action: old ? 'update' : 'mark', old_status: old?.status || null, new_status: status, old_classification: old?.classification || null, new_classification: classification });
    if (status === 'present') { if (!p.date_first_attended || p.date_first_attended > s.service_date) p.date_first_attended = s.service_date; promoteVipMemberIfEligible(p.id); }
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
  dashboard: async_(() => {
    const d = load(); const now = today(); const year = Number(now.slice(0, 4)); const month = Number(now.slice(5, 7)); const quarter = quarterOf(now);
    const all = summaries(); const latest = all.at(-1) || null; const previous = all.length > 1 ? all.at(-2) : null;
    const mr = monthRange(year, month), qr = quarterRange(year, quarter);
    const monthRows = all.filter((r) => r.service_date >= mr.from && r.service_date <= mr.to);
    const quarterRows = all.filter((r) => r.service_date >= qr.from && r.service_date <= qr.to);
    const yearRows = all.filter((r) => r.service_date.startsWith(String(year)));
    return {
      today: now,
      people: { total: d.people.length, active: d.people.filter((p) => p.status !== 'inactive').length, inactive: d.people.filter((p) => p.status === 'inactive').length,
        first_timers: d.people.filter((p) => p.status === 'first_timer').length, registered_this_month: d.people.filter((p) => p.date_registered.slice(0, 7) === now.slice(0, 7)).length },
      services_recorded: all.length, latest, previous,
      change_vs_previous: latest && previous ? latest.present_count - previous.present_count : null,
      month: { label: mr.from.slice(0, 7), ...aggregate(monthRows) },
      quarter: { label: `Q${quarter} ${year}`, quarter, year, ...aggregate(quarterRows) },
      year: { label: String(year), ...aggregate(yearRows) },
      weekly: all.slice(-12), trend: all.slice(-26), monthly: monthlyBreakdown(yearRows), recent: all.slice(-8).reverse(),
      average_attendance: yearRows.length ? aggregate(yearRows).average_attendance : (all.length ? aggregate(all.slice(-8)).average_attendance : null),
      demo_loaded: demoStatus().loaded, pending_registrations: (d.vip_registrations || []).filter(r => r.review_status === 'new').length, latest_vips: (d.vip_registrations || []).slice().sort((a,b)=>b.id-a.id).slice(0,6).map(r => {const p=findPerson(r.person_id); return {id:r.id,person_id:r.person_id,name:p?fullNameSafe(p):'Unknown',created_at:r.created_at,review_status:r.review_status};}),
      lifegroups: lgOverview(), needs_lifegroup: needsList().slice(0, 6),
    };
  }),
  reportSummary: async_((params = {}) => {
    const range = resolveRange(params); const rows = summaries(range); const d = load();
    const ids = new Set(rows.map((r) => r.id));
    const uniq = new Set(d.records.filter((r) => r.status === 'present' && ids.has(r.service_id)).map((r) => r.person_id)).size;
    const newReg = d.people.filter((p) => (!range.from || p.date_registered >= range.from) && (!range.to || p.date_registered <= range.to)).length;
    return { range, totals: { ...aggregate(rows), unique_attendees: uniq, new_registrations: newReg }, weekly: rows, monthly: monthlyBreakdown(rows) };
  }),
  reportYears: async_(() => { const ys = [...new Set(load().services.map((s) => Number(s.service_date.slice(0, 4))))].sort((a, b) => b - a); const cur = new Date().getFullYear(); if (!ys.includes(cur)) ys.unshift(cur); return ys; }),
  search: async_((q, extra = {}) => { q = clean(q); if (!q || q.length < 2) return { people: [] }; const sex = ['male', 'female'].includes(extra.sex) ? extra.sex : null; return { people: listPeople({ q, status: 'all' }).filter((p) => !p.archived_at && (!sex || p.sex === sex)).sort((a, b) => (a.status === 'inactive') - (b.status === 'inactive') || byName(a, b)).slice(0, 12) }; }),

  saveSettings: async_((data) => { const d = load(); for (const k of ['church_name', 'service_name', 'church_address', 'church_contact', 'privacy_contact']) if (data?.[k] !== undefined) { const v = clean(data[k]) || ''; if (!v && (k === 'church_name' || k === 'service_name')) throw httpError(400, `${k.replace('_', ' ')} cannot be empty.`); if (v.length > 300) throw httpError(400, `${k.replace('_', ' ')} is too long (max 300 characters).`); d.settings[k] = v; } save(); return { ...d.settings }; }),
  demoStatus: async_(demoStatus), demoLoad: async_(demoLoad), demoRemove: async_(demoRemove),
  get: async_(url => { if (String(url).endsWith('/lifegroups/overview')) return lgOverview(); throw httpError(404,'Unknown resource.'); }),
  exportCsv: async_(exportCsv), snapshot: async_(() => structuredClone(load())),
};
export { httpError, today, nowSql, isValidDate, isSunday, monthRange, fullNameSafe, migrateNetworkText, migrateGenders, resolveRange };
function fullNameSafe(p) { return p.full_name || [p.first_name,p.last_name].filter(Boolean).join(' '); }
