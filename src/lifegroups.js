import { recommendEligibleCells } from './lifegroup-match.js';
import { allocateId, logAction, query, transaction } from './db.js';
import { httpError, today } from './domain.js';

const SEX_OF = { boys: 'male', girls: 'female' };
const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const SOLID_TARGET = 6; // Attendance target, not a membership capacity.
export const NETWORK_CELL_LEADER_LIMIT = 12;
export const CELL_MEMBER_LIMIT = 12;
const clean = (value) => value == null ? null : String(value).trim() || null;
const asId = (value, label = 'ID') => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, `Invalid ${label}.`);
  return id;
};
const asBool = (value, fallback = false) => value === undefined ? fallback : value === true || value === 1 || value === '1' || value === 'true';
const dateOk = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const dayParts = (value) => String(value || '').slice(0, 10).split('-').map(Number);
const addDays = (value, count) => {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};
function mondayOf(value) {
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
function recentWeeks(count, from = today()) {
  const end = mondayOf(from);
  return Array.from({ length: count }, (_, i) => addDays(end, (i - count + 1) * 7));
}
function stringField(value, label, { required = false, max = 200 } = {}) {
  const out = clean(value);
  if (required && !out) throw httpError(400, `${label} is required.`);
  if (out && out.length > max) throw httpError(400, `${label} must be ${max} characters or fewer.`);
  return out;
}
function optionalId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return asId(value, label);
}

export function validateGroupInput(body = {}, existing = null) {
  const src = existing ? { ...existing, ...body } : body;
  const data = {
    name: stringField(src.name, 'Group name', { required: true, max: 120 }),
    gender: clean(src.gender),
    leader_person_id: optionalId(src.leader_person_id, 'leader ID'),
    leader_name: stringField(src.leader_name, 'Leader name', { max: 200 }),
    network_id: optionalId(src.network_id, 'network ID'),
    network_manual: asBool(src.network_manual, Boolean(src.network_id)),
    network: stringField(src.network, 'Network name', { max: 120 }),
    area: stringField(src.area, 'Area', { max: 120 }),
    schedule_day: clean(src.schedule_day),
    schedule_time: clean(src.schedule_time),
    category: stringField(src.category, 'Category', { max: 120 }),
    capacity: src.capacity === '' || src.capacity == null ? null : Number(src.capacity),
    venue: stringField(src.venue, 'Venue', { max: 200 }),
    notes: stringField(src.notes, 'Notes', { max: 2000 }),
    is_active: asBool(src.is_active, existing?.is_active ?? true),
    is_demo: asBool(src.is_demo, existing?.is_demo ?? false),
  };
  if (!['boys', 'girls'].includes(data.gender)) throw httpError(400, 'Choose whether this is a boys or girls Lifegroup.');
  if (data.schedule_day && !DAYS.has(data.schedule_day)) throw httpError(400, 'Choose a valid meeting day.');
  if (data.schedule_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.schedule_time)) throw httpError(400, 'Meeting time must use HH:MM.');
  if (data.capacity !== null && (!Number.isInteger(data.capacity) || data.capacity < 1 || data.capacity > 999)) throw httpError(400, 'Capacity must be a whole number from 1 to 999, or blank.');
  if (data.leader_person_id && data.leader_name) data.leader_name = null;
  return data;
}

export function validateNetworkInput(body = {}, existing = null) {
  const src = existing ? { ...existing, ...body } : body;
  const data = {
    name: stringField(src.name, 'Network name', { required: true, max: 120 }),
    gender: clean(src.gender),
    leader_person_id: optionalId(src.leader_person_id, 'leader ID'),
    leader_name: stringField(src.leader_name, 'Leader name', { max: 200 }),
    notes: stringField(src.notes, 'Notes', { max: 2000 }),
    is_active: asBool(src.is_active, existing?.is_active ?? true),
    is_demo: asBool(src.is_demo, existing?.is_demo ?? false),
  };
  if (!['boys', 'girls'].includes(data.gender)) throw httpError(400, 'Choose whether this is a boys or girls network.');
  for (const key of ['parent_network_id', 'parent_id', 'parent']) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '' && body[key] !== 0 && body[key] !== '0') {
      throw httpError(400, 'Networks are independent; they cannot be nested.');
    }
  }
  if (data.leader_person_id && data.leader_name) data.leader_name = null;
  return data;
}

export function validateTier(value) {
  const tier = clean(value);
  if (!['new', 'solid'].includes(tier)) throw httpError(400, 'Choose Open cell or Closed cell.');
  return tier;
}

const GROUP_SELECT = `
 SELECT g.*,
   coalesce(nullif(concat_ws(' ', lp.first_name, lp.last_name), ''), g.leader_name) AS leader_display,
   n.name AS network_name,
   lp.photo AS leader_photo,
   lp.extras->>'facebook_url' AS leader_facebook_url,
   lp.extras->>'instagram_url' AS leader_instagram_url,
   lp.extras->>'tiktok_url' AS leader_tiktok_url,
   lp.extras->>'x_url' AS leader_x_url,
   lp.extras->>'youtube_url' AS leader_youtube_url,
   n.leader_person_id AS network_leader_person_id,
   coalesce(nullif(concat_ws(' ', nlp.first_name, nlp.last_name), ''), n.leader_name) AS network_leader_name,
   (SELECT count(*)::int FROM lifegroup_memberships m JOIN people p ON p.id=m.person_id
      WHERE m.lifegroup_id=g.id AND m.left_at IS NULL AND p.archived_at IS NULL) AS member_count,
   (SELECT count(*)::int FROM lifegroup_memberships m JOIN people p ON p.id=m.person_id
      WHERE m.lifegroup_id=g.id AND m.left_at IS NULL AND p.archived_at IS NULL AND m.tier='solid') AS solid_count,
   (SELECT max(mt.meeting_date)::text FROM lifegroup_meetings mt WHERE mt.lifegroup_id=g.id AND mt.held) AS last_held,
   (SELECT max(mt.meeting_date)::text FROM lifegroup_meetings mt WHERE mt.lifegroup_id=g.id) AS last_report,
   EXISTS(SELECT 1 FROM networks xn WHERE xn.leader_person_id=g.leader_person_id AND xn.is_active) AS leads_network
 FROM lifegroups g
 LEFT JOIN people lp ON lp.id=g.leader_person_id
 LEFT JOIN networks n ON n.id=g.network_id
 LEFT JOIN people nlp ON nlp.id=n.leader_person_id`;

function shapeGroup(row) {
  if (!row) return null;
  const out = {
    ...row,
    id: Number(row.id),
    leader_person_id: row.leader_person_id == null ? null : Number(row.leader_person_id),
    network_id: row.network_id == null ? null : Number(row.network_id),
    network_leader_person_id: row.network_leader_person_id == null ? null : Number(row.network_leader_person_id),
    leader_name: row.leader_display || row.leader_name || null,
    network_leader_name: row.network_leader_name || null,
    network: row.network_name || row.network || null,
    network_manual: Boolean(row.network_manual),
    schedule_time: row.schedule_time ? String(row.schedule_time).slice(0, 5) : null,
    member_count: Number(row.member_count || 0),
    solid_count: Number(row.solid_count || 0),
    open_count: Number(row.member_count || 0) - Number(row.solid_count || 0),
    solid_target: SOLID_TARGET,
    slots: Math.max(Math.min(row.capacity == null ? CELL_MEMBER_LIMIT : Number(row.capacity),CELL_MEMBER_LIMIT) - Number(row.member_count || 0), 0),
    max_members: Boolean(row.leads_network) ? NETWORK_CELL_LEADER_LIMIT : CELL_MEMBER_LIMIT,
    is_active: Boolean(row.is_active),
    is_demo: Boolean(row.is_demo),
    leads_network: Boolean(row.leads_network),
  };
  delete out.leader_display;
  return out;
}

async function listGroups(filters = {}) {
  const q = clean(filters.q);
  const gender = ['boys', 'girls'].includes(filters.gender) ? filters.gender : null;
  const status = ['active', 'inactive', 'all'].includes(filters.status) ? filters.status : 'active';
  const networkId = filters.network_id ? asId(filters.network_id, 'network ID') : null;
  const { rows } = await query(`${GROUP_SELECT}
    WHERE ($1::text IS NULL OR g.name ILIKE $1 OR coalesce(g.area,'') ILIKE $1 OR coalesce(n.name,'') ILIKE $1
      OR coalesce(lp.first_name || ' ' || lp.last_name,'') ILIKE $1 OR coalesce(g.leader_name,'') ILIKE $1)
      AND ($2::text IS NULL OR g.gender=$2)
      AND ($3::text='all' OR ($3::text='active' AND g.is_active) OR ($3::text='inactive' AND NOT g.is_active))
      AND ($4::bigint IS NULL OR g.network_id=$4)
    ORDER BY g.is_active DESC,g.gender,g.name`, [q ? `%${q}%` : null, gender, status, networkId]);
  return rows.map(shapeGroup);
}

