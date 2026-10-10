// Read-optimized PostgreSQL queries for hot Admin screens.
// These avoid hydrating whole tracker tables into the Vercel function on every read.
import { query } from './db.js';
import { resolveRange, today } from './domain.js';

const num = (v) => Number(v || 0);
const round1 = (v) => Math.round(v * 10) / 10;
const dateRangeParams = (range = {}) => [range.from || null, range.to || null];

function mapService(row) {
  const present = num(row.present_count), base = num(row.registered_base);
  return {
    ...row,
    id: num(row.id),
    present_count: present,
    first_timer_count: num(row.first_timer_count),
    returning_count: num(row.returning_count),
    absent_count: num(row.absent_count),
    recorded_count: num(row.recorded_count),
    registered_base: base,
    is_demo: row.is_demo ? 1 : 0,
    attendance_rate: base > 0 ? round1((present / base) * 100) : null,
  };
}

export async function serviceSummaries(range = {}, serviceId = null) {
  const [from, to] = dateRangeParams(range);
  const { rows } = await query(`
    WITH selected_services AS (
      SELECT s.* FROM services s
      WHERE ($1::date IS NULL OR s.service_date >= $1::date)
        AND ($2::date IS NULL OR s.service_date <= $2::date)
        AND ($3::bigint IS NULL OR s.id=$3::bigint)
    ),
    counts AS (
      SELECT r.service_id,
        count(*) FILTER (WHERE r.status='present')::int AS present_count,
        count(*) FILTER (WHERE r.status='present' AND r.classification='first_timer')::int AS first_timer_count,
        count(*) FILTER (WHERE r.status='present' AND r.classification='returning')::int AS returning_count,
        count(*) FILTER (WHERE r.status='absent')::int AS absent_count,
        count(*)::int AS recorded_count
      FROM records r JOIN selected_services s ON s.id=r.service_id
      GROUP BY r.service_id
    ),
    base_dates AS (
      SELECT CASE WHEN p.date_first_attended IS NOT NULL AND p.date_first_attended < p.date_registered
                  THEN p.date_first_attended ELSE p.date_registered END AS base_date,
             count(*)::int AS people_count
      FROM people p
      WHERE p.status <> 'inactive' AND p.archived_at IS NULL
      GROUP BY 1
    )
    SELECT s.id,s.service_date,s.service_type,s.notes,s.is_demo,s.created_at,s.updated_at,
      coalesce(c.present_count,0)::int AS present_count,
      coalesce(c.first_timer_count,0)::int AS first_timer_count,
      coalesce(c.returning_count,0)::int AS returning_count,
      coalesce(c.absent_count,0)::int AS absent_count,
      coalesce(c.recorded_count,0)::int AS recorded_count,
      coalesce((SELECT sum(b.people_count) FROM base_dates b WHERE b.base_date <= s.service_date),0)::int AS registered_base
    FROM selected_services s LEFT JOIN counts c ON c.service_id=s.id
    ORDER BY s.service_date`, [from, to, serviceId]);
  return rows.map(mapService);
}

