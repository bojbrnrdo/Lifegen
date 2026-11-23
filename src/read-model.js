// Read-optimized PostgreSQL queries for hot Admin screens.
// These avoid hydrating whole tracker tables into the Vercel function on every read.
import { query } from './db.js';
import { today } from './domain.js';
import { vipAttendedSundays, vipLastAttended } from './vip-attendance.js';

const num = (v) => Number(v || 0);

const cleanText=(v)=>v==null?'':String(v).trim();
// Strip every non-digit so formatted contact numbers ("0917 555 1234", "555-1234")
// can be matched against regexp_replace(contact_number,'[^0-9]','','g') in SQL.
export const digits=(v)=>String(v||'').replace(/\D/g,'');
function mapPerson(row){const p={...(row.extras||{}),...row};delete p.extras;delete p._total;return p;}
export async function peopleSearch(value, extra = {}) {
  const q=cleanText(value);if(!q||q.length<2)return {people:[]};
  const qDigits=digits(q),pattern=`%${q}%`,phonePattern=qDigits.length>=3?`%${qDigits}%`:null;
  const sex=['male','female'].includes(extra?.sex)?extra.sex:null;
  const {rows}=await query(`WITH candidates AS (
      SELECT p.* FROM people p WHERE p.archived_at IS NULL
        AND ($1::text IS NULL OR p.sex=$1::text)
        AND (p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR coalesce(p.full_name,'') ILIKE $2
          OR (p.last_name || ', ' || p.first_name) ILIKE $2 OR p.person_code ILIKE $2
          OR ($3::text IS NOT NULL AND regexp_replace(coalesce(p.contact_number,''),'[^0-9]','','g') LIKE $3))
      ORDER BY (p.status='inactive'),lower(p.last_name),lower(p.first_name),p.id LIMIT 12
    )
    SELECT p.*,${vipAttendedSundays('p.id')} AS sundays_attended,${vipLastAttended('p.id')} AS last_attended
    FROM candidates p ORDER BY (p.status='inactive'),lower(p.last_name),lower(p.first_name),p.id`,[sex,pattern,phonePattern]);
  return {people:rows.map(mapPerson)};
}

export function safePeoplePageOffset(value) {
 const offset=Number(value);
 return Number.isSafeInteger(offset)&&offset>=0?offset:0;
}

export async function peopleList(params = {}, allowedCellIds = null) {
  const status=cleanText(params.status)||'active',q=cleanText(params.q),sort=cleanText(params.sort);
  const paged=params.paged===1||params.paged==='1';
  const limit=paged?Math.min(Math.max(Number(params.limit)||1000,1),2000):(params.limit?Math.max(1,Math.min(Number(params.limit)||2000,2000)):2000);
  const offset=safePeoplePageOffset(params.offset);
  const qDigits=digits(q),pattern=q?`%${q}%`:null,phonePattern=qDigits.length>=3?`%${qDigits}%`:null;
  const whereStatus=status==='archived'?`p.archived_at IS NOT NULL AND $1::text='archived'`:`p.archived_at IS NULL AND ($1::text='all' OR ($1::text='active' AND p.status<>'inactive') OR ($1::text='inactive' AND p.status='inactive') OR p.status=$1::text)`;
  const where= `${whereStatus}
    AND ($7::bigint[] IS NULL OR EXISTS (SELECT 1 FROM lifegroup_memberships lm JOIN lifegroups lg ON lg.id=lm.lifegroup_id WHERE lm.person_id=p.id AND lm.left_at IS NULL AND lg.is_active=true AND lg.id=ANY($7::bigint[])))
    AND ($2::text IS NULL OR p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR coalesce(p.full_name,'') ILIKE $2
      OR (p.last_name || ', ' || p.first_name) ILIKE $2 OR p.person_code ILIKE $2
      OR ($3::text IS NOT NULL AND regexp_replace(coalesce(p.contact_number,''),'[^0-9]','','g') LIKE $3))
    AND (NOT $4::boolean OR p.status='first_timer')`;
  const paramsSql=[status,pattern,phonePattern,params.first_timer==='1'||params.first_timer===1];
  const scopeCells=allowedCellIds===null?null:allowedCellIds.map(Number);
  const order=sort==='recent'?'id DESC'
    :sort==='last_attended'?'last_attended DESC NULLS LAST,lower(last_name),lower(first_name),id'
    :sort==='attendance'?'sundays_attended DESC,lower(last_name),lower(first_name),id'
    :'lower(last_name),lower(first_name),id';
  const sql=`WITH filtered AS (
      SELECT p.* FROM people p WHERE ${where}
    ), person_rows AS (
      SELECT p.*,${vipAttendedSundays('p.id')} AS sundays_attended,${vipLastAttended('p.id')} AS last_attended,
        count(*) OVER()::int AS _total
      FROM filtered p
    )
    SELECT * FROM person_rows ORDER BY ${order} LIMIT $5 OFFSET $6`;
  const {rows}=await query(sql,[...paramsSql,limit,offset,scopeCells]);
  const people=rows.map(mapPerson);
  if(paged){
    let total=rows.length?num(rows[0]._total):0;
    if(!rows.length&&offset>0){
      // OFFSET beyond the last row leaves no window-count row available.
      const count=(await query(`SELECT count(*)::int AS total FROM people p WHERE ${where}`,[...paramsSql,null,null,scopeCells])).rows[0];
      total=num(count?.total);
    }
    return {rows:people,total,limit,offset,has_more:offset+people.length<total};
  }
  return people;
}