async function listNetworks(filters = {}) {
  const status = ['active', 'inactive', 'all'].includes(filters.status) ? filters.status : 'active';
  const gender = ['boys', 'girls'].includes(filters.gender) ? filters.gender : null;
  const { rows } = await query(`SELECT n.*,
      coalesce(nullif(concat_ws(' ',lp.first_name,lp.last_name),''),n.leader_name) AS leader_display,
      lp.photo AS leader_photo, lp.extras->>'facebook_url' AS leader_facebook_url, lp.extras->>'instagram_url' AS leader_instagram_url, lp.extras->>'tiktok_url' AS leader_tiktok_url, lp.extras->>'x_url' AS leader_x_url, lp.extras->>'youtube_url' AS leader_youtube_url,
      (SELECT count(*)::int FROM lifegroups g WHERE g.network_id=n.id AND g.is_active) AS group_count,
      (SELECT count(*)::int FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id JOIN people p ON p.id=m.person_id
        WHERE g.network_id=n.id AND g.is_active AND m.left_at IS NULL AND p.archived_at IS NULL) AS people_count,
      (SELECT count(*)::int FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id JOIN people p ON p.id=m.person_id
        WHERE g.network_id=n.id AND g.is_active AND m.left_at IS NULL AND p.archived_at IS NULL AND p.sex='male') AS boys,
      (SELECT count(*)::int FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id JOIN people p ON p.id=m.person_id
        WHERE g.network_id=n.id AND g.is_active AND m.left_at IS NULL AND p.archived_at IS NULL AND p.sex='female') AS girls,
      (SELECT count(*)::int FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id
        WHERE g.network_id=n.id AND g.is_active AND m.left_at IS NULL AND m.tier='solid') AS closed_cell,
      (SELECT count(*)::int FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id
        WHERE g.network_id=n.id AND g.is_active AND m.left_at IS NULL AND m.tier<>'solid') AS open_cell,
      (SELECT count(*)::int FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id
        WHERE g.network_id=n.id AND g.is_active AND m.left_at IS NULL AND g.leader_person_id=n.leader_person_id) AS cell_leaders,
      (SELECT max(mt.meeting_date)::text FROM lifegroup_meetings mt JOIN lifegroups g ON g.id=mt.lifegroup_id
        WHERE g.network_id=n.id AND mt.held) AS last_held
    FROM networks n LEFT JOIN people lp ON lp.id=n.leader_person_id
    WHERE ($1::text='all' OR ($1::text='active' AND n.is_active) OR ($1::text='inactive' AND NOT n.is_active))
      AND ($2::text IS NULL OR n.gender=$2)
    ORDER BY n.is_active DESC,n.gender,n.name`, [status, gender]);
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    leader_person_id: r.leader_person_id == null ? null : Number(r.leader_person_id),
    leader_name: r.leader_display || r.leader_name || null,
    group_count: Number(r.group_count || 0),
    people_count: Number(r.people_count || 0),
    boys: Number(r.boys || 0),
    girls: Number(r.girls || 0),
    closed_cell: Number(r.closed_cell || 0),
    open_cell: Number(r.open_cell || 0),
    cell_leaders: Number(r.cell_leaders || 0),
    is_active: Boolean(r.is_active),
    is_demo: Boolean(r.is_demo),
    total_groups: Number(r.group_count || 0),
    total_people: Number(r.people_count || 0),
  })).map(({ leader_display, ...r }) => r);
}

async function activeMembers(groupId) {
  const { rows } = await query(`SELECT p.id,p.person_code,p.first_name,p.last_name,p.full_name,p.photo,p.extras->>'facebook_url' AS facebook_url,p.extras->>'instagram_url' AS instagram_url,p.extras->>'tiktok_url' AS tiktok_url,p.extras->>'x_url' AS x_url,p.extras->>'youtube_url' AS youtube_url,p.sex,p.status,p.archived_at,
      m.id AS membership_id,m.role,m.tier,m.joined_at::text AS joined_at,m.notes AS membership_notes,
      stats.sundays_attended,stats.last_attended,
      v.id AS vip_registration_id,v.review_status AS vip_review_status,v.created_at AS vip_registered_at,
      (v.id IS NOT NULL) AS is_vip
    FROM lifegroup_memberships m JOIN people p ON p.id=m.person_id
    LEFT JOIN LATERAL (SELECT count(*)::int AS sundays_attended,max(s.service_date)::text AS last_attended
      FROM records r JOIN services s ON s.id=r.service_id WHERE r.person_id=p.id AND r.status='present') stats ON true
    LEFT JOIN LATERAL (SELECT id,review_status,created_at FROM vip_registrations vr WHERE vr.person_id=p.id ORDER BY vr.created_at DESC,vr.id DESC LIMIT 1) v ON true
    WHERE m.lifegroup_id=$1 AND m.left_at IS NULL AND p.archived_at IS NULL
    ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END,lower(p.last_name),lower(p.first_name),p.id`, [groupId]);
  return rows.map((r) => ({ ...r, id: Number(r.id), membership_id: Number(r.membership_id), is_vip: Boolean(r.is_vip), sundays_attended: Number(r.sundays_attended || 0) }));
}

async function formerMembers(groupId) {
  const { rows } = await query(`SELECT p.id,p.person_code,p.first_name,p.last_name,p.full_name,p.sex,p.status,
      m.id AS membership_id,m.role,m.tier,m.joined_at::text AS joined_at,m.left_at::text AS left_at
    FROM lifegroup_memberships m JOIN people p ON p.id=m.person_id
    WHERE m.lifegroup_id=$1 AND m.left_at IS NOT NULL
    ORDER BY m.left_at DESC,m.id DESC LIMIT 100`, [groupId]);
  return rows.map((r) => ({ ...r, id: Number(r.id), membership_id: Number(r.membership_id) }));
}

async function getGroup(id) {
  const groups = await listGroups({ status: 'all' });
  const group = groups.find((g) => g.id === Number(id));
  if (!group) throw httpError(404, 'Lifegroup not found.');
  const [members, former] = await Promise.all([activeMembers(group.id), formerMembers(group.id)]);
  let led_groups = [];
  if (group.leads_network && group.network_id) {
    const children = await listGroups({ status: 'all', network_id: group.network_id });
    const memberIds = new Set(members.map((m) => m.id));
    led_groups = children.filter((g) => g.id !== group.id && memberIds.has(g.leader_person_id));
  }
  return { ...group, members, former, led_groups, max_members: group.leads_network ? NETWORK_CELL_LEADER_LIMIT : group.max_members, solid_target: SOLID_TARGET };
}

async function membershipForPerson(personId) {
  const { rows } = await query(`SELECT m.id,m.person_id,m.lifegroup_id,m.role,m.tier,m.joined_at::text AS joined_at,m.left_at::text AS left_at,
      m.notes,g.name AS lifegroup_name,g.gender,g.network_id,n.name AS network_name
    FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id
    LEFT JOIN networks n ON n.id=g.network_id WHERE m.person_id=$1 ORDER BY m.left_at IS NOT NULL,m.joined_at DESC,m.id DESC`, [personId]);
  const history = rows.map((r) => ({ ...r, id: Number(r.id), person_id: Number(r.person_id), lifegroup_id: Number(r.lifegroup_id), network_id: r.network_id == null ? null : Number(r.network_id) }));
  return { current: history.find((r) => !r.left_at) || null, history };
}

async function needsLifegroup(filters = {}) {
  const q = clean(filters.q);
  const limit = Math.max(1, Math.min(Number(filters.limit) || 500, 1000));
  const { rows } = await query(`SELECT p.id,p.person_code,p.first_name,p.last_name,p.full_name,p.photo,p.sex,p.status,p.age,p.school,p.inviter,
      p.date_registered::text AS date_registered,p.date_first_attended::text AS date_first_attended,
      stats.sundays_attended,stats.last_attended,
      v.id AS vip_registration_id,v.review_status AS vip_review_status,v.created_at AS vip_registered_at,
      (v.id IS NOT NULL) AS is_vip
    FROM people p
    LEFT JOIN LATERAL (SELECT count(*)::int AS sundays_attended,max(s.service_date)::text AS last_attended
      FROM records r JOIN services s ON s.id=r.service_id WHERE r.person_id=p.id AND r.status='present') stats ON true
    LEFT JOIN LATERAL (SELECT id,review_status,created_at FROM vip_registrations vr WHERE vr.person_id=p.id ORDER BY vr.created_at DESC,vr.id DESC LIMIT 1) v ON true
    WHERE p.archived_at IS NULL AND p.status<>'inactive'
      AND NOT EXISTS(SELECT 1 FROM lifegroup_memberships m WHERE m.person_id=p.id AND m.left_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM networks n WHERE n.leader_person_id=p.id AND n.is_active)
      AND ($1::text IS NULL OR concat_ws(' ',p.first_name,p.last_name) ILIKE $1 OR p.person_code ILIKE $1
        OR coalesce(p.inviter,'') ILIKE $1 OR coalesce(p.school,'') ILIKE $1)
    ORDER BY (v.id IS NOT NULL) DESC,v.created_at DESC NULLS LAST,stats.last_attended DESC NULLS LAST,p.date_registered DESC,p.id DESC
    LIMIT $2`, [q ? `%${q}%` : null, limit]);
  return rows.map((r) => ({ ...r, id: Number(r.id), sundays_attended: Number(r.sundays_attended || 0), is_vip: Boolean(r.is_vip), vip_registration_id: r.vip_registration_id == null ? null : Number(r.vip_registration_id) }));
}