function aggregate(rows) {
  const n=rows.length;
  const sum=(key)=>rows.reduce((a,r)=>a+num(r[key]),0);
  const present=sum('present_count');
  const rated=rows.filter(r=>r.attendance_rate!==null);
  return {
    services:n,total_attendance:present,first_timers:sum('first_timer_count'),returning:sum('returning_count'),absent:sum('absent_count'),
    average_attendance:n?round1(present/n):0,
    highest:n?rows.reduce((a,r)=>r.present_count>a.present_count?r:a,rows[0]):null,
    lowest:n?rows.reduce((a,r)=>r.present_count<a.present_count?r:a,rows[0]):null,
    average_rate:rated.length?round1(rated.reduce((a,r)=>a+r.attendance_rate,0)/rated.length):null,
  };
}
function monthlyBreakdown(rows) {
  const map=new Map();
  for(const r of rows){
    const key=String(r.service_date).slice(0,7),m=map.get(key)||{month:key,services:0,present:0,first_timers:0,returning:0,absent:0};
    m.services++;m.present+=r.present_count;m.first_timers+=r.first_timer_count;m.returning+=r.returning_count;m.absent+=r.absent_count;map.set(key,m);
  }
  return [...map.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(m=>({...m,average:m.services?round1(m.present/m.services):0}));
}

export async function attendanceReport(params = {}) {
  const range=resolveRange(params),[from,to]=dateRangeParams(range);
  const [weekly,uniqueRows,registrationRows]=await Promise.all([
    serviceSummaries(range),
    query(`SELECT count(DISTINCT r.person_id)::int AS total
      FROM records r JOIN services s ON s.id=r.service_id
      WHERE r.status='present' AND ($1::date IS NULL OR s.service_date >= $1::date)
        AND ($2::date IS NULL OR s.service_date <= $2::date)`,[from,to]),
    query(`SELECT count(*)::int AS total FROM people p
      WHERE ($1::date IS NULL OR p.date_registered >= $1::date)
        AND ($2::date IS NULL OR p.date_registered <= $2::date)`,[from,to]),
  ]);
  return {range,totals:{...aggregate(weekly),unique_attendees:num(uniqueRows.rows[0]?.total),new_registrations:num(registrationRows.rows[0]?.total)},weekly,monthly:monthlyBreakdown(weekly)};
}

export async function reportYears() {
  const { rows }=await query('SELECT DISTINCT EXTRACT(YEAR FROM service_date)::int AS year FROM services ORDER BY year DESC');
  const years=rows.map(r=>num(r.year)),current=num(today().slice(0,4));
  if(!years.includes(current))years.unshift(current);
  return years;
}

const cleanText=(v)=>v==null?'':String(v).trim();
const digits=(v)=>String(v||'').replace(/\\D/g,'');
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
    SELECT p.*,coalesce(stats.sundays_attended,0)::int AS sundays_attended,stats.last_attended
    FROM candidates p LEFT JOIN LATERAL (
      SELECT count(*)::int AS sundays_attended,max(s.service_date) AS last_attended
      FROM records r JOIN services s ON s.id=r.service_id WHERE r.person_id=p.id AND r.status='present'
    ) stats ON true ORDER BY (p.status='inactive'),lower(p.last_name),lower(p.first_name),p.id`,[sex,pattern,phonePattern]);
  return {people:rows.map(mapPerson)};
}

export async function peopleList(params = {}) {
  const status=cleanText(params.status)||'active',q=cleanText(params.q),sort=cleanText(params.sort);
  const paged=params.paged===1||params.paged==='1';
  const limit=paged?Math.min(Math.max(Number(params.limit)||1000,1),2000):(params.limit?Math.max(1,Math.min(Number(params.limit)||2000,2000)):2000);
  const offset=Math.max(0,Number(params.offset)||0);
  const qDigits=digits(q),pattern=q?`%${q}%`:null,phonePattern=qDigits.length>=3?`%${qDigits}%`:null;
  const whereStatus=status==='archived'?`p.archived_at IS NOT NULL AND $1::text='archived'`:`p.archived_at IS NULL AND ($1::text='all' OR ($1::text='active' AND p.status<>'inactive') OR ($1::text='inactive' AND p.status='inactive') OR p.status=$1::text)`;
  const where= `${whereStatus}
    AND ($2::text IS NULL OR p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR coalesce(p.full_name,'') ILIKE $2
      OR (p.last_name || ', ' || p.first_name) ILIKE $2 OR p.person_code ILIKE $2
      OR ($3::text IS NOT NULL AND regexp_replace(coalesce(p.contact_number,''),'[^0-9]','','g') LIKE $3))
    AND (NOT $4::boolean OR p.status='first_timer')`;
  const paramsSql=[status,pattern,phonePattern,params.first_timer==='1'||params.first_timer===1];
  const order=sort==='recent'?'id DESC'
    :sort==='last_attended'?'last_attended DESC NULLS LAST,lower(last_name),lower(first_name),id'
    :sort==='attendance'?'sundays_attended DESC,lower(last_name),lower(first_name),id'
    :'lower(last_name),lower(first_name),id';
  const sql=`WITH filtered AS (
      SELECT p.* FROM people p WHERE ${where}
    ), person_rows AS (
      SELECT p.*,coalesce(stats.sundays_attended,0)::int AS sundays_attended,stats.last_attended,
        count(*) OVER()::int AS _total
      FROM filtered p
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS sundays_attended,max(s.service_date) AS last_attended
        FROM records r JOIN services s ON s.id=r.service_id
        WHERE r.person_id=p.id AND r.status='present'
      ) stats ON true
    )
    SELECT * FROM person_rows ORDER BY ${order} LIMIT $5 OFFSET $6`;
  const {rows}=await query(sql,[...paramsSql,limit,offset]);
  const people=rows.map(mapPerson);
  if(paged){const total=rows.length?num(rows[0]._total):0;return {rows:people,total,limit,offset,has_more:offset+people.length<total};}
  return people;
}

function activeCutoff(days=60){const d=new Date(`${today()}T12:00:00`);d.setDate(d.getDate()-days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export async function lifegroupOverview() {
  const cutoff=activeCutoff(60);
  const [stats,needs]=await Promise.all([
    query(`WITH active_people AS (
        SELECT p.id,p.date_registered FROM people p WHERE p.archived_at IS NULL AND p.status<>'inactive'
      ), current_members AS (
        SELECT DISTINCT m.person_id FROM memberships m WHERE m.left_at IS NULL
      ), group_sizes AS (
        SELECT g.id,g.capacity,count(m.id) FILTER (WHERE p.archived_at IS NULL)::int AS member_count
        FROM lifegroups g LEFT JOIN memberships m ON m.lifegroup_id=g.id AND m.left_at IS NULL
        LEFT JOIN people p ON p.id=m.person_id GROUP BY g.id,g.capacity
      )
      SELECT
        (SELECT count(*)::int FROM networks WHERE is_active) AS networks,
        (SELECT count(*)::int FROM lifegroups) AS total_groups,
        (SELECT count(*)::int FROM lifegroups WHERE is_active) AS active_groups,
        (SELECT count(*)::int FROM lifegroups WHERE is_active AND gender='boys') AS boys_groups,
        (SELECT count(*)::int FROM lifegroups WHERE is_active AND gender='girls') AS girls_groups,
        (SELECT count(*)::int FROM group_sizes z JOIN lifegroups g ON g.id=z.id WHERE g.is_active AND (z.capacity IS NULL OR z.member_count<z.capacity)) AS groups_with_slots,
        (SELECT count(DISTINCT CASE WHEN g.leader_person_id IS NOT NULL THEN 'p'||g.leader_person_id::text WHEN nullif(g.leader_name,'') IS NOT NULL THEN 'n'||g.leader_name END)::int FROM lifegroups g WHERE g.is_active) AS total_leaders,
        (SELECT count(*)::int FROM active_people p JOIN current_members m ON m.person_id=p.id) AS with_group,
        (SELECT count(*)::int FROM active_people p WHERE NOT EXISTS(SELECT 1 FROM current_members m WHERE m.person_id=p.id)) AS without_group,
        (SELECT count(*)::int FROM active_people p WHERE p.date_registered >= $1::date AND NOT EXISTS(SELECT 1 FROM current_members m WHERE m.person_id=p.id)) AS new_needing_connection`,[cutoff]),
    query(`SELECT p.id,p.person_code,p.first_name,p.last_name,p.status,p.date_registered,
        stats.sundays_attended,stats.last_attended
      FROM people p
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS sundays_attended,max(s.service_date) AS last_attended
        FROM records r JOIN services s ON s.id=r.service_id
        WHERE r.person_id=p.id AND r.status='present'
      ) stats ON true
      WHERE p.archived_at IS NULL AND p.status<>'inactive'
        AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.person_id=p.id AND m.left_at IS NULL)
      ORDER BY stats.last_attended DESC NULLS LAST,p.date_registered DESC LIMIT 6`),
  ]);
  const row=stats.rows[0]||{};
  return {lifegroups:Object.fromEntries(['networks','total_groups','active_groups','boys_groups','girls_groups','groups_with_slots','total_leaders','with_group','without_group','new_needing_connection'].map(k=>[k,num(row[k])])),needs:needs.rows.map(mapPerson)};
}

export async function dashboardRead() {
  const now=today(),year=num(now.slice(0,4)),month=num(now.slice(5,7)),quarter=Math.floor((month-1)/3)+1;
  const monthFrom=`${year}-${String(month).padStart(2,'0')}-01`,monthTo=`${year}-${String(month).padStart(2,'0')}-${String(new Date(year,month,0).getDate()).padStart(2,'0')}`;
  const quarterStartMonth=(quarter-1)*3+1,quarterEndMonth=quarter*3;
  const qFrom=`${year}-${String(quarterStartMonth).padStart(2,'0')}-01`,qTo=`${year}-${String(quarterEndMonth).padStart(2,'0')}-${String(new Date(year,quarterEndMonth,0).getDate()).padStart(2,'0')}`;
  const [peopleStats,services,vips,groupData]=await Promise.all([
    query(`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE status<>'inactive')::int AS active,
        count(*) FILTER(WHERE status='inactive')::int AS inactive,
        count(*) FILTER(WHERE status='first_timer')::int AS first_timers,
        count(*) FILTER(WHERE date_registered >= $1::date AND date_registered < ($1::date + interval '1 month'))::int AS registered_this_month
      FROM people`,[monthFrom]),
    serviceSummaries(),
    query(`SELECT count(*) FILTER(WHERE review_status='new')::int AS pending,
      (SELECT EXISTS(SELECT 1 FROM people WHERE is_demo=true)) AS demo_loaded,
      coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id DESC) FROM (
        SELECT v.id,v.person_id,v.created_at,v.review_status,coalesce(nullif(p.full_name,''),concat_ws(' ',p.first_name,p.last_name)) AS name
        FROM vip_registrations v JOIN people p ON p.id=v.person_id ORDER BY v.id DESC LIMIT 6
      ) x),'[]'::jsonb) AS latest_vips
      FROM vip_registrations`),
    lifegroupOverview(),
  ]);
  const all=services,latest=all.at(-1)||null,previous=all.length>1?all.at(-2):null;
  const aggregate=(rows)=>{const n=rows.length,p=rows.reduce((a,r)=>a+r.present_count,0),rated=rows.filter(r=>r.attendance_rate!==null);return {services:n,total_attendance:p,first_timers:rows.reduce((a,r)=>a+r.first_timer_count,0),returning:rows.reduce((a,r)=>a+r.returning_count,0),absent:rows.reduce((a,r)=>a+r.absent_count,0),average_attendance:n?round1(p/n):0};};
  const monthRows=all.filter(r=>r.service_date>=monthFrom&&r.service_date<=monthTo),quarterRows=all.filter(r=>r.service_date>=qFrom&&r.service_date<=qTo),yearRows=all.filter(r=>String(r.service_date).startsWith(String(year)));
  const avgRows=yearRows.length?yearRows:all.slice(-8),avg=avgRows.length?aggregate(avgRows).average_attendance:null;
  const monthly=monthlyBreakdown(yearRows),vipRow=vips.rows[0]||{};
  return {
    today:now,
    people:{total:num(peopleStats.rows[0]?.total),active:num(peopleStats.rows[0]?.active),inactive:num(peopleStats.rows[0]?.inactive),first_timers:num(peopleStats.rows[0]?.first_timers),registered_this_month:num(peopleStats.rows[0]?.registered_this_month)},
    services_recorded:all.length,latest,previous,change_vs_previous:latest&&previous?latest.present_count-previous.present_count:null,
    month:{label:monthFrom.slice(0,7),...aggregate(monthRows)},quarter:{label:`Q${quarter} ${year}`,quarter,year,...aggregate(quarterRows)},year:{label:String(year),...aggregate(yearRows)},
    weekly:all.slice(-12),trend:all.slice(-26),monthly,recent:all.slice(-8).reverse(),average_attendance:avg,
    demo_loaded:Boolean(vipRow.demo_loaded),pending_registrations:num(vipRow.pending),latest_vips:vipRow.latest_vips||[],
    lifegroups:groupData.lifegroups,needs_lifegroup:groupData.needs,
  };
}

export async function serviceById(id) {
  const rows=await serviceSummaries({},Number(id));const service=rows[0];
  if(!service)return null;
  const {rows:roster}=await query(`
    SELECT p.*,rec.id AS record_id,rec.status AS att_status,rec.classification,rec.recorded_at,
      CASE WHEN rec.id IS NOT NULL THEN coalesce(rec.recorded_by_name,'Imported staff') ELSE NULL END AS recorded_by,
      EXISTS(SELECT 1 FROM records prior JOIN services ps ON ps.id=prior.service_id
        WHERE prior.person_id=p.id AND prior.status='present' AND ps.service_date<s.service_date) AS attended_before,
      CASE WHEN rec.classification IS NOT NULL THEN rec.classification
        WHEN p.date_first_attended<s.service_date OR EXISTS(SELECT 1 FROM records prior JOIN services ps ON ps.id=prior.service_id
          WHERE prior.person_id=p.id AND prior.status='present' AND ps.service_date<s.service_date)
        THEN 'returning' ELSE 'first_timer' END AS expected_classification
    FROM services s JOIN people p ON ((p.status<>'inactive' AND p.archived_at IS NULL) OR EXISTS(SELECT 1 FROM records r0 WHERE r0.service_id=s.id AND r0.person_id=p.id))
    LEFT JOIN records rec ON rec.service_id=s.id AND rec.person_id=p.id
    WHERE s.id=$1
    ORDER BY lower(p.last_name),lower(p.first_name),p.id`,[service.id]);
  service.roster=roster.map(r=>({...r,...(r.extras||{}),attended_before:r.attended_before?1:0}));
  return service;
}

export async function serviceForDate(date) {
  const rows=await serviceSummaries({from:date,to:date});
  return rows[0]||null;
}