export async function dashboardRead() {
  const now=today(),monthFrom=`${now.slice(0,7)}-01`,monthTo=`${now.slice(0,7)}-${String(new Date(num(now.slice(0,4)), num(now.slice(5,7)), 0).getDate()).padStart(2,'0')}`;
  // Sunday attendance is no longer tracked, so the dashboard reports People and
  // the VIP pipeline. There are no weekly, monthly or "average attendance"
  // figures to compute any more.
  const [peopleStats,vips,checks,sundays]=await Promise.all([
    query(`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE status<>'inactive')::int AS active,
        count(*) FILTER(WHERE status='inactive')::int AS inactive,
        count(*) FILTER(WHERE status='first_timer')::int AS first_timers,
        count(*) FILTER(WHERE status='member')::int AS members,
        count(*) FILTER(WHERE date_registered >= $1::date AND date_registered < ($1::date + interval '1 month'))::int AS registered_this_month
      FROM people`,[monthFrom]),
    query(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE review_status='new')::int AS pending,
      (SELECT EXISTS(SELECT 1 FROM people WHERE is_demo=true)) AS demo_loaded,
      coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id DESC) FROM (
        SELECT v.id,v.person_id,v.created_at,v.review_status,coalesce(nullif(p.full_name,''),concat_ws(' ',p.first_name,p.last_name)) AS name
        FROM vip_registrations v JOIN people p ON p.id=v.person_id ORDER BY v.id DESC LIMIT 6
      ) x),'[]'::jsonb) AS latest_vips
      FROM vip_registrations`),
    query(`SELECT count(*)::int AS pending_checkins FROM vip_checkins WHERE status='pending'`),
    query(`SELECT count(DISTINCT c.date_key)::int AS sundays FROM vip_checkins c WHERE c.status='valid'`),
  ]);
  const row=peopleStats.rows[0]||{},vipRow=vips.rows[0]||{};
  return {
    today:now,
    people:{total:num(row.total),active:num(row.active),inactive:num(row.inactive),first_timers:num(row.first_timers),members:num(row.members),registered_this_month:num(row.registered_this_month)},
    vip:{total:num(vipRow.total),pending:num(vipRow.pending),pending_checkins:num(checks.rows[0]?.pending_checkins),sundays_recorded:num(sundays.rows[0]?.sundays)},
    demo_loaded:Boolean(vipRow.demo_loaded),pending_registrations:num(vipRow.pending),pending_checkins:num(checks.rows[0]?.pending_checkins),latest_vips:vipRow.latest_vips||[],
  };
}