async function overview() {
  const { rows } = await query(`SELECT
    (SELECT count(*)::int FROM lifegroups) AS total_groups,
    (SELECT count(*)::int FROM lifegroups WHERE is_active) AS active_groups,
    (SELECT count(*)::int FROM networks) AS total_networks,
    (SELECT count(*)::int FROM networks WHERE is_active) AS active_networks,
    (SELECT count(*)::int FROM lifegroup_memberships m JOIN people p ON p.id=m.person_id JOIN lifegroups g ON g.id=m.lifegroup_id
      WHERE m.left_at IS NULL AND p.archived_at IS NULL AND g.is_active) AS active_members,
    (SELECT count(*)::int FROM people p WHERE p.archived_at IS NULL AND p.status<>'inactive'
      AND NOT EXISTS(SELECT 1 FROM lifegroup_memberships m WHERE m.person_id=p.id AND m.left_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM networks n WHERE n.leader_person_id=p.id AND n.is_active)) AS people_needing_group,
    (SELECT count(DISTINCT v.person_id)::int FROM vip_registrations v JOIN people p ON p.id=v.person_id
      WHERE p.archived_at IS NULL AND p.status<>'inactive'
      AND NOT EXISTS(SELECT 1 FROM lifegroup_memberships m WHERE m.person_id=p.id AND m.left_at IS NULL)) AS vip_needing_group`);
  return Object.fromEntries(Object.entries(rows[0] || {}).map(([k, v]) => [k, Number(v || 0)]));
}

async function trackerOverview() {
  const [stats, groups, networks] = await Promise.all([overview(),listGroups(),listNetworks()]);
  const structure = {};
  for (const gender of ['boys','girls']) {
    const gs = groups.filter((g) => g.gender === gender);
    const ns = networks.filter((n) => n.gender === gender);
    structure[gender] = {
      networks: ns.length,
      cell_leaders: ns.reduce((sum,n) => sum + Number(n.cell_leaders || 0),0),
      lifegroups: gs.length,
      members: gs.reduce((sum,g) => sum + g.member_count,0),
      open_cell: gs.reduce((sum,g) => sum + g.open_count,0),
      closed_cell: gs.reduce((sum,g) => sum + g.solid_count,0),
    };
  }
  return { ...stats, without_group: stats.people_needing_group, structure };
}

async function options() {
  const [networks, areas, categories] = await Promise.all([
    listNetworks(),
    query("SELECT DISTINCT area AS value FROM lifegroups WHERE nullif(btrim(area),'') IS NOT NULL ORDER BY area"),
    query("SELECT DISTINCT category AS value FROM lifegroups WHERE nullif(btrim(category),'') IS NOT NULL ORDER BY category"),
  ]);
  return { networks: networks.map((n) => ({ id: n.id, name: n.name, gender: n.gender, leader_name: n.leader_name })),
    areas: areas.rows.map((r) => r.value), categories: categories.rows.map((r) => r.value),
    days: [...DAYS], times: ['morning', 'afternoon', 'evening'] };
}

async function validateLeader(client, personId, gender, kind) {
  if (!personId) return null;
  const person = (await client.query('SELECT id,first_name,last_name,sex,archived_at FROM people WHERE id=$1', [personId])).rows[0];
  if (!person || person.archived_at) throw httpError(400, `${kind} leader must be an active registered person.`);
  if (person.sex && person.sex !== SEX_OF[gender]) {
    throw httpError(400, `${person.first_name} ${person.last_name} does not match the selected ${gender} ${kind}.`);
  }
  return person;
}

async function validateGroupReferences(client, data, groupId = null) {
  const leader = await validateLeader(client, data.leader_person_id, data.gender, 'Lifegroup');
  if (data.network_id) {
    const network = (await client.query('SELECT id,name,gender,is_active FROM networks WHERE id=$1', [data.network_id])).rows[0];
    if (!network) throw httpError(400, 'Selected network was not found.');
    if (network.gender !== data.gender) throw httpError(400, `${network.name} is a ${network.gender} network; choose a ${data.gender} network.`);
  }
  if (groupId) {
    const mismatched = Number((await client.query(`SELECT count(*)::int AS n FROM lifegroup_memberships m JOIN people p ON p.id=m.person_id
      WHERE m.lifegroup_id=$1 AND m.left_at IS NULL AND p.archived_at IS NULL AND p.sex IS NOT NULL AND p.sex<>$2`, [groupId, SEX_OF[data.gender]])).rows[0].n);
    if (mismatched) throw httpError(409, `This group has ${mismatched} current member(s) whose profile gender does not match. Move them first.`);
  }
  return leader;
}

