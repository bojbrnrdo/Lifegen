// Read-optimized PostgreSQL queries for hot Admin screens.
// These avoid hydrating whole tracker tables into the Vercel function on every read.
import { query } from './db.js';
import { today } from './domain.js';

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

export async function dashboardRead() {
  const now=today(),year=num(now.slice(0,4)),month=now.slice(5,7),quarter=Math.floor((num(month)-1)/3)+1;
  const monthFrom=`${year}-${month}-01`,monthTo=`${year}-${month}-${String(new Date(year, num(month), 0).getDate()).padStart(2,'0')}`;
  const quarterStartMonth=(quarter-1)*3+1,quarterEndMonth=quarter*3;
  const qFrom=`${year}-${String(quarterStartMonth).padStart(2,'0')}-01`,qTo=`${year}-${String(quarterEndMonth).padStart(2,'0')}-${String(new Date(year,quarterEndMonth,0).getDate()).padStart(2,'0')}`;
  const [peopleStats,services,vips,checks]=await Promise.all([
    query(`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE status<>'inactive')::int AS active,
        count(*) FILTER(WHERE status='inactive')::int AS inactive,
        count(*) FILTER(WHERE status='first_timer')::int AS first_timers,
        count(*) FILTER(WHERE status='member')::int AS members,
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
    query(`SELECT count(*)::int AS pending_checkins FROM vip_checkins WHERE status='pending'`),
  ]);
  const all=services,latest=all.at(-1)||null,previous=all.length>1?all.at(-2):null;
  const aggregate=(rows)=>{const n=rows.length,p=rows.reduce((a,r)=>a+r.present_count,0);return {services:n,total_attendance:p,first_timers:rows.reduce((a,r)=>a+r.first_timer_count,0),returning:rows.reduce((a,r)=>a+r.returning_count,0),absent:rows.reduce((a,r)=>a+r.absent_count,0),average_attendance:n?round1(p/n):0};};
  const monthRows=all.filter(r=>r.service_date>=monthFrom&&r.service_date<=monthTo),quarterRows=all.filter(r=>r.service_date>=qFrom&&r.service_date<=qTo),yearRows=all.filter(r=>String(r.service_date).startsWith(String(year)));
  const avgRows=yearRows.length?yearRows:all.slice(-8),avg=avgRows.length?aggregate(avgRows).average_attendance:null;
  const row=peopleStats.rows[0]||{},vipRow=vips.rows[0]||{};
  return {
    today:now,
    people:{total:num(row.total),active:num(row.active),inactive:num(row.inactive),first_timers:num(row.first_timers),members:num(row.members),registered_this_month:num(row.registered_this_month)},
    services_recorded:all.length,latest,previous,change_vs_previous:latest&&previous?latest.present_count-previous.present_count:null,
    month:{label:month,...aggregate(monthRows)},quarter:{label:`Q${quarter} ${year}`,quarter,year,...aggregate(quarterRows)},year:{label:String(year),...aggregate(yearRows)},
    weekly:all.slice(-12),monthly:monthlyBreakdown(yearRows),recent:all.slice(-8).reverse(),average_attendance:avg,
    demo_loaded:Boolean(vipRow.demo_loaded),pending_registrations:num(vipRow.pending),pending_checkins:num(checks.rows[0]?.pending_checkins),latest_vips:vipRow.latest_vips||[],
  };
}
