import { Router } from 'express';
import { query, transaction, withState, stateId, allocateId, logAction } from './db.js';
import { domain, today, isSunday, fullNameSafe, httpError } from './domain.js';
import { checkOrigin, rateLimit, randomToken, hashToken, setVipCookie, safeEqual, cookieOptions } from './auth.js';
import { publicCalendar, upcomingEvents, calendarToIcs, eventToIcs, getEvent, publicShape, weeklySundayShape } from './calendar.js';
export const publicRouter=Router();
export function siteUrls(req) {
 const host=(req.app.get('trust proxy')?req.get('x-forwarded-host')||req.get('host'):req.get('host'))?.split(',')[0].trim()||'';
 const protocol=host.endsWith('.e2b.app')?'https':req.protocol;
 const origin=(process.env.SITE_URL||`${protocol}://${host}`).replace(/\/$/,'');
 return {site_url:origin,public_url:origin,admin_url:'/admin',tracker_url:'/admin'};
}
export async function readVip(req,client={query}) {
 const token=req.cookies?.lg_vip;if(!token)return null;
 const {rows}=await client.query('SELECT v.*,s.csrf_token,p.first_name,p.last_name,p.full_name AS person_name,p.status AS person_status FROM vip_sessions s JOIN vip_registrations v ON v.id=s.registration_id JOIN people p ON p.id=v.person_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hashToken(token)]);
 return rows[0]||null;
}
const vipShape=v=>({id:v.id,person_id:v.person_id,name:v.person_name||v.full_name,created_at:v.created_at});
async function startVipSession(client,registrationId) {
 const token=randomToken(),csrf=randomToken();
 await client.query('INSERT INTO vip_sessions(token_hash,registration_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval \'90 days\')',[hashToken(token),registrationId,csrf]);
 return {token,csrf};
}
export async function currentPrize(client={query}) {
 const month=today().slice(0,7);
 const {rows}=await client.query('SELECT description FROM monthly_prizes WHERE month=$1',[month]);
 if(rows[0])return rows[0].description;
 const old=(await client.query('SELECT value FROM settings WHERE key=\'monthly_prize\'')).rows[0]?.value;
 return typeof old==='string'?old:'No prize set yet';
}
publicRouter.get('/config',async(req,res)=>{
 const settings=Object.fromEntries((await query('SELECT key,value FROM settings WHERE key=ANY($1::text[])',[['church_name','service_name','church_address','church_contact','privacy_contact']])).rows.map(r=>[r.key,r.value]));
 res.json({...siteUrls(req),settings,today:today(),server_time:new Date().toISOString(),timezone:'Asia/Manila',preview:process.env.LOCAL_DEMO==='true',hosted_preview:process.env.HOSTED_PREVIEW==='true',legacy_restore_enabled:process.env.LEGACY_VIP_RESTORE==='true',database_kind:process.env.LOCAL_DEMO==='true'?'Local PostgreSQL demonstration':'Neon PostgreSQL'});
});
publicRouter.get('/prize',async(req,res)=>res.json({value:await currentPrize(),month:today().slice(0,7)}));
publicRouter.get('/calendar-events',async(req,res)=>res.json(await publicCalendar(String(req.query.from||''),String(req.query.to||''))));
publicRouter.get('/calendar-upcoming',async(req,res)=>res.json({today:today(),events:await upcomingEvents(req.query.days,req.query.limit)}));
publicRouter.get('/calendar.ics',async(req,res)=>{
 const days=Math.min(Math.max(Number(req.query.days)||210,14),400);
 res.type('text/calendar').attachment('lifegen-events.ics').send(calendarToIcs(await upcomingEvents(days,60)));
});
publicRouter.get('/event.ics',async(req,res)=>{
 const id=String(req.query.id||'');
 let event=null;
 if(/^sun-\d{4}-\d{2}-\d{2}$/.test(id))event=weeklySundayShape(id.slice(4));
 else if(/^\d+$/.test(id)){const row=await getEvent(id);if(row&&row.is_published)event=publicShape(row);}
 if(!event)throw httpError(404,'That event is no longer on the calendar.');
 res.type('text/calendar').attachment(`lifegen-${event.recurring?'sunday-service':'event'}.ics`).send(['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//LIFEGEN//Events calendar//EN',eventToIcs(event,new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z/,'Z')),'END:VCALENDAR',''].join('\r\n'));
});
publicRouter.get('/vip',async(req,res)=>{
 const vip=await readVip(req);if(!vip)return res.json({registered:false,today:today(),timezone:'Asia/Manila'});
 const month=today().slice(0,7);
 const present=(await query('SELECT s.service_date AS date_key FROM records r JOIN services s ON s.id=r.service_id WHERE r.person_id=$1 AND r.status=\'present\' AND s.service_date>=$2::date AND s.service_date<($2::date+interval \'1 month\')',[vip.person_id,month+'-01'])).rows;
 const checkins=(await query('SELECT date_key,status FROM vip_checkins WHERE registration_id=$1 AND date_key>=$2::date AND date_key<($2::date+interval \'1 month\')',[vip.id,month+'-01'])).rows;
 const map=new Map(checkins.map(r=>[r.date_key,r.status]));for(const r of present)map.set(r.date_key,'valid');
 const days=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();let sundayCount=0;for(let n=1;n<=days;n++)if(isSunday(month+'-'+String(n).padStart(2,'0')))sundayCount++;const validatedCount=[...map].filter(([day,status])=>status==='valid'&&isSunday(day)).length;
 res.json({registered:true,vip:vipShape(vip),csrf_token:vip.csrf_token,today:today(),timezone:'Asia/Manila',month,validated_count:validatedCount,sundays_this_month:sundayCount,prize_unlocked:validatedCount>=sundayCount,checkins:[...map].sort((a,b)=>a[0].localeCompare(b[0])).map(([date_key,status])=>({date_key,status})),prize:await currentPrize()});
});
publicRouter.post('/registrations',async(req,res)=>{
 checkOrigin(req);await rateLimit(req,'registration',15);
 const b=req.body||{};
 if(b.website)throw httpError(400,'Please leave the website field empty.');
 if(b.privacy_consent!==true)throw httpError(400,'Please read and agree to the privacy notice.');
 const name=String(b.full_name||'').trim().replace(/\s+/g,' '),age=Number(b.age),school=String(b.school||'').trim(),inviter=String(b.inviter||'').trim(),contact=String(b.contact||'').trim()||null;
 if(name.length<2||name.length>200||!Number.isInteger(age)||age<1||age>120||!school||school.length>300||!inviter||inviter.length>200)throw httpError(400,'Enter a valid name, age, school/institution and inviter.');
 if(contact&&contact.replace(/\D/g,'').length<7)throw httpError(400,'Contact number looks too short.');
 const rawKey=String(b.idempotency_key||'');if(!/^[a-zA-Z0-9_\-]{16,100}$/.test(rawKey))throw httpError(400,'Registration request key is missing. Reload and try again.');const key=hashToken(rawKey);
 const existing=await readVip(req);
 if(existing)return res.json({vip:vipShape(existing),already_registered:true});
 const result=await withState(async({data,client})=>{
  const duplicate=(await client.query('SELECT * FROM vip_registrations WHERE idempotency_key=$1',[key])).rows[0];
  if(duplicate){const session=await startVipSession(client,duplicate.id);return {vip:vipShape(duplicate),session,already_registered:true};}
  const parts=name.split(' ');const p=await domain.createPerson({first_name:parts.shift(),last_name:parts.join(' '),full_name:name,age,school,inviter,contact_number:contact,status:'first_timer',registration_source:'vip',privacy_consent:true});
  const id=stateId(data,'vip_registrations');const recovery='LG-'+randomToken();
  await client.query('INSERT INTO vip_registrations(id,person_id,full_name,age,school,inviter,contact,recovery_hash,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,p.id,name,age,school,inviter,contact,hashToken(recovery),key]);
  const session=await startVipSession(client,id);
  await logAction(client,null,'vip_registrations',id,'public_registration',{person_id:p.id});
  return {vip:{id,person_id:p.id,name,created_at:new Date().toISOString()},recovery_code:recovery,session};
 },{write:true});
 setVipCookie(req,res,result.session.token);delete result.session;res.status(result.already_registered?200:201).json(result);
});
publicRouter.post('/vip/restore',async(req,res)=>{
 checkOrigin(req);await rateLimit(req,'vip-recovery',10);
 const legacy=Boolean(req.body?.legacy_token);if(legacy&&process.env.LEGACY_VIP_RESTORE!=='true')throw httpError(400,'This is a fresh registration system. Please register again or use your new VIP recovery code.');
 const code=String(req.body?.recovery_code||req.body?.legacy_token||'').trim();if(code.length<16||code.length>200)throw httpError(400,'Enter your saved recovery code.');
 const col=req.body?.legacy_token?'legacy_token_hash':'recovery_hash';
 const result=await transaction(async client=>{
  const v=(await client.query(`SELECT * FROM vip_registrations WHERE "${col}"=$1`,[hashToken(code)])).rows[0];if(!v)throw httpError(404,legacy?'The old portal could not be found in the imported records. Contact the LIFEGEN team.':'Recovery code not recognized. Check the code or ask a LIFEGEN leader for a replacement.');
  return {vip:vipShape(v),session:await startVipSession(client,v.id)};
 });
 setVipCookie(req,res,result.session.token);res.json({vip:result.vip});
});
publicRouter.post('/checkins',async(req,res)=>{
 checkOrigin(req);await rateLimit(req,'checkin',20);
 const vip=await readVip(req);if(!vip)throw httpError(401,'Register or recover your VIP portal first.');
 if(!safeEqual(req.get('x-csrf-token'),vip.csrf_token))throw httpError(403,'Refresh your portal before checking in.');
 const day=today();if(!isSunday(day))throw httpError(400,'Check-in is available on Sundays only, using Asia/Manila time.');
 const result=await transaction(async client=>{
  const old=(await client.query('SELECT * FROM vip_checkins WHERE registration_id=$1 AND date_key=$2',[vip.id,day])).rows[0];if(old){if(old.status==='invalid')return (await client.query("UPDATE vip_checkins SET status='pending',validated_by=NULL,validated_at=NULL WHERE id=$1 RETURNING id,date_key,status",[old.id])).rows[0];return old;}
  const id=await allocateId(client,'vip_checkins');
  return (await client.query('INSERT INTO vip_checkins(id,registration_id,date_key) VALUES($1,$2,$3) RETURNING id,date_key,status',[id,vip.id,day])).rows[0];
 });res.json(result);
});
publicRouter.get('/posts',async(req,res)=>{
 const reactor=req.cookies?.lg_reactor?hashToken(req.cookies.lg_reactor):'';
 const {rows}=await query('SELECT p.id,p.type,CASE WHEN p.is_anonymous THEN NULL ELSE p.author END AS author,p.content,p.is_anonymous,p.created_at,(SELECT count(*)::int FROM prayer_reactions r WHERE r.post_id=p.id) AS prayer_count,EXISTS(SELECT 1 FROM prayer_reactions r WHERE r.post_id=p.id AND r.visitor_hash=$1) AS prayed FROM community_posts p WHERE NOT p.is_hidden ORDER BY p.created_at DESC LIMIT 200',[reactor]);
 res.json(rows);
});
publicRouter.post('/posts',async(req,res)=>{
 checkOrigin(req);await rateLimit(req,'prayer-post',10);
 const b=req.body||{},content=String(b.content||'').trim();const type=b.type,anonymous=b.is_anonymous===true||!String(b.author||'').trim();const author=anonymous?null:String(b.author).trim().slice(0,120);
 if(!['prayer','testimony','praise'].includes(type)||content.length<3||content.length>1000)throw httpError(400,'Choose a post type and write 3–1000 characters.');
 const result=await transaction(async client=>{const id=await allocateId(client,'community_posts');return (await client.query('INSERT INTO community_posts(id,type,author,content,is_anonymous) VALUES($1,$2,$3,$4,$5) RETURNING id,type,author,content,is_anonymous,created_at',[id,type,author,content,anonymous])).rows[0];});
 res.status(201).json(result);
});
publicRouter.post('/posts/:id/pray',async(req,res)=>{
 checkOrigin(req);await rateLimit(req,'prayer-reaction',100,60);
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)throw httpError(400,'Invalid post.');
 let reactor=req.cookies?.lg_reactor;if(!reactor){reactor=randomToken();res.cookie('lg_reactor',reactor,{...cookieOptions(req),maxAge:90*86400000});}
 const count=await transaction(async client=>{
  if(!(await client.query('SELECT id FROM community_posts WHERE id=$1 AND NOT is_hidden',[id])).rows.length)throw httpError(404,'Post not found.');
  await client.query('INSERT INTO prayer_reactions(post_id,visitor_hash) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,hashToken(reactor)]);
  return (await client.query('SELECT count(*)::int AS total FROM prayer_reactions WHERE post_id=$1',[id])).rows[0].total;
 });res.json({prayer_count:count,prayed:true});
});
publicRouter.get('/service.ics',(req,res)=>{
 const day=new Date(today()+'T12:00:00Z');while(day.getUTCDay()!==0)day.setUTCDate(day.getUTCDate()+1);
 const date=day.toISOString().slice(0,10).replaceAll('-','');
 const cal=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//LIFEGEN//Sunday service//EN','BEGIN:VEVENT','UID:lifegen-sunday-service@lifegen', `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z/,'Z')}`,`DTSTART:${date}T050000Z`,`DTEND:${date}T070000Z`,'RRULE:FREQ=WEEKLY;BYDAY=SU','SUMMARY:LIFEGEN Sunday Service','LOCATION:Lifegiver Church of Faith - Central','DESCRIPTION:Sunday service from 1 to 3 PM Asia/Manila.','BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY','DESCRIPTION:LIFEGEN service starts in one hour.','END:VALARM','END:VEVENT','END:VCALENDAR',''].join('\r\n');
 res.type('text/calendar').attachment('lifegen-sunday-service.ics').send(cal);
});