async function saveGroup(body, actor, id = null) {
  return transaction(async (client) => {
    const existing = id ? (await client.query('SELECT * FROM lifegroups WHERE id=$1 FOR UPDATE', [id])).rows[0] : null;
    if (id && !existing) throw httpError(404, 'Lifegroup not found.');
    const data = validateGroupInput(body, existing);
    await validateGroupReferences(client, data, id);
    if (data.network_id && data.leader_person_id && data.is_active) {
      const network = (await client.query('SELECT leader_person_id FROM networks WHERE id=$1', [data.network_id])).rows[0];
      if (network && Number(network.leader_person_id) !== Number(data.leader_person_id)) {
        const used = Number((await client.query(`SELECT count(*)::int AS n FROM lifegroups
          WHERE network_id=$1 AND is_active AND id<>coalesce($2,0)
            AND (leader_person_id IS DISTINCT FROM $3)`,
          [data.network_id,id,network.leader_person_id])).rows[0].n);
        if (used >= NETWORK_CELL_LEADER_LIMIT) throw httpError(409,'Network has reached its 12 Cell Leader limit.');
        const duplicate = (await client.query(`SELECT id FROM lifegroups WHERE network_id=$1 AND is_active
          AND leader_person_id=$2 AND id<>coalesce($3,0) LIMIT 1`,
          [data.network_id,data.leader_person_id,id])).rows[0];
        if (duplicate) throw httpError(409,'This Cell Leader already leads a Cell in the Network.');
      }
    }
    if (id) {
      const { rows } = await client.query(`UPDATE lifegroups SET name=$1,gender=$2,leader_person_id=$3,leader_name=$4,network_id=$5,
        network_manual=$6,network=$7,area=$8,schedule_day=$9,schedule_time=$10,category=$11,capacity=$12,venue=$13,notes=$14,
        is_active=$15,updated_at=now() WHERE id=$16 RETURNING id`, [data.name,data.gender,data.leader_person_id,data.leader_name,
        data.network_id,data.network_manual,data.network,data.area,data.schedule_day,data.schedule_time,data.category,data.capacity,
        data.venue,data.notes,data.is_active,id]);
      await logAction(client, actor, 'lifegroups', id, 'update', { name: data.name, gender: data.gender });
      return Number(rows[0].id);
    }
    const newId = await allocateId(client, 'lifegroups');
    await client.query(`INSERT INTO lifegroups(id,name,gender,leader_person_id,leader_name,network_id,network_manual,network,area,
      schedule_day,schedule_time,category,capacity,venue,notes,is_active,is_demo,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [newId,data.name,data.gender,data.leader_person_id,
      data.leader_name,data.network_id,data.network_manual,data.network,data.area,data.schedule_day,data.schedule_time,data.category,
      data.capacity,data.venue,data.notes,data.is_active,data.is_demo,actor?.id || null]);
    await logAction(client, actor, 'lifegroups', newId, 'create', { name: data.name, gender: data.gender });
    return newId;
  });
}


/**
 * New Network editor: one registered Network Leader, one category, up to 12
 * Cell Leaders, each with up to 12 Members. No user-entered Network name or
 * separate Lifegroup step. Validate before writing any data.
 */
export function validateNetworkStructureInput(body = {}) {
  const gender = clean(body.gender);
  if (!['boys','girls'].includes(gender)) throw httpError(400, 'Select a gender.');
  const leader_person_id = asId(body.leader_person_id, 'Network Leader');
  const cells = body.cell_leaders == null ? [] : body.cell_leaders;
  if (!Array.isArray(cells) || cells.length > NETWORK_CELL_LEADER_LIMIT) {
    throw httpError(400, 'A Network can have up to 12 Cell Leaders.');
  }
  const selected = new Set([leader_person_id]);
  const normalized = cells.map((cell, i) => {
    const leaderId = asId(cell?.person_id, 'Cell Leader');
    if (selected.has(leaderId)) throw httpError(400, 'A person can be selected only once in the Network.');
    selected.add(leaderId);
    const members = cell?.members == null ? [] : cell.members;
    if (!Array.isArray(members) || members.length > CELL_MEMBER_LIMIT) {
      throw httpError(400, 'Each Cell Leader can have up to 12 Members.');
    }
    const ids = members.map(value => asId(value,'Member'));
    for (const id of ids) {
      if (selected.has(id)) throw httpError(400, 'A person can be selected only once in the Network.');
      selected.add(id);
    }
    return { person_id: leaderId, members: ids };
  });
  return {gender, leader_person_id, cell_leaders: normalized, person_ids: [...selected]};
}

async function createNetworkStructure(body, actor) {
  const input = validateNetworkStructureInput(body);
  return transaction(async client => {
    const { rows } = await client.query(
      'SELECT id,first_name,last_name,sex,archived_at FROM people WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',
      [input.person_ids]);
    const found = new Map(rows.map(p => [Number(p.id),p]));
    for (const id of input.person_ids) {
      const person = found.get(id);
      if (!person || person.archived_at) throw httpError(400,'Select an active registered person for every role.');
      if (person.sex && person.sex !== SEX_OF[input.gender]) {
        throw httpError(409, 'The selected people must match the Network gender.');
      }
    }
    const existingNetwork = (await client.query(
      'SELECT id FROM networks WHERE leader_person_id=ANY($1::int[]) AND is_active LIMIT 1',
      [input.person_ids])).rows[0];
    if (existingNetwork) throw httpError(409,'One of the selected people already leads an active Network.');
    const currentMemberships = (await client.query(
      'SELECT person_id FROM lifegroup_memberships WHERE person_id=ANY($1::int[]) AND left_at IS NULL LIMIT 1',
      [input.person_ids])).rows;
    if (currentMemberships.length) throw httpError(409,
      'One of the selected people is already assigned to a Cell. Move them separately before creating this Network.');
    const otherLeaders = (await client.query(
      'SELECT leader_person_id FROM lifegroups WHERE leader_person_id=ANY($1::int[]) AND is_active LIMIT 1',
      [input.person_ids])).rows;
    if (otherLeaders.length) throw httpError(409,'One of the selected people already leads a Cell.');
    for (const person of rows) {
      if (!person.sex) await client.query('UPDATE people SET sex=$1,updated_at=now() WHERE id=$2',
        [SEX_OF[input.gender],person.id]);
    }
    const nameOf = id => {
      const p=found.get(id);
      return [p.first_name,p.last_name].filter(Boolean).join(' ').trim()||'Leader';
    };
    const networkName = (nameOf(input.leader_person_id)+' Network').slice(0,120);
    const networkId = await allocateId(client,'networks');
    await client.query(
      'INSERT INTO networks(id,name,gender,leader_person_id,is_active,created_by) VALUES($1,$2,$3,$4,true,$5)',
      [networkId,networkName,input.gender,input.leader_person_id,actor?.id||null]);
    await logAction(client,actor,'networks',networkId,'create',{name:networkName,cell_leaders:input.cell_leaders.length});
    // Keep the existing relational reporting model: a hidden leader-team group
    // links the Network Leader to Cell Leaders, and separate cell-team groups
    // connect each Cell Leader to their Members.
    const teamId=await allocateId(client,'lifegroups');
    await client.query(
      'INSERT INTO lifegroups(id,name,gender,leader_person_id,network_id,network_manual,capacity,created_by) VALUES($1,$2,$3,$4,$5,false,$6,$7)',
      [teamId,(networkName+' Leaders').slice(0,120),input.gender,input.leader_person_id,networkId,NETWORK_CELL_LEADER_LIMIT,actor?.id||null]);
    await logAction(client,actor,'lifegroups',teamId,'create',{network_leader_group:true});
    const createMembership=async (personId,groupId,role) => {
      const memberId=await allocateId(client,'lifegroup_memberships');
      await client.query(
        "INSERT INTO lifegroup_memberships(id,person_id,lifegroup_id,role,tier,joined_at,assigned_by) VALUES($1,$2,$3,$4,'new',$5,$6)",
        [memberId,personId,groupId,role,today(),actor?.id||null]);
      await logAction(client,actor,'lifegroup_memberships',memberId,'assign',{person_id:personId,lifegroup_id:groupId,role});
    };
    for (const cell of input.cell_leaders) {
      await createMembership(cell.person_id,teamId,'leader');
      const groupId=await allocateId(client,'lifegroups');
      const groupName=(nameOf(cell.person_id)+' Cell').slice(0,120);
      await client.query(
        'INSERT INTO lifegroups(id,name,gender,leader_person_id,network_id,network_manual,capacity,created_by) VALUES($1,$2,$3,$4,$5,true,$6,$7)',
        [groupId,groupName,input.gender,cell.person_id,networkId,CELL_MEMBER_LIMIT,actor?.id||null]);
      await logAction(client,actor,'lifegroups',groupId,'create',{name:groupName,network_id:networkId,leader_person_id:cell.person_id});
      for (const personId of cell.members) await createMembership(personId,groupId,'member');
    }
    return networkId;
  });
}

async function saveNetwork(body, actor, id = null) {
  return transaction(async (client) => {
    const existing = id ? (await client.query('SELECT * FROM networks WHERE id=$1 FOR UPDATE', [id])).rows[0] : null;
    if (id && !existing) throw httpError(404, 'Network not found.');
    const data = validateNetworkInput(body, existing);
    await validateLeader(client, data.leader_person_id, data.gender, 'network');
    if (data.leader_person_id) {
      const duplicate = (await client.query(`SELECT id,name FROM networks WHERE leader_person_id=$1 AND is_active AND id<>coalesce($2,0) LIMIT 1`, [data.leader_person_id,id])).rows[0];
      if (duplicate && data.is_active) throw httpError(409, `This person already leads ${duplicate.name}. A network leader can lead only one active network.`);
    }
    if (id) {
      const mismatch = Number((await client.query(`SELECT count(*)::int AS n FROM lifegroups WHERE network_id=$1 AND is_active AND gender<>$2`, [id,data.gender])).rows[0].n);
      if (mismatch) throw httpError(409, `Move the ${mismatch} mismatched Lifegroup(s) before changing this network's gender.`);
      await client.query(`UPDATE networks SET name=$1,gender=$2,leader_person_id=$3,leader_name=$4,notes=$5,is_active=$6,updated_at=now() WHERE id=$7`,
        [data.name,data.gender,data.leader_person_id,data.leader_name,data.notes,data.is_active,id]);
      await logAction(client, actor, 'networks', id, 'update', { name: data.name, gender: data.gender });
      return Number(id);
    }
    const newId = await allocateId(client, 'networks');
    await client.query(`INSERT INTO networks(id,name,gender,leader_person_id,leader_name,notes,is_active,is_demo,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [newId,data.name,data.gender,data.leader_person_id,data.leader_name,data.notes,data.is_active,data.is_demo,actor?.id || null]);
    await logAction(client, actor, 'networks', newId, 'create', { name: data.name, gender: data.gender });
    return newId;
  });
}

async function assignMember(groupId, personId, extra = {}, actor) {
  const result = await transaction(async (client) => {
    const group = (await client.query('SELECT * FROM lifegroups WHERE id=$1 FOR UPDATE', [groupId])).rows[0];
    if (!group) throw httpError(404, 'Lifegroup not found.');
    if (!group.is_active) throw httpError(409, 'This Lifegroup is inactive. Activate it before assigning members.');
    const person = (await client.query('SELECT id,first_name,last_name,person_code,sex,status,archived_at FROM people WHERE id=$1 FOR UPDATE', [personId])).rows[0];
    if (!person || person.archived_at) throw httpError(404, 'Active person not found.');
    const selectedSex = clean(extra.sex);
    let sex = person.sex;
    if (!sex && selectedSex) {
      if (!['male','female'].includes(selectedSex)) throw httpError(400, 'Choose Boy or Girl to continue.');
      sex = selectedSex;
    }
    if (!sex) throw httpError(400, 'Set Boy or Girl on this person’s profile before assigning a gender-specific Lifegroup.');
    if (sex !== SEX_OF[group.gender]) throw httpError(409, `${person.first_name} ${person.last_name} does not match this ${group.gender} Lifegroup.`);
    const joined = clean(extra.joined_at) || today();
    if (!dateOk(joined)) throw httpError(400, 'Joined date must be a valid date.');
    const roleInput = clean(extra.role);
    if (roleInput && !['member','leader','assistant'].includes(roleInput)) throw httpError(400, 'Choose a valid group role.');
    const tierInput = clean(extra.tier);
    if (tierInput && !['new','solid'].includes(tierInput)) throw httpError(400, 'Choose Open cell or Closed cell.');
    const networkLeadership = (await client.query('SELECT id,name FROM networks WHERE leader_person_id=$1 AND is_active LIMIT 1', [personId])).rows[0];
    if (networkLeadership && group.leader_person_id !== personId) {
      throw httpError(409, `${person.first_name} ${person.last_name} leads ${networkLeadership.name} and cannot be a member under another Lifegroup leader.`);
    }
    const current = (await client.query(`SELECT m.id,m.lifegroup_id,m.joined_at::text AS joined_at,m.role,m.tier,g.name AS group_name
      FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id
      WHERE m.person_id=$1 AND m.left_at IS NULL FOR UPDATE OF m`, [personId])).rows[0];
    const role = roleInput || current?.role || 'member';
    const tier = tierInput || current?.tier || 'new';
    if (current && Number(current.lifegroup_id) === groupId) {
      if (tier === 'solid' && current.tier !== 'solid') {
        const solidCount = Number((await client.query(
          "SELECT count(*)::int AS n FROM lifegroup_memberships WHERE lifegroup_id=$1 AND left_at IS NULL AND tier='solid'",[groupId]
        )).rows[0].n);
        if (solidCount >= SOLID_TARGET) throw httpError(409, 'Closed cell is already at its six-member target.');
      }
      const changed = current.role !== role || current.tier !== tier;
      if (sex !== person.sex) await client.query('UPDATE people SET sex=$1,updated_at=now() WHERE id=$2', [sex,personId]);
      if (changed) {
        await client.query('UPDATE lifegroup_memberships SET role=$1,tier=$2 WHERE id=$3', [role,tier,current.id]);
        await logAction(client, actor, 'lifegroup_memberships', current.id, 'role_or_tier_change', {
          person_id: personId, lifegroup_id: groupId,
          previous_role: current.role, role, previous_tier: current.tier, tier,
        });
      }
      return { unchanged: !changed && sex === person.sex };
    }
    if (current && !asBool(extra.confirm_move) && !asBool(extra.force_move)) {
      throw httpError(409, `This person is currently in ${current.group_name}. Confirm the move to continue.`, { current_group: current.group_name, current_group_id: Number(current.lifegroup_id) });
    }
    if (current && joined < String(current.joined_at).slice(0,10)) throw httpError(400, 'Move date cannot be before the existing membership began.');
    const leaderGroup = group.leader_person_id && (await client.query('SELECT id FROM networks WHERE id=$1 AND leader_person_id=$2 AND is_active', [group.network_id,group.leader_person_id])).rows[0];
    if (leaderGroup) {
      const leaders = Number((await client.query('SELECT count(*)::int AS n FROM lifegroup_memberships WHERE lifegroup_id=$1 AND left_at IS NULL', [groupId])).rows[0].n);
      if (leaders >= NETWORK_CELL_LEADER_LIMIT) throw httpError(409, 'Network has reached its 12 Cell Leader limit.');
    }
    if (!leaderGroup) {
      const members = Number((await client.query('SELECT count(*)::int AS n FROM lifegroup_memberships WHERE lifegroup_id=$1 AND left_at IS NULL', [groupId])).rows[0].n);
      if (members >= CELL_MEMBER_LIMIT) throw httpError(409, 'Cell Leader has reached the 12-member limit.');
    }
    if (tier === 'solid') {
      const solid = Number((await client.query("SELECT count(*)::int AS n FROM lifegroup_memberships WHERE lifegroup_id=$1 AND left_at IS NULL AND tier='solid'", [groupId])).rows[0].n);
      if (solid >= SOLID_TARGET) throw httpError(409, `Closed cell is already at its ${SOLID_TARGET}-member target. Add this person to the Open cell instead.`);
    }
    if (!person.sex && selectedSex) await client.query('UPDATE people SET sex=$1,updated_at=now() WHERE id=$2', [sex,personId]);
    if (current) await client.query('UPDATE lifegroup_memberships SET left_at=$1 WHERE id=$2', [joined,current.id]);
    const membershipId = await allocateId(client, 'lifegroup_memberships');
    await client.query(`INSERT INTO lifegroup_memberships(id,person_id,lifegroup_id,role,tier,joined_at,notes,assigned_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [membershipId,personId,groupId,role,tier,joined,stringField(extra.notes,'Notes',{max:1000}),actor?.id || null]);
    await logAction(client, actor, 'lifegroup_memberships', membershipId, current ? 'move' : 'assign', {
      person_id: personId, lifegroup_id: groupId, from_lifegroup_id: current ? Number(current.lifegroup_id) : null,
      tier, role,
    });
    return { unchanged: false };
  });
  return { ...await membershipForPerson(personId), unchanged: result.unchanged };
}

/** Assign an ungrouped person to an eligible Cell; never moves existing memberships.
 * The existing assignMember transaction handles capacity, membership locks and audit log.
 * On contention, try the next eligible cell and return a manual-review result if none remains.
 */
async function autoAssignMember(personId, prefs = {}, actor = null) {
  const person = (await query('SELECT id,sex,archived_at,status,preferred_area,preferred_day,preferred_category FROM people WHERE id=$1',[personId])).rows[0];
  if (!person || person.archived_at || person.status === 'inactive') throw httpError(404, 'Active person not found.');
  const active = (await query('SELECT lifegroup_id FROM lifegroup_memberships WHERE person_id=$1 AND left_at IS NULL ORDER BY id LIMIT 1',[personId])).rows[0];
  if (active) return { assigned: true, already_assigned: true, lifegroup_id: Number(active.lifegroup_id) };
  if (!['male','female'].includes(person.sex)) return { assigned:false, reason:'sex_missing', needs_manual_assignment:true };
  const gender = person.sex === 'male' ? 'boys' : 'girls';
  const candidates = recommendEligibleCells(await listGroups({gender,status:'active'}),{
    day:prefs.day || person.preferred_day, area:prefs.area || person.preferred_area,
    category:prefs.category || person.preferred_category,
  });
  for (const cell of candidates) {
    try {
      const membership = await assignMember(cell.id,personId,{role:'member',tier:'new'},actor);
      return { assigned:true, lifegroup_id:cell.id, membership, already_assigned:Boolean(membership.unchanged) };
    } catch (error) {
      // Never mask authorization or validation faults; only skip a Cell lost to contention.
      if (error.status !== 409) throw error;
      const nowActive = (await query('SELECT lifegroup_id FROM lifegroup_memberships WHERE person_id=$1 AND left_at IS NULL ORDER BY id LIMIT 1',[personId])).rows[0];
      if (nowActive) return {assigned:true,already_assigned:true,lifegroup_id:Number(nowActive.lifegroup_id)};
    }
  }
  return { assigned:false, reason:'no_eligible_cell', needs_manual_assignment:true };
}

async function leaveMember(groupId, personId, leftAt = today(), actor) {
  if (!dateOk(leftAt)) throw httpError(400, 'Left date must be a valid date.');
  await transaction(async (client) => {
    const current = (await client.query(`SELECT m.id,m.joined_at,g.name,p.first_name,p.last_name
      FROM lifegroup_memberships m JOIN lifegroups g ON g.id=m.lifegroup_id JOIN people p ON p.id=m.person_id
      WHERE m.lifegroup_id=$1 AND m.person_id=$2 AND m.left_at IS NULL FOR UPDATE OF m`, [groupId,personId])).rows[0];
    if (!current) throw httpError(404, 'No current membership in that Lifegroup.');
    if (leftAt < String(current.joined_at).slice(0,10)) throw httpError(400, 'Left date cannot be before the joined date.');
    await client.query('UPDATE lifegroup_memberships SET left_at=$1 WHERE id=$2', [leftAt,current.id]);
    await logAction(client, actor, 'lifegroup_memberships', current.id, 'leave', { person_id: personId, lifegroup_id: groupId, left_at: leftAt });
  });
  return membershipForPerson(personId);
}

/**
 * History-preserving removal from the visible Lifegroups tree.
 * Never delete People, attendance, membership rows, meetings or networks.
 * Closing memberships and deactivating the structure must be one transaction.
 */
async function removeNetworkFromTree(networkId, actor) {
  return transaction(async (client) => {
    const net=(await client.query('SELECT id,name,is_active FROM networks WHERE id=$1 FOR UPDATE',[networkId])).rows[0];
    if (!net) throw httpError(404,'Network not found.');
    if (!net.is_active) throw httpError(409,'This Network has already been removed from the active tree.');
    const {rows:groups}=await client.query(
      'SELECT id FROM lifegroups WHERE network_id=$1 ORDER BY id FOR UPDATE',[networkId]);
    const groupIds=groups.map(g=>Number(g.id));
    let membersClosed=0;
    if (groupIds.length) {
      const ended=await client.query(
        'UPDATE lifegroup_memberships SET left_at=GREATEST(joined_at,$2::date) WHERE lifegroup_id=ANY($1::bigint[]) AND left_at IS NULL RETURNING id',
        [groupIds,today()]);
      membersClosed=ended.rows.length;
      await client.query('UPDATE lifegroups SET is_active=false,updated_at=now() WHERE network_id=$1 AND is_active',[networkId]);
    }
    await client.query('UPDATE networks SET is_active=false,updated_at=now() WHERE id=$1',[networkId]);
    await logAction(client,actor,'networks',networkId,'remove_from_tree',{
      name:net.name,group_count:groupIds.length,ended_memberships:membersClosed,retained_history:true,
    });
    return {network_id:networkId,archived_groups:groupIds.length,ended_memberships:membersClosed,removed:true};
  });
}

async function removeCellLeaderFromTree(groupId, actor) {
  return transaction(async (client) => {
    const g=(await client.query(
      'SELECT id,name,network_id,leader_person_id,is_active FROM lifegroups WHERE id=$1 FOR UPDATE',[groupId])).rows[0];
    if (!g) throw httpError(404,'Cell Leader not found.');
    if (!g.is_active) throw httpError(409,'This Cell Leader has already been removed from the active tree.');
    const net=g.network_id?(await client.query(
      'SELECT id,leader_person_id FROM networks WHERE id=$1',[g.network_id])).rows[0]:null;
    if (net?.leader_person_id && Number(net.leader_person_id)===Number(g.leader_person_id)) {
      throw httpError(409,'This is the Network Leader’s own Cell. Remove the Network instead.');
    }
    const when=today();
    const ended=await client.query(
      'UPDATE lifegroup_memberships SET left_at=GREATEST(joined_at,$2::date) WHERE lifegroup_id=$1 AND left_at IS NULL RETURNING id',
      [groupId,when]);
    let leaderLinksClosed=0;
    if (net?.leader_person_id && g.leader_person_id) {
      // Only detach the leader-team membership if this person has no other
      // active Cell in the Network. Keep their Person record and history.
      const endedLeader=await client.query(`UPDATE lifegroup_memberships m
        SET left_at=GREATEST(m.joined_at,$4::date)
        FROM lifegroups parent
        WHERE m.lifegroup_id=parent.id
          AND parent.network_id=$1 AND parent.leader_person_id=$2
          AND m.person_id=$3 AND m.left_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM lifegroups other
            WHERE other.network_id=$1 AND other.leader_person_id=$3
              AND other.id<>$5 AND other.is_active)
        RETURNING m.id`,
        [g.network_id,net.leader_person_id,g.leader_person_id,when,groupId]);
      leaderLinksClosed=endedLeader.rows.length;
    }
    await client.query('UPDATE lifegroups SET is_active=false,updated_at=now() WHERE id=$1',[groupId]);
    await logAction(client,actor,'lifegroups',groupId,'remove_from_tree',{
      name:g.name,network_id:g.network_id,leader_person_id:g.leader_person_id,
      ended_memberships:ended.rows.length,ended_leader_links:leaderLinksClosed,retained_history:true,
    });
    return {group_id:groupId,ended_memberships:ended.rows.length,
      ended_leader_links:leaderLinksClosed,removed:true};
  });
}

async function removeMemberFromTree(groupId,personId,actor) {
  return transaction(async (client) => {
    const group=(await client.query(
      'SELECT g.id,g.name,g.leader_person_id,g.is_active,g.network_id FROM lifegroups g WHERE g.id=$1 FOR UPDATE',[groupId])).rows[0];
    if (!group) throw httpError(404,'Cell not found.');
    if (!group.is_active) throw httpError(409,'This Cell is inactive.');
    const net=group.network_id?(await client.query(
      'SELECT leader_person_id FROM networks WHERE id=$1',[group.network_id])).rows[0]:null;
    if (Number(group.leader_person_id)===personId ||
        (net?.leader_person_id && Number(net.leader_person_id)===Number(group.leader_person_id))) {
      throw httpError(409,'Remove a Cell Leader or Network Leader using the corresponding tab.');
    }
    const current=(await client.query(`SELECT m.id,m.joined_at
      FROM lifegroup_memberships m
      WHERE m.lifegroup_id=$1 AND m.person_id=$2 AND m.left_at IS NULL FOR UPDATE OF m`,
      [groupId,personId])).rows[0];
    if (!current) throw httpError(404,'Member is not assigned to this Cell.');
    const when=today();
    await client.query('UPDATE lifegroup_memberships SET left_at=GREATEST(joined_at,$2::date) WHERE id=$1',[current.id,when]);
    await logAction(client,actor,'lifegroup_memberships',current.id,'leave',{
      person_id:personId,lifegroup_id:groupId,removed_from_tree:true,left_at:when,retained_history:true,
    });
    return {group_id:groupId,person_id:personId,removed:true};
  });
}

async function meetingRows(groupId, limit = 30) {
  const { rows } = await query(`SELECT mt.*,mt.meeting_date::text AS meeting_date, u.display_name AS submitted_by_user_name
    FROM lifegroup_meetings mt LEFT JOIN staff_users u ON u.id=mt.submitted_by_user
    WHERE mt.lifegroup_id=$1 ORDER BY mt.meeting_date DESC,mt.id DESC LIMIT $2`, [groupId,limit]);
  const out = [];
  for (const row of rows) {
    const marks = (await query(`SELECT a.person_id AS id,p.first_name,p.last_name,p.full_name,p.person_code,a.present,a.devotion,a.absent
      FROM lifegroup_meeting_attendance a JOIN people p ON p.id=a.person_id WHERE a.meeting_id=$1
      ORDER BY lower(p.last_name),lower(p.first_name),p.id`, [row.id])).rows;
    const personName = (p) => p.full_name || `${p.first_name} ${p.last_name}`.trim();
    out.push({ ...row, id: Number(row.id), lifegroup_id: Number(row.lifegroup_id), held: Boolean(row.held), present_count: Number(row.present_count),
      present: marks.filter((m) => m.present).map((m) => ({ id: Number(m.id), name: personName(m), person_code: m.person_code })),
      absent: marks.filter((m) => m.absent).map((m) => ({ id: Number(m.id), name: personName(m) })),
      devotion: marks.filter((m) => m.devotion).map((m) => ({ id: Number(m.id), name: personName(m) })),
    });
  }
  return out;
}

async function saveMeeting(groupId, body = {}, actor) {
  const date = clean(body.meeting_date);
  if (!dateOk(date)) throw httpError(400, 'Choose a valid meeting date.');
  if (date > today()) throw httpError(400, 'Meeting date cannot be in the future.');
  if (date < addDays(today(), -120)) throw httpError(400, 'Meeting reports can only be entered for the last 120 days.');
  const held = asBool(body.held, true);
  const reason = stringField(body.no_meeting_reason, 'Reason for no meeting', { max: 500 });
  if (!held && !reason) throw httpError(400, 'Tell us why there was no Lifegroup this week.');
  const topic = stringField(body.topic, 'Topic', { max: 160 });
  const notes = stringField(body.notes, 'Notes', { max: 1000 });
  const presentIds = [...new Set((Array.isArray(body.present_ids) ? body.present_ids : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const devotionIds = [...new Set((Array.isArray(body.devotion_ids) ? body.devotion_ids : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (devotionIds.some((id) => !presentIds.includes(id))) throw httpError(400, 'A devotion mark must also be marked present.');
  if (!held && (presentIds.length || devotionIds.length)) throw httpError(400, 'Attendance marks are only allowed when a meeting was held.');
  const result = await transaction(async (client) => {
    const group = (await client.query('SELECT id,name,is_active FROM lifegroups WHERE id=$1 FOR UPDATE', [groupId])).rows[0];
    if (!group) throw httpError(404, 'Lifegroup not found.');
    if (!group.is_active) throw httpError(409, 'This Lifegroup is inactive. Activate it before reporting attendance.');
    const current = (await client.query(`SELECT m.person_id FROM lifegroup_memberships m JOIN people p ON p.id=m.person_id
      WHERE m.lifegroup_id=$1 AND m.left_at IS NULL AND p.archived_at IS NULL`, [groupId])).rows.map((r) => Number(r.person_id));
    const currentSet = new Set(current);
    if (presentIds.some((id) => !currentSet.has(id)) || devotionIds.some((id) => !currentSet.has(id))) {
      throw httpError(409, 'The roster changed while this report was open. Reload and try again.');
    }
    const existing = (await client.query('SELECT id FROM lifegroup_meetings WHERE lifegroup_id=$1 AND meeting_date=$2 FOR UPDATE', [groupId,date])).rows[0];
    let meetingId, updated = Boolean(existing);
    if (existing) {
      meetingId = Number(existing.id);
      await client.query(`UPDATE lifegroup_meetings SET held=$1,no_meeting_reason=$2,topic=$3,notes=$4,present_count=$5,
        submitted_via='admin',submitted_by_user=$6,submitted_by_name=$7,updated_at=now() WHERE id=$8`,
        [held,held ? null : reason,topic,notes,held ? presentIds.length : 0,actor?.id || null,actor?.display_name || null,meetingId]);
      await client.query('DELETE FROM lifegroup_meeting_attendance WHERE meeting_id=$1', [meetingId]);
    } else {
      meetingId = await allocateId(client, 'lifegroup_meetings');
      await client.query(`INSERT INTO lifegroup_meetings(id,lifegroup_id,meeting_date,held,no_meeting_reason,topic,notes,present_count,
        submitted_via,submitted_by_user,submitted_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'admin',$9,$10)`,
        [meetingId,groupId,date,held,held ? null : reason,topic,notes,held ? presentIds.length : 0,actor?.id || null,actor?.display_name || null]);
    }
    if (held) {
      const presentSet = new Set(presentIds), devotionSet = new Set(devotionIds);
      for (const personId of current) {
        const attendanceId = await allocateId(client, 'lifegroup_meeting_attendance');
        await client.query(`INSERT INTO lifegroup_meeting_attendance(id,meeting_id,person_id,present,devotion,absent,marked_by)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [attendanceId,meetingId,personId,presentSet.has(personId),devotionSet.has(personId),!presentSet.has(personId),actor?.display_name || null]);
      }
    }
    await logAction(client, actor, 'lifegroup_meetings', meetingId, updated ? 'update' : 'create', {
      lifegroup_id: groupId, meeting_date: date, held, present_count: held ? presentIds.length : 0,
    });
    return { id: meetingId, meeting_id: meetingId, updated, present: held ? presentIds.length : 0 };
  });
  return { ...result, progress: await progress(groupId, 12), meetings: await meetingRows(groupId, 30) };
}

async function deleteMeeting(groupId, meetingId, actor) {
  await transaction(async (client) => {
    const row = (await client.query('DELETE FROM lifegroup_meetings WHERE id=$1 AND lifegroup_id=$2 RETURNING id,meeting_date', [meetingId,groupId])).rows[0];
    if (!row) throw httpError(404, 'Meeting report not found.');
    await logAction(client, actor, 'lifegroup_meetings', meetingId, 'delete', { lifegroup_id: groupId, meeting_date: row.meeting_date });
  });
  return { progress: await progress(groupId, 12), meetings: await meetingRows(groupId, 30) };
}

async function groupWeeks(groupId, count) {
  const weeks = recentWeeks(count);
  const from = weeks[0], to = addDays(weeks.at(-1), 6);
  const { rows } = await query(`SELECT id,meeting_date::text AS meeting_date,held,present_count,no_meeting_reason
    FROM lifegroup_meetings WHERE lifegroup_id=$1 AND meeting_date BETWEEN $2 AND $3 ORDER BY meeting_date,id`, [groupId,from,to]);
  const byWeek = new Map();
  for (const row of rows) {
    const key = mondayOf(row.meeting_date);
    const prev = byWeek.get(key);
    if (!prev || String(row.meeting_date) > String(prev.meeting_date)) byWeek.set(key, {
      id: Number(row.id), date: row.meeting_date, meeting_date: row.meeting_date,
      held: Boolean(row.held), present: Number(row.present_count), present_count: Number(row.present_count),
      no_meeting_reason: row.no_meeting_reason,
    });
  }
  return weeks.map((week_start) => ({ week_start, meeting: byWeek.get(week_start) || null }));
}

async function membersWithLast4(groupId) {
  const members = await activeMembers(groupId);
  const weeks = recentWeeks(4);
  const calendar = await groupWeeks(groupId,4);
  const meetingIds = calendar.map((w) => w.meeting?.id).filter(Boolean);
  const marks = new Map();
  if (meetingIds.length) {
    const { rows } = await query(`SELECT meeting_id,person_id,present,devotion,absent FROM lifegroup_meeting_attendance WHERE meeting_id=ANY($1::bigint[])`, [meetingIds]);
    for (const row of rows) marks.set(`${row.meeting_id}:${row.person_id}`, row);
  }
  return members.map((member) => {
    const last4 = calendar.map((w) => {
      const meeting = w.meeting;
      const mark = meeting && marks.get(`${meeting.id}:${member.id}`);
      return { week_start: w.week_start, held: Boolean(meeting?.held), present: Boolean(mark?.present), devotion: Boolean(mark?.devotion), absent: Boolean(mark?.absent) };
    });
    const reported = last4.filter((w) => w.held);
    return { ...member, last4: { weeks: last4, consistency_pct: reported.length ? Math.round(100 * reported.filter((w) => w.present).length / reported.length) : null } };
  });
}

async function progress(groupId, weeks = 12) {
  const group = (await listGroups({ status: 'all' })).find((g) => g.id === Number(groupId));
  if (!group) throw httpError(404, 'Lifegroup not found.');
  const count = Math.max(4, Math.min(Number(weeks) || 12, 26));
  const [members, calendar, meetings] = await Promise.all([membersWithLast4(groupId),groupWeeks(groupId,count),meetingRows(groupId,30)]);
  const solid = members.filter((m) => m.tier === 'solid').length;
  const newMembers = members.filter((m) => m.tier !== 'solid').length;
  const currentWeek = mondayOf(today());
  const current = calendar.find((w) => w.week_start === currentWeek)?.meeting;
  let streak = 0;
  for (let i = calendar.length - 1; i >= 0; i--) {
    if (calendar[i].week_start > currentWeek) continue;
    if (calendar[i].meeting?.held) streak++;
    else break;
  }
  const lastMeeting = meetings.find((m) => m.held) || null;
  const heldLast4 = calendar.slice(-4).filter((w) => w.meeting?.held).length;
  return {
    group: { id: group.id, name: group.name, gender: group.gender, leader_name: group.leader_name },
    members, solid, new_members: newMembers, total: members.length, target: SOLID_TARGET,
    is_solid: solid >= SOLID_TARGET, percent: Math.min(100, Math.round(100 * solid / SOLID_TARGET)),
    met_this_week: Boolean(current?.held), held_last_4: heldLast4, streak, last_meeting: lastMeeting,
    calendar, meetings,
  };
}

async function overviewProgress(weeks = 8) {
  const [groups, nets] = await Promise.all([listGroups(),listNetworks()]);
  const count = Math.max(4,Math.min(Number(weeks)||8,26));
  const progressRows = [];
  for (const group of groups) {
    const p = await progress(group.id, count);
    progressRows.push({ ...group, solid: p.solid, new_members: p.new_members, total: p.total, is_solid: p.is_solid,
      held_last_4: p.held_last_4, streak: p.streak, met_this_week: p.met_this_week, calendar: p.calendar });
  }
  const held = progressRows.reduce((sum,g) => sum + g.held_last_4,0);
  const totalLast4 = progressRows.length * 4;
  const summary = {
    groups: progressRows.length,
    networks: nets.length,
    solid_groups: progressRows.filter((g) => g.is_solid).length,
    solid_members: progressRows.reduce((sum,g) => sum + g.solid,0),
    new_members: progressRows.reduce((sum,g) => sum + g.new_members,0),
    met_this_week: progressRows.filter((g) => g.met_this_week).length,
    consistency_pct: totalLast4 ? Math.round(100 * held / totalLast4) : 0,
  };
  return { groups: progressRows, networks: nets, weeks: recentWeeks(count), target: SOLID_TARGET, summary };
}

async function networkDetail(id) {
  const networks = await listNetworks({ status: 'all' });
  const net = networks.find((n) => n.id === Number(id));
  if (!net) throw httpError(404, 'Network not found.');
  const groups = await listGroups({ status: 'all', network_id: id });
  const withMembers = [];
  for (const group of groups) {
    const members = await activeMembers(group.id);
    const solid = members.filter((m) => m.tier === 'solid').length;
    withMembers.push({ ...group, members, total: members.length, solid_count: solid,
      boys: members.filter((m) => m.sex === 'male').length,
      girls: members.filter((m) => m.sex === 'female').length,
      is_leader_group: Boolean(net.leader_person_id && group.leader_person_id === net.leader_person_id) });
  }
  const cells = withMembers.filter((g) => !g.is_leader_group);
  const leaderGroup = withMembers.find((g) => g.is_leader_group) || null;
  const cellLeaders = leaderGroup?.members.length ?? Number(net.cell_leaders || 0);
  return { ...net, groups: withMembers, group_count: cells.filter((g) => g.is_active).length,
    people_count: cells.reduce((sum,g) => sum + g.member_count,0),
    boys: cells.reduce((sum,g) => sum + g.boys,0), girls: cells.reduce((sum,g) => sum + g.girls,0),
    cell_leaders: cellLeaders,
    closed_cell: cells.reduce((sum,g) => sum + g.solid_count,0),
    open_cell: cells.reduce((sum,g) => sum + g.open_count,0),
  };
}

/** Church classification is distinct from attendance status and staff account permissions.
 * Until a reviewed schema migration is approved, store it in existing People
 * extras JSON and use audit_log for durable previous/current history.
 */
async function setDiscipleshipClassification(personId, requested, reason, actor) {
  const target=clean(requested);
  if(!['network_leader','cell_leader','member','vip'].includes(target))
    throw httpError(400,'Choose Network Leader, Cell Leader, Member or VIP.');
  const note=stringField(reason,'Reason',{max:500});
  return transaction(async client=>{
    const p=(await client.query('SELECT id,archived_at,extras FROM people WHERE id=$1 FOR UPDATE',[personId])).rows[0];
    if(!p||p.archived_at)throw httpError(404,'Active People record not found.');
    const current=clean(p.extras?.discipleship_classification);
    if(current===target)return {person_id:personId,classification:target,unchanged:true};
    const network=(await client.query('SELECT id FROM networks WHERE leader_person_id=$1 AND is_active LIMIT 1',[personId])).rows[0];
    const cell=(await client.query('SELECT id FROM lifegroups WHERE leader_person_id=$1 AND is_active LIMIT 1',[personId])).rows[0];
    if(target==='network_leader'&&!network)throw httpError(409,'Connect this person to an active Network before promoting to Network Leader.');
    if(target==='cell_leader'&&(!cell||network))throw httpError(409,'Connect this person as Cell Leader, and resolve any active Network leadership first.');
    if(['member','vip'].includes(target)&&(network||cell))throw httpError(409,'Reassign the active leadership relationship before changing this person to Member or VIP.');
    await client.query(`UPDATE people SET extras=jsonb_set(coalesce(extras,'{}'::jsonb),
      '{discipleship_classification}',to_jsonb($1::text),true),updated_at=now() WHERE id=$2`,[target,personId]);
    await logAction(client,actor,'people',personId,'discipleship_classification_changed',
      {from:current,to:target,reason:note});
    return {person_id:personId,previous_classification:current,classification:target,unchanged:false};
  });
}

async function lifegroupMethod(name, args, actor) {
  if (name === 'setDiscipleshipClassification') return setDiscipleshipClassification(asId(args[0],'person ID'),args[1],args[2]||null,actor);
  if (name === 'lifegroupOverview') return trackerOverview();
  if (name === 'lifegroups') return listGroups(args[0] || {});
  if (name === 'lifegroupOptions') return options();
  if (name === 'lifegroupNeeds') return needsLifegroup(args[0] || {});
  if (name === 'lifegroupRecommend') {
    const prefs = args[0] || {};
    const sex = clean(prefs.sex);
    if (!['male','female'].includes(sex)) return { prefs, groups: [] };
    const gender = sex === 'male' ? 'boys' : 'girls';
    let groups = await listGroups({ gender, status: 'active' });
    groups = recommendEligibleCells(groups, prefs);
    return { prefs, groups };
  }
  if (name === 'lifegroup') return getGroup(asId(args[0], 'group ID'));
  if (name === 'lifegroupProgress') return progress(asId(args[0], 'group ID'), args[1]);
  if (name === 'progressOverview') return overviewProgress(args[0]);
  if (name === 'networkCalendar') {
    const networkId = asId(args[0], 'network ID');
    const count = Math.max(4, Math.min(Number(args[1]) || 8, 26));
    const net = await networkDetail(networkId);
    const weekStarts = recentWeeks(count);
    const membersLast4 = {};
    const rows = [];
    for (const group of net.groups) {
      const [calendar,members] = await Promise.all([groupWeeks(group.id,count),membersWithLast4(group.id)]);
      membersLast4[group.id] = Object.fromEntries(members.map((m) => [m.id,m.last4]));
      const solid = members.filter((m) => m.tier === 'solid').length;
      rows.push({ ...group, solid, target: SOLID_TARGET, is_solid: solid >= SOLID_TARGET, calendar });
    }
    const currentWeek = mondayOf(today());
    const metThisWeek = rows.filter((g) => g.calendar.find((w) => w.week_start === currentWeek)?.meeting?.held).length;
    const heldLast4 = rows.reduce((sum,g) => sum + g.calendar.slice(-4).filter((w) => w.meeting?.held).length,0);
    const denominator = rows.length * 4;
    const summary = { groups: rows.length, met_this_week: metThisWeek, consistency_pct: denominator ? Math.round(100 * heldLast4 / denominator) : 0 };
    return { network: { id: net.id, name: net.name }, groups: rows, weeks: weekStarts,
      calendar: weekStarts.map((week_start) => ({ week_start, groups: rows.map((g) => ({ group_id:g.id,group_name:g.name,meeting:g.calendar.find((w) => w.week_start===week_start)?.meeting || null })) })),
      members_last4: membersLast4, target: SOLID_TARGET, summary };
  }
  if (name === 'createLifegroup') return getGroup(await saveGroup(args[0] || {},actor));
  if (name === 'updateLifegroup') return getGroup(await saveGroup(args[1] || {},actor,asId(args[0],'group ID')));
  if (name === 'deleteLifegroup') {
    const id = asId(args[0], 'group ID');
    return transaction(async (client) => {
      const group = (await client.query('SELECT id,name FROM lifegroups WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!group) throw httpError(404, 'Lifegroup not found.');
      const hasHistory = Number((await client.query('SELECT count(*)::int AS n FROM lifegroup_memberships WHERE lifegroup_id=$1', [id])).rows[0].n);
      const hasMeetings = Number((await client.query('SELECT count(*)::int AS n FROM lifegroup_meetings WHERE lifegroup_id=$1', [id])).rows[0].n);
      if (hasHistory || hasMeetings) throw httpError(409, 'This Lifegroup has history and cannot be deleted. Mark it inactive instead.');
      await client.query('DELETE FROM lifegroups WHERE id=$1', [id]);
      await logAction(client, actor, 'lifegroups', id, 'delete', { name: group.name });
      return {};
    });
  }
  if (name === 'removeCellLeaderFromTree') return removeCellLeaderFromTree(asId(args[0],'group ID'),actor);
  if (name === 'removeMemberFromTree') return removeMemberFromTree(asId(args[0],'group ID'),asId(args[1],'person ID'),actor);
  if (name === 'autoAssignLifegroup') return autoAssignMember(asId(args[0],'person ID'),args[1] || {},actor);
  if (name === 'assignLifegroup') return assignMember(asId(args[0],'group ID'),asId(args[1],'person ID'),args[2] || {},actor);
  if (name === 'leaveLifegroup') return leaveMember(asId(args[0],'group ID'),asId(args[1],'person ID'),clean(args[2]) || today(),actor);
  if (name === 'setTier') {
    const groupId = asId(args[0],'group ID'), personId = asId(args[1],'person ID'), tier = validateTier(args[2]);
    await transaction(async (client) => {
      const membership = (await client.query(`SELECT m.id,m.tier,p.first_name,p.last_name FROM lifegroup_memberships m JOIN people p ON p.id=m.person_id
        WHERE m.lifegroup_id=$1 AND m.person_id=$2 AND m.left_at IS NULL FOR UPDATE OF m`, [groupId,personId])).rows[0];
      if (!membership) throw httpError(404, 'Current group membership not found.');
      if (tier === 'solid' && membership.tier !== 'solid') {
        const count = Number((await client.query("SELECT count(*)::int AS n FROM lifegroup_memberships WHERE lifegroup_id=$1 AND left_at IS NULL AND tier='solid'", [groupId])).rows[0].n);
        if (count >= SOLID_TARGET) throw httpError(409, `Closed cell has reached its ${SOLID_TARGET}-member target.`);
      }
      await client.query('UPDATE lifegroup_memberships SET tier=$1 WHERE id=$2', [tier,membership.id]);
      await logAction(client,actor,'lifegroup_memberships',membership.id,'tier_change',{person_id:personId,lifegroup_id:groupId,tier});
    });
    return progress(groupId,12);
  }
  if (name === 'networks') return listNetworks(args[0] || {});
  if (name === 'network') return networkDetail(asId(args[0],'network ID'));
  if (name === 'createNetworkStructure') return networkDetail(await createNetworkStructure(args[0] || {},actor));
  if (name === 'createNetwork') return networkDetail(await saveNetwork(args[0] || {},actor));
  if (name === 'updateNetwork') return networkDetail(await saveNetwork(args[1] || {},actor,asId(args[0],'network ID')));
  if (name === 'removeNetworkFromTree') return removeNetworkFromTree(asId(args[0],'network ID'),actor);
  if (name === 'deleteNetwork') {
    const id = asId(args[0],'network ID');
    return transaction(async (client) => {
      const net = (await client.query('SELECT id,name FROM networks WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!net) throw httpError(404, 'Network not found.');
      const count = Number((await client.query('SELECT count(*)::int AS n FROM lifegroups WHERE network_id=$1', [id])).rows[0].n);
      if (count) throw httpError(409, 'This network still has Lifegroups. Move them first or mark the network inactive.');
      await client.query('DELETE FROM networks WHERE id=$1', [id]);
      await logAction(client,actor,'networks',id,'delete',{name:net.name});
      return {};
    });
  }
  if (name === 'ensureNetworkLeaderGroup') {
    const id = asId(args[0],'network ID');
    return transaction(async (client) => {
      const net = (await client.query('SELECT * FROM networks WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!net) throw httpError(404, 'Network not found.');
      if (!net.leader_person_id) throw httpError(400, 'Set a registered network leader first.');
      let group = (await client.query('SELECT id,name FROM lifegroups WHERE network_id=$1 AND leader_person_id=$2 AND is_active ORDER BY id LIMIT 1', [id,net.leader_person_id])).rows[0];
      let created = false;
      if (!group) {
        const leader = (await client.query('SELECT first_name,last_name,sex FROM people WHERE id=$1 AND archived_at IS NULL', [net.leader_person_id])).rows[0];
        if (!leader) throw httpError(400, 'The selected network leader is not active.');
        if (leader.sex && leader.sex !== SEX_OF[net.gender]) throw httpError(400, 'The network leader does not match this network’s gender.');
        const groupId = await allocateId(client,'lifegroups');
        const groupName = /leaders$/i.test(net.name) ? net.name : `${net.name} Leaders`;
        await client.query(`INSERT INTO lifegroups(id,name,gender,leader_person_id,network_id,network_manual,notes,created_by)
          VALUES($1,$2,$3,$4,$5,false,$6,$7)`, [groupId,groupName,net.gender,net.leader_person_id,id,'Network leader’s Lifegroup; cell leaders report through this group.',actor?.id || null]);
        group = { id: groupId, name: groupName };
        created = true;
        await logAction(client,actor,'lifegroups',groupId,'create',{name:groupName,network_id:id,network_leader_group:true});
      }
      return { lifegroup_id:Number(group.id),name:group.name,created };
    });
  }
  if (name === 'saveMeeting') return saveMeeting(asId(args[0],'group ID'),args[1] || {},actor);
  if (name === 'deleteMeeting') return deleteMeeting(asId(args[0],'group ID'),asId(args[1],'meeting ID'),actor);
  return undefined;
}

export async function handleLifegroupMethod(name, args = [], actor = null) {
  return lifegroupMethod(name,args,actor);
}
