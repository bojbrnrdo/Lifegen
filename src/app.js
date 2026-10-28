import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import {signServicePass} from './service-qr.js';
import { query, transaction, withState, runDomain, logAction, stateId, connectionHint } from './db.js';
import { domain, today, httpError, fullNameSafe, DEFAULT_SETTINGS, isSunday } from './domain.js';
import { peopleList, peopleSearch, dashboardRead } from './read-model.js';
import { publicRouter, siteUrls, currentPrize } from './public-api.js';
import { listDesigns, countDesigns, createDesign, updateDesign, deleteDesign, readDesignBytes, designForSunday, setSelection, previewRandomPick, selectableSundays, storageKind, MAX_BYTES, ALLOWED_TYPES, attributeServiceDate } from './vip-designs.js';
import { listGiftTracker, markGiftGiven, undoGiftGiven } from './gift-tracker.js';
import { readStaff, publicUser, requireStaff, requirePermission, checkCsrf, checkOrigin, rateLimit, setupAdmin, login, changePassword, userAccounts, setStaffCookie, clearStaffCookie, redactForViewer, randomToken, hashToken, previewSessionTokensEnabled, passwordHash, safeEqual } from './auth.js';
import { exportBackup } from './migration.js';
import { streamEvents, revision } from './events.js';
import { storedEvents, publicShape, insertEvent, updateEvent, validateEventInput, mergeWithWeeklySundays, CATEGORY_LABELS } from './calendar.js';
import {createDeploymentRouter,deploymentHelperEnabled} from './deployment.js';
import {registerDevWorkspace} from './dev-workspace.js';
import { handleLifegroupMethod } from './lifegroups.js';
import {authorizeLinkedLeaderTrackerMethod} from './leader-tracker-policy.js';
import {resolveLeaderScope} from './leader-scope.js';
import {assertGlobalExportAccess} from './leader-export-policy.js';
import { listServices, serviceByDate, serviceDetail, serviceAudit, openService, markAttendance, undoAttendance, updateService, reportYears, reportSummary, exportAttendanceCsv } from './attendance.js';
const app=express();
const ADMIN_ASSET_VERSION='2.4.5';
// VIP profile status is promoted to Member at five distinct present Sundays.
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const production=process.env.NODE_ENV==='production'||Boolean(process.env.VERCEL);
app.disable('x-powered-by');if(process.env.VERCEL||process.env.LOCAL_DEMO==='true'||process.env.HOSTED_PREVIEW==='true'||process.env.TRUST_PROXY==='true')app.set('trust proxy',1);
app.use((req,res,next)=>{res.locals.nonce=crypto.randomBytes(16).toString('base64');next();});
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'",(req,res)=>`'nonce-${res.locals.nonce}'`],styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],fontSrc:["'self'",'data:','https://fonts.gstatic.com'],imgSrc:["'self'",'data:','blob:'],connectSrc:["'self'"],frameSrc:["'self'",'https://www.youtube-nocookie.com','https://www.youtube.com','https://player.vimeo.com','https://www.facebook.com','https://drive.google.com'],mediaSrc:["'self'",'https:'],objectSrc:["'none'"],baseUri:["'self'"],formAction:["'self'"],frameAncestors:production?["'self'"]:null,upgradeInsecureRequests:production?[]:null}},xFrameOptions:production?{action:'sameorigin'}:false,crossOriginEmbedderPolicy:false}));
app.use(cookieParser());
app.use(express.json({limit:'512kb'}));
registerDevWorkspace(app);
// Gzip/deflate responses (HTML, CSS, JS, JSON, ICS) whenever the client accepts it.
// The SSE live-update stream is excluded so events are never delayed by buffering.
app.use(compression({filter:(req,res)=>{const type=String(res.getHeader('Content-Type')||'');if(type.includes('text/event-stream')||type.includes('application/zip'))return false;return compression.filter(req,res);}}));
// All tracker and public API payloads are small JSON documents (the deployment ZIP
// upload uses its own raw-body parser with a separate limit).
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.use('/api/public',publicRouter);
app.use('/api/deploy',createDeploymentRouter());
app.get('/api/health',async(req,res)=>{try{const r=await query('SELECT to_regclass(\'public.people\') IS NOT NULL AS schema_ready');res.status(r.rows[0].schema_ready?200:503).json({ok:r.rows[0].schema_ready,database:process.env.LOCAL_DEMO==='true'?'local-postgresql-demo':'supabase-postgresql'});}catch(e){const hint=connectionHint(e);console.error('[LIFEGEN health]',e.code||e.name,hint||'Database connection unavailable. Details withheld from the public response.');res.status(503).json({ok:false,message:'Set the private Supabase PostgreSQL connection and apply the SQL migrations.'});}});
// Read-only environment metadata. Never expose environment variables or secret values.
app.get('/api/admin/developer-info', requireStaff, (req,res)=>{
 try{
  if(req.actor?.role_id!=='admin')return res.status(403).json({error:'Administrator access required'});
  const clean=value=>String(value||'').slice(0,120).replace(/[^a-zA-Z0-9._\/-]/g,'');
  res.set('Cache-Control','no-store').json({
   environment:clean(process.env.VERCEL_ENV||(process.env.NODE_ENV==='production'?'production':'local')),
   branch:clean(process.env.VERCEL_GIT_COMMIT_REF),
   commit:clean(process.env.VERCEL_GIT_COMMIT_SHA).slice(0,12),
   deployment:clean(process.env.VERCEL_URL)
  });
 }catch(nextError){res.status(500).json({error:'Deployment metadata unavailable'});}
});
app.get('/api/auth/status',async(req,res)=>{
 const user=await readStaff(req);const settings=Object.fromEntries((await query('SELECT key,value FROM settings WHERE key=ANY($1::text[])',[Object.keys(DEFAULT_SETTINGS)])).rows.map(r=>[r.key,r.value]));
 const count=Number((await query('SELECT count(*) FROM staff_users')).rows[0].count);
 res.json({user:user?publicUser(user):null,csrf_token:user?.csrf_token||null,settings,needs_setup:count===0,setup_available:Boolean(process.env.SETUP_KEY?.length>=32),auth_disabled:false,standalone:false,demo_loaded:(await query('SELECT EXISTS(SELECT 1 FROM people WHERE is_demo=true) AS loaded')).rows[0].loaded,preview:process.env.LOCAL_DEMO==='true',hosted_preview:process.env.HOSTED_PREVIEW==='true',deploy_helper_enabled:deploymentHelperEnabled(),preview_session_tokens_enabled:previewSessionTokensEnabled(),today:today(),timezone:'Asia/Manila',...siteUrls(req)});
});
app.post('/api/auth/setup',async(req,res)=>{checkOrigin(req);await rateLimit(req,'admin-setup',8);const r=await setupAdmin(req.body);setStaffCookie(req,res,r.token);res.status(201).json({user:r.user,csrf_token:r.csrf_token,...(previewSessionTokensEnabled()?{preview_session_token:r.token}:{})});});
app.post('/api/auth/login',async(req,res)=>{checkOrigin(req);await rateLimit(req,'staff-login',30);const r=await login(req.body);setStaffCookie(req,res,r.token);res.json({user:r.user,csrf_token:r.csrf_token,...(previewSessionTokensEnabled()?{preview_session_token:r.token}:{})});});
app.post('/api/auth/admin-recovery',async(req,res)=>{
 checkOrigin(req);await rateLimit(req,'admin-password-recovery',5,15);
 if(!process.env.SETUP_KEY||process.env.SETUP_KEY.length<32||!safeEqual(req.body.setup_key,process.env.SETUP_KEY))throw httpError(403,'The private recovery code is incorrect or is not configured.');
 const username=String(req.body.username||'').trim().toLowerCase();
 if(!/^[a-z0-9._@+\\-]{3,100}$/.test(username))throw httpError(400,'Enter the admin username used for this account.');
 const hashed=await passwordHash(req.body.password);
 await transaction(async client=>{
  const account=(await client.query("SELECT id,display_name FROM staff_users WHERE lower(username)=$1 AND role_id='admin' AND is_active=true FOR UPDATE",[username])).rows[0];
  if(!account)throw httpError(404,'No active admin account matches that username.');
  await client.query('UPDATE staff_users SET password_hash=$1,failed_attempts=0,locked_until=NULL WHERE id=$2',[hashed,account.id]);
  await client.query('DELETE FROM staff_sessions WHERE user_id=$1',[account.id]);
  await logAction(client,{display_name:'Admin account owner'},'staff_users',account.id,'password_reset_with_private_recovery_code');
 });
 res.json({ok:true});
});
app.post('/api/auth/logout',requireStaff,async(req,res)=>{checkOrigin(req);checkCsrf(req);await query('DELETE FROM staff_sessions WHERE token_hash=$1',[req.actor.session_hash]);clearStaffCookie(req,res);res.json({});});
app.post('/api/auth/password',requireStaff,async(req,res)=>{checkOrigin(req);checkCsrf(req);res.json(await changePassword(req.actor,req.body.current,req.body.next));});
app.get('/api/events',requireStaff,async(req,res)=>res.json({revision:await revision()}));
app.get('/api/events/stream',requireStaff,async(req,res)=>{requirePermission(req.actor,'dashboard:view');await streamEvents(req,res);});
const methods={
 people:['people:view',false],person:['people:view',false],duplicates:['people:write',false],search:['people:view',false],
 calendarEvents:['dashboard:view',false],saveCalendarEvent:['calendar:manage',true],deleteCalendarEvent:['calendar:manage',true],
 services:['attendance:view',false],serviceByDate:['attendance:view',false],service:['attendance:view',false],serviceAudit:['attendance:view',false],openService:['attendance:write',true],mark:['attendance:write',true],undoMark:['attendance:write',true],updateService:['attendance:write',true],reportYears:['reports:view',false],reportSummary:['reports:view',false],
 createPerson:['people:write',true],updatePerson:['people:write',true],archivePerson:['people:delete',true],restorePerson:['people:delete',true],setPersonStatus:['people:write',true],deletePerson:['people:delete',true],
 dashboard:['dashboard:view',false],
 saveSettings:['settings:manage',true],demoStatus:['settings:manage',false],demoLoad:['settings:manage',true],demoRemove:['settings:manage',true],
 users:['users:manage',false],roles:['users:manage',false],createUser:['users:manage',true],updateUser:['users:manage',true],system:['settings:manage',false],activity:['people:view',false],
 registrations:['registrations:manage',false],registerAdminVip:['registrations:manage',true],
 leaderScope:['lifegroups:view',false],lifegroupOverview:['lifegroups:view',false],lifegroups:['lifegroups:view',false],lifegroupOptions:['lifegroups:view',false],lifegroupNeeds:['lifegroups:view',false],lifegroupRecommend:['lifegroups:view',false],vipAssignmentPolicy:['lifegroups:view',false],saveVipAssignmentPolicy:['lifegroups:manage',true],lifegroup:['lifegroups:view',false],lifegroupProgress:['lifegroups:view',false],progressOverview:['lifegroups:view',false],networkCalendar:['lifegroups:view',false],networks:['lifegroups:view',false],network:['lifegroups:view',false],
 removeNetworkFromTree:['lifegroups:manage',true],removeCellLeaderFromTree:['lifegroups:manage',true],removeMemberFromTree:['lifegroups:manage',true],createLifegroup:['lifegroups:manage',true],updateLifegroup:['lifegroups:manage',true],deleteLifegroup:['lifegroups:manage',true],assignLifegroup:['lifegroups:manage',true],autoAssignLifegroup:['lifegroups:manage',true],leaveLifegroup:['lifegroups:manage',true],setTier:['lifegroups:manage',true],setDiscipleshipClassification:['lifegroups:manage',true],createNetworkStructure:['lifegroups:manage',true],createNetwork:['lifegroups:manage',true],updateNetwork:['lifegroups:manage',true],deleteNetwork:['lifegroups:manage',true],ensureNetworkLeaderGroup:['lifegroups:manage',true],saveMeeting:['lifegroups:manage',true],deleteMeeting:['lifegroups:manage',true],
 registration:['registrations:manage',false],registrationCounts:['registrations:manage',false],reviewRegistration:['registrations:manage',true],recoverRegistration:['registrations:manage',true],pendingCheckins:['registrations:manage',false],
 // VIP Gift Tracker — reads for admin and staff (registrations:manage); the viewer role has neither.
 giftTracker:['registrations:manage',false],markGiftGiven:['registrations:manage',true],undoGiftGiven:['registrations:manage',true],validateCheckin:['attendance:write',true],getPrize:['registrations:manage',false],setPrize:['settings:manage',true],qrRegistration:['registrations:manage',false],serviceQr:['attendance:view',false],postsAdmin:['settings:manage',false],moderatePost:['settings:manage',true],editPost:['settings:manage',true],deletePost:['settings:manage',true]
};
const validId=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw httpError(400,'Invalid record ID.');return n;};
async function customMethod(req,name,args) {
 const actor=req.actor;
 // Hot read paths: answer from narrow SQL queries instead of loading every tracker table.
 if(name==='dashboard')return dashboardRead();
 if(name==='services')return listServices(args[0]||{});
 if(name==='serviceByDate')return serviceByDate(args[0],actor);
 if(name==='service')return serviceDetail(args[0]);
 if(name==='serviceAudit')return serviceAudit(args[0]);
 if(name==='openService')return openService(args[0],actor);
 if(name==='serviceQr'){
  const serviceId=validId(args[0]);
  const record=(await query('SELECT id,service_date::text AS service_date,service_type FROM services WHERE id=$1',[serviceId])).rows[0];
  if(!record||record.service_type!=='lifegen')throw httpError(404,'Sunday LIFEGEN service not found.');
  const {public_url}=siteUrls(req);
  const url=new URL('/checkin/',public_url.startsWith('http')?public_url:`${req.protocol}://${req.get('host')}`);
  url.searchParams.set('t',signServicePass(record.id,record.service_date));
  return {service_id:record.id,service_date:record.service_date,url:url.toString(),svg:await QRCode.toString(url.toString(),{type:'svg',width:360,margin:2})};
 }

 if(name==='mark')return markAttendance(args[0],args[1],args[2],args[3],args[4],actor);
 if(name==='undoMark')return undoAttendance(args[0],args[1],args[2],actor);
 if(name==='updateService')return updateService(args[0],args[1]||{},actor);
 if(name==='reportYears')return reportYears();
 if(name==='reportSummary')return reportSummary(args[0]||{});
 if(name==='people')return peopleList(args[0]||{},req.leaderCellIds??null);
 if(name==='search')return peopleSearch(args[0],args[1]||{});
 if(name==='calendarEvents'){
  const months=Math.min(Math.max(Number(args[0]?.months)||13,1),25);
  const now=new Date(today()+'T12:00:00');
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const from=iso(new Date(now.getFullYear(),now.getMonth()-1,1)),to=iso(new Date(now.getFullYear(),now.getMonth()+months+1,1));
  const stored=(await storedEvents(from,to,{includeDrafts:true})).map(e=>({...e,date:e.event_date}));
  return {from,to,today:today(),labels:CATEGORY_LABELS,events:mergeWithWeeklySundays(stored,from,to)};
 }
 if(name==='saveCalendarEvent')return transaction(async client=>{
  const fields=validateEventInput(args[0]||{});
  let row;
  if(args[0]?.id!==undefined&&args[0]?.id!==null&&args[0]?.id!==''){
   const id=validId(args[0].id);
   row=await updateEvent(client,id,fields);
   if(!row)throw httpError(404,'That event is no longer on the calendar.');
   await logAction(client,actor,'calendar_events',id,'update',{title:fields.title,date:fields.event_date});
  }else{
   row=await insertEvent(client,fields,actor.id);
   await logAction(client,actor,'calendar_events',row.id,'create',{title:fields.title,date:fields.event_date});
  }
  return publicShape(row);
 });
 if(name==='deleteCalendarEvent')return transaction(async client=>{
  const id=validId(args[0]);
  const gone=(await client.query('DELETE FROM calendar_events WHERE id=$1 RETURNING id,title',[id])).rows[0];
  if(!gone)throw httpError(404,'That event is no longer on the calendar.');
  await logAction(client,actor,'calendar_events',id,'delete',{title:gone.title});
  return {};
 });
 if(['users','roles','createUser','updateUser'].includes(name))return userAccounts(actor,name,args);
 if(name==='system'){
  const counts={};for(const t of ['people','services','records','staff_users'])counts[t]=(await query(`SELECT count(*) FROM "${t}"`)).rows[0].count;
  return {counts:{people:counts.people,services:counts.services,attendance_records:counts.records,users:counts.staff_users},db_file:process.env.LOCAL_DEMO==='true'?'Local PostgreSQL demonstration':'Supabase PostgreSQL',node:process.versions.node,migrations:(await query('SELECT * FROM schema_migrations ORDER BY applied_at')).rows};
 }
 if(name==='activity')return (await query('SELECT actor_name,action,details,created_at FROM audit_log WHERE entity=\'people\' AND entity_id=$1 ORDER BY id DESC LIMIT 100',[String(validId(args[0]))])).rows;
 if(name==='registrationCounts')return (await query('SELECT count(*)::int AS total,count(*) FILTER(WHERE review_status=\'new\')::int AS pending,count(*) FILTER(WHERE review_status=\'reviewed\')::int AS reviewed FROM vip_registrations')).rows[0];
 if(name==='registrations'){
  const p=args[0]||{},filter=['new','reviewed'].includes(p.status)?p.status:null;
  const t=today(),monthStart=t.slice(0,8)+'01';
  const {rows}=await query('SELECT v.id,v.person_id,v.full_name,v.age,v.school,v.inviter,v.contact,v.review_status,v.created_at,v.reviewed_at,p.person_code,p.status AS person_status,coalesce(a.sundays_attended,0)::int AS sundays_attended FROM vip_registrations v JOIN people p ON p.id=v.person_id LEFT JOIN LATERAL (SELECT count(DISTINCT s.service_date)::int AS sundays_attended,min(s.service_date)::text AS first_attended,max(s.service_date)::text AS last_attended FROM records r JOIN services s ON s.id=r.service_id WHERE r.person_id=p.id AND r.status=\'present\') a ON true WHERE ($1::text IS NULL OR v.review_status=$1) AND ($2::text=\'\' OR v.full_name ILIKE $2 OR coalesce(v.contact,\'\') ILIKE $2 OR coalesce(v.inviter,\'\') ILIKE $2) ORDER BY v.created_at DESC LIMIT 1000',[filter,p.q?`%${String(p.q).slice(0,150)}%`:'']);
  // Consecutive-week streak within the current month, capped at 4/4. A VIP needs
  // 4 Sundays IN A ROW (no specific week required). Missing a past Sunday resets
  // the streak; once a streak of 4 is reached the month is latched "complete".
  const sundays=(await query('SELECT service_date::text AS d FROM services WHERE service_date>=$1 AND service_date<=$2 ORDER BY service_date',[monthStart,t])).rows.map(r=>r.d);
  const attendedBy={};
  if(rows.length&&sundays.length){
   const att=(await query('SELECT r.person_id,s.service_date::text AS d FROM records r JOIN services s ON s.id=r.service_id WHERE r.status=\'present\' AND s.service_date>=$1 AND s.service_date<=$2',[monthStart,t])).rows;
   for(const a of att){(attendedBy[a.person_id]??=new Set()).add(a.d);}
  }
  for(const r of rows){
   const attended=attendedBy[r.person_id]||new Set();
   let streak=0;
   for(let k=sundays.length-1;k>=0;k--){
    const d=sundays[k];
    if(attended.has(d)){streak=Math.min(streak+1,4);continue;}
    if(d===t)continue;
    break;
   }
   let best=0,run=0;
   for(const d of sundays){
    if(d>t)break;
    if(attended.has(d)){run++;if(run>best)best=run;}
    else if(d!==t)run=0;
   }
   r.streak=streak;
   r.best_streak=Math.min(best,4);
   r.completed=best>=4;
   r.month_start=monthStart;
  }
  // Graduate completed VIPs to Regular attendee (they leave the prize pool).
  const graduate=rows.filter(r=>r.completed&&(r.person_status==='first_timer'||r.person_status==='new_believer'));
  if(graduate.length){
   await transaction(async client=>{
    for(const r of graduate){
     const u=await client.query("UPDATE people SET status='regular',updated_at=now() WHERE id=$1 AND status IN ('first_timer','new_believer')",[r.person_id]);
     if(u.rowCount)await logAction(client,actor,'people',r.person_id,'vip_completed_4_week_streak',{month:r.month_start});
    }
   });
   for(const r of graduate)r.person_status='regular';
  }
  return {items:rows};
 }
 // VIP Gift Tracker: the read is derived live from existing records; the two
 // writes only ever touch the additive vip_gift_handouts table.
 if(name==='giftTracker')return listGiftTracker();
 if(name==='markGiftGiven')return transaction(async client=>await markGiftGiven({personId:args[0],actor},client),{write:true});
 if(name==='undoGiftGiven')return transaction(async client=>await undoGiftGiven({personId:args[0],actor},client),{write:true});
 if(name==='setPersonStatus'&&args[1]==='inactive'){
  const personId=validId(args[0]);
  return transaction(async client=>{
    const p=(await client.query('SELECT id,first_name,last_name,status,archived_at FROM people WHERE id=$1 FOR UPDATE',[personId])).rows[0];
    if(!p||p.archived_at)throw httpError(404,'Active People record not found.');
    const leaderNetwork=(await client.query('SELECT id FROM networks WHERE leader_person_id=$1 AND is_active LIMIT 1',[personId])).rows[0];
    const leaderCell=(await client.query('SELECT id FROM lifegroups WHERE leader_person_id=$1 AND is_active LIMIT 1',[personId])).rows[0];
    if(leaderNetwork||leaderCell)throw httpError(409,'Reassign active Network or Cell leadership before deactivating this person.');
    const closed=(await client.query(`UPDATE lifegroup_memberships
      SET left_at=GREATEST(joined_at,$2::date)
      WHERE person_id=$1 AND left_at IS NULL RETURNING id,lifegroup_id`,[personId,today()])).rows;
    for(const membership of closed)
      await logAction(client,actor,'lifegroup_memberships',membership.id,'left_on_deactivation',{person_id:personId,lifegroup_id:membership.lifegroup_id});
    if(p.status!=='inactive'){
      await client.query("UPDATE people SET status='inactive',updated_at=now() WHERE id=$1",[personId]);
      await logAction(client,actor,'people',personId,'deactivate',{previous_status:p.status,closed_memberships:closed.length});
    }
    return {id:personId,status:'inactive',closed_memberships:closed.length};
  });
 }
 if(name==='registerAdminVip'){
  requirePermission(actor,'people:write');
  const input=args[0]||{};
  if(input.privacy_consent!==true)throw httpError(400,'Consent is required.');
  const first=String(input.first_name||'').trim(),last=String(input.last_name||'').trim();
  const gender=String(input.sex||'').trim(),school=String(input.school||'').trim(),inviter=String(input.inviter||'').trim();
  const age=Number(input.age),contact=String(input.contact_number||'').trim()||null;
  const key=String(input.idempotency_key||'').trim();
  const existingId=input.existing_person_id?validId(input.existing_person_id):null;
  if((!existingId&&(!first||!last))||first.length>120||last.length>120)throw httpError(400,'Enter first and last names or choose an existing Person ID.');
  if(!['male','female'].includes(gender))throw httpError(400,'Choose Boy or Girl.');
  if(!Number.isInteger(age)||age<1||age>120||!school||school.length>300||!inviter||inviter.length>200)throw httpError(400,'Provide age, school and inviter.');
  if(contact&&contact.replace(/\D/g,'').length<7)throw httpError(400,'Contact number looks too short.');
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(key))throw httpError(400,'Invalid registration request key.');
  const hashed=hashToken(key);
  return withState(async({data,client})=>{
    const prior=(await client.query('SELECT id,person_id FROM vip_registrations WHERE idempotency_key=$1',[hashed])).rows[0];
    if(prior)return {person_id:Number(prior.person_id),vip_registration_id:Number(prior.id),already_registered:true};
    let person;
    if(existingId){
      person=(await client.query('SELECT id,first_name,last_name,sex,archived_at FROM people WHERE id=$1 FOR UPDATE',[existingId])).rows[0];
      if(!person||person.archived_at)throw httpError(404,'Active People profile not found.');
      if(person.sex&&person.sex!==gender)throw httpError(409,'Existing People profile gender differs; update the profile before registering.');
      const previous=(await client.query('SELECT id,person_id FROM vip_registrations WHERE person_id=$1 ORDER BY id DESC LIMIT 1',[existingId])).rows[0];
      if(previous)return {person_id:Number(existingId),vip_registration_id:Number(previous.id),already_registered:true};
    }else{
      person=await domain.createPerson({
        first_name:first,last_name:last,full_name:first+' '+last,sex:gender,age,school,inviter,
        contact_number:contact,status:'first_timer',registration_source:'vip',privacy_consent:true,
        ...(input.photo?{photo:input.photo}:{})
      });
    }
    if(!existingId){
      const record=data.people.find(row=>Number(row.id)===Number(person.id));
      if(record)record.extras={...(record.extras||{}),discipleship_classification:'vip'};
    }
    const fullName=[person.first_name,person.last_name].filter(Boolean).join(' ');
    const id=stateId(data,'vip_registrations'),recovery='LG-'+randomToken();
    await client.query(`INSERT INTO vip_registrations
      (id,person_id,full_name,age,school,inviter,contact,recovery_hash,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id,person.id,fullName,age,school,inviter,contact,hashToken(recovery),hashed]);
    await logAction(client,actor,'vip_registrations',id,'staff_registration',{person_id:person.id});
    return {person_id:person.id,vip_registration_id:id,recovery_code:recovery,already_registered:false};
  },{write:true,actor});
 }
 if(name==='registration'){
  const r=(await query('SELECT v.id,v.person_id,v.full_name,v.age,v.school,v.inviter,v.contact,v.review_status,v.created_at,v.reviewed_at,p.person_code,p.status AS person_status FROM vip_registrations v JOIN people p ON p.id=v.person_id WHERE v.id=$1',[validId(args[0])])).rows[0];if(!r)throw httpError(404,'Registration not found.');return r;
 }
 if(name==='reviewRegistration')return transaction(async client=>{const id=validId(args[0]);const r=(await client.query('UPDATE vip_registrations SET review_status=\'reviewed\',reviewed_by=$1,reviewed_at=now() WHERE id=$2 RETURNING id,person_id,review_status',[actor.id,id])).rows[0];if(!r)throw httpError(404,'Registration not found.');await logAction(client,actor,'vip_registrations',id,'reviewed');return r;});
 if(name==='recoverRegistration')return transaction(async client=>{const id=validId(args[0]),code='LG-'+randomToken();if(!(await client.query('UPDATE vip_registrations SET recovery_hash=$1 WHERE id=$2 RETURNING id',[hashToken(code),id])).rows.length)throw httpError(404,'Registration not found.');await logAction(client,actor,'vip_registrations',id,'recovery_code_rotated');return {recovery_code:code};});
 if(name==='pendingCheckins')return (await query('SELECT c.id,c.date_key,c.created_at,c.registration_id,v.person_id,v.full_name,p.person_code FROM vip_checkins c JOIN vip_registrations v ON v.id=c.registration_id JOIN people p ON p.id=v.person_id WHERE c.status=\'pending\' ORDER BY c.created_at DESC')).rows;
 if(name==='validateCheckin')return withState(async({data,client})=>{
  const id=validId(args[0]),valid=args[1]===true;
  const c=(await client.query('SELECT c.*,v.person_id FROM vip_checkins c JOIN vip_registrations v ON v.id=c.registration_id WHERE c.id=$1 FOR UPDATE',[id])).rows[0];if(!c)throw httpError(404,'Check-in not found.');
  if(valid){const s=await domain.openService(c.date_key);const before=data.records.find(r=>r.person_id===c.person_id&&r.service_id===s.id);await domain.mark(s.id,c.person_id,'present');const r=data.records.find(r=>r.person_id===c.person_id&&r.service_id===s.id);if(!before||before.source==='vip'){r.source='vip';r.source_checkin_id=c.id;}}
  else {const s=data.services.find(s=>s.service_date===c.date_key),r=s&&data.records.find(r=>r.person_id===c.person_id&&r.service_id===s.id);if(r?.source==='vip'&&Number(r.source_checkin_id)===c.id)await domain.undoMark(s.id,c.person_id);}
  const status=valid?'valid':'invalid';await client.query('UPDATE vip_checkins SET status=$1,validated_by=$2,validated_at=now() WHERE id=$3',[status,actor.id,id]);await logAction(client,actor,'vip_checkins',id,status,{person_id:c.person_id});return {id,status};
 },{actor,write:true});

 if(name==='getPrize')return {value:await currentPrize(),month:today().slice(0,7)};
 if(name==='setPrize')return transaction(async client=>{const value=String(args[0]||'').trim();if(!value||value.length>1000)throw httpError(400,'Enter a prize description up to 1000 characters.');const month=today().slice(0,7);await client.query('INSERT INTO monthly_prizes(month,description) VALUES($1,$2) ON CONFLICT(month) DO UPDATE SET description=EXCLUDED.description,updated_at=now()',[month,value]);await logAction(client,actor,'monthly_prizes',month,'update');return {value,month};});
 if(name==='qrRegistration'){const {public_url}=siteUrls(req);let url=public_url+'#vip';if(public_url.startsWith('/'))url=`${req.protocol}://${req.get('host')}${url}`;return {url,svg:await QRCode.toString(url,{type:'svg',width:360,margin:2}),enabled:true};}
 if(name==='postsAdmin')return (await query('SELECT id,type,author,content,is_anonymous,is_hidden,created_at,(SELECT count(*)::int FROM prayer_reactions r WHERE r.post_id=community_posts.id) AS prayer_count FROM community_posts ORDER BY created_at DESC LIMIT 200')).rows;
 if(name==='moderatePost')return transaction(async client=>{const id=validId(args[0]),hidden=args[1]===true;if(!(await client.query('UPDATE community_posts SET is_hidden=$1 WHERE id=$2 RETURNING id',[hidden,id])).rows.length)throw httpError(404,'Post not found.');await logAction(client,actor,'community_posts',id,hidden?'hide':'show');return {};});
 // Community board moderation — edit a post in place, or delete it for good
 // (prayer_reactions cascade with the post; every step is written to the audit log).
 if(name==='editPost')return transaction(async client=>{
  const id=validId(args[0]),f=args[1]||{};
  const type=String(f.type||'');if(!['prayer','testimony','praise'].includes(type))throw httpError(400,'Choose prayer, testimony or praise.');
  const content=String(f.content||'').trim();if(!content||content.length>1000)throw httpError(400,'Write 1 to 1000 characters for the post message.');
  const anonymous=Boolean(f.is_anonymous);
  let author=null;if(!anonymous){author=String(f.author||'').trim().slice(0,60);if(!author)throw httpError(400,'Add a name for the author, or post anonymously.');}
  const row=(await client.query('UPDATE community_posts SET type=$1,author=$2,content=$3,is_anonymous=$4 WHERE id=$5 RETURNING id,type,author,content,is_anonymous,is_hidden,created_at',[type,author,content,anonymous,id])).rows[0];
  if(!row)throw httpError(404,'Post not found.');
  await logAction(client,actor,'community_posts',id,'update',{type,anonymous});
  return row;
 });
 if(name==='deletePost')return transaction(async client=>{
  const id=validId(args[0]);
  const gone=(await client.query('DELETE FROM community_posts WHERE id=$1 RETURNING id,type,is_anonymous',[id])).rows[0];
  if(!gone)throw httpError(404,'Post not found.');
  await logAction(client,actor,'community_posts',id,'delete',{type:gone.type,anonymous:gone.is_anonymous});
  return {};
 });
 return undefined;
}
app.use('/api/tracker',requireStaff,(req,res,next)=>{try{checkOrigin(req);checkCsrf(req);next();}catch(e){next(e);}});
app.post('/api/tracker/:method',async(req,res)=>{
 const name=req.params.method;if(!Object.hasOwn(methods,name))throw httpError(404,'Unknown tracker operation.');
 const args=req.body?.args||[];if(!Array.isArray(args)||args.length>6)throw httpError(400,'Invalid operation arguments.');
 const [permission,write]=methods[name];requirePermission(req.actor,permission);
 if(name==='leaderScope')return res.json(await resolveLeaderScope({query},req.actor));
 const leaderPolicy=await authorizeLinkedLeaderTrackerMethod({query},req.actor,name,args);
 if(name==='people' && leaderPolicy?.allowedCellIds)req.leaderCellIds=leaderPolicy.allowedCellIds;
 if(['demoLoad','demoRemove'].includes(name)&&production)throw httpError(403,'Demo-data tools are disabled in production.');
 if(name==='demoLoad'&&(await query('SELECT id FROM people WHERE NOT is_demo LIMIT 1')).rows.length)throw httpError(409,'Do not mix demo data with real records.');
 const groupResult=await handleLifegroupMethod(name,args,req.actor);
 const custom=groupResult===undefined?await customMethod(req,name,args):groupResult;
 let result=custom===undefined?await runDomain(name,args,req.actor,write):custom;
 if(!req.actor.permissions.includes('people:view_private'))result=redactForViewer(result);
 res.json(result??{});
});
app.get('/api/reports/export/:type.csv',requireStaff,async(req,res)=>{requirePermission(req.actor,'reports:view');await assertGlobalExportAccess({query},req.actor);const type=String(req.params.type||'');const body=await exportAttendanceCsv(type,req.query);res.set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition',`attachment; filename="lifegen-${type}-${today()}.csv"`).send(body);});
app.get('/api/backup',requireStaff,async(req,res)=>{requirePermission(req.actor,'settings:manage');await assertGlobalExportAccess({query},req.actor);res.attachment(`lifegen-admin-${today()}.json`).json(await exportBackup());});
// ---- VIP Design Library (administrator only) --------------------------------
// Uploads are raw image bodies, matching how /api/deploy/archive already accepts
// a ZIP: no multipart parser, and express.json() is bypassed for this path.
const vipDesigns=express.Router();
vipDesigns.use(requireStaff,async(req,res,next)=>{try{requirePermission(req.actor,'settings:manage');await assertGlobalExportAccess({query},req.actor);next();}catch(e){next(e);}});
const designWrite=(req,res,next)=>{try{checkOrigin(req);checkCsrf(req);next();}catch(e){next(e);}};
vipDesigns.get('/',async(req,res)=>res.json({
 storage:storageKind(),storage_bucket:storageKind()==='supabase'?(process.env.SUPABASE_STORAGE_BUCKET||'vip-designs'):null,
 max_bytes:MAX_BYTES,allowed_types:Object.keys(ALLOWED_TYPES),today:today(),today_sunday:attributeServiceDate(new Date()),timezone:'Asia/Manila',
 sundays:selectableSundays(today()),counts:await countDesigns(),designs:await listDesigns(),
}));
// Selection for one Sunday (creates the automatic pick the first time it is read).
vipDesigns.get('/selection/:date',async(req,res)=>{
 const date=String(req.params.date||'');if(!isSunday(date))throw httpError(400,'Choose a Sunday service date.');
 const pick=await transaction(async client=>await designForSunday(date,client),{write:true});
 res.json({...pick,preview_pick:await previewRandomPick(date)});
});
// express.raw() enforces the byte cap before the handler runs; translate its
// error into the same clear message the validator produces.
const designImageBody=(req,res,next)=>express.raw({type:Object.keys(ALLOWED_TYPES),limit:MAX_BYTES})(req,res,(err)=>{
 if(err&&(err.type==='entity.too.large'||err.status===413))return next(httpError(413,`That design is too large. The limit is ${(MAX_BYTES/1024/1024).toFixed(0)} MB per file.`));
 next(err);
});
vipDesigns.post('/',designImageBody,designWrite,async(req,res)=>{
 const body=req.body;if(!Buffer.isBuffer(body)||!body.length)throw httpError(400,'Send the image bytes in the request body.');
 // The title arrives URI-encoded because HTTP header values are latin-1.
 let title='';try{title=decodeURIComponent(String(req.get('x-design-title')||''));}catch{title=String(req.get('x-design-title')||'');}
 const mode=String(req.get('x-design-mode')||'background');
 res.status(201).json(await transaction(async client=>await createDesign({buffer:body,title:title.trim().slice(0,160),displayMode:mode,actorId:req.actor?.id},client),{write:true}));
});
vipDesigns.patch('/:id',designWrite,async(req,res)=>res.json(await transaction(async client=>await updateDesign(req.params.id,req.body||{},client),{write:true})));
vipDesigns.delete('/:id',designWrite,async(req,res)=>res.json(await transaction(async client=>await deleteDesign(req.params.id,req.actor?.id,client),{write:true})));
// Admin preview of the exact bytes, and a dry-run random pick.
vipDesigns.get('/:id/file',async(req,res)=>{const f=await readDesignBytes(req.params.id);res.type(f.mime_type).set('Cache-Control','private, max-age=300').send(f.bytes);});
vipDesigns.get('/preview/:date',async(req,res)=>{
 const date=String(req.params.date||'');if(!isSunday(date))throw httpError(400,'Choose a Sunday service date.');
 res.json({design:await previewRandomPick(date)});
});
// Manual override / reset to automatic for one Sunday.
vipDesigns.post('/selection/:date',designWrite,async(req,res)=>{
 const date=String(req.params.date||'');if(!isSunday(date))throw httpError(400,'Choose a Sunday service date.');
 const mode=req.body?.mode==='manual'?'manual':'automatic';
 res.json(await transaction(async client=>await setSelection({serviceDate:date,designId:req.body?.design_id,mode,actorId:req.actor?.id},client),{write:true}));
});
app.use('/api/vip-designs',vipDesigns);
async function page(res,which) {let html=await fs.readFile(path.join(root,'public',which,'index.html'),'utf8');if(which==='admin'){const base=`/admin/_assets-${ADMIN_ASSET_VERSION}`;html=html.replaceAll('/admin/styles.css',base+'/styles.css').replaceAll('/admin/js/app.js',base+'/js/app.js');}res.set('Cache-Control','no-store').type('html').send(html.replaceAll('<script',`<script nonce="${res.locals.nonce}"`));}
app.get('/',(req,res)=>{
 if(req.query.view==='website')return page(res,'lifegen');
 if(process.env.PREVIEW_TRACKER_HOME==='true'||req.query.view==='tracker')return res.redirect('/admin#/lifegroups?tab=needs');
 if(req.query.view==='admin')return res.redirect('/admin');
 return page(res,'lifegen');
});
app.get(['/admin','/admin/'],(req,res)=>page(res,'admin'));
// Fullscreen VIP announcement projector. Deliberately public and read-only: it
// exposes only the VIP full name and inviter that are already projected in the
// room, and pulls them live from /api/public/vip-announcement. No contact
// number, age, school or recovery code is ever included in that payload.
app.get(['/vip-announce','/vip-announce/','/vip-announce/index.html'],(req,res)=>page(res,'vip-announce'));
app.get(['/tracker','/tracker/index.html'],(req,res)=>res.redirect(308,'/admin'));
app.get(['/lifegen','/lifegen/index.html'],(req,res)=>res.redirect(308,'/'));
app.get(['/checkin','/checkin/'],(req,res)=>res.sendFile(path.join(root,'public','checkin','index.html')));
app.get('/privacy',async(req,res)=>{
 let settings={};try{settings=Object.fromEntries((await query('SELECT key,value FROM settings')).rows.map(r=>[r.key,r.value]));}catch{}
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LIFEGEN · Privacy notice</title><style>body{font:16px/1.8 system-ui,sans-serif;color:#123c24;background:#f4f8f1;margin:0}main{max-width:760px;margin:48px auto;padding:32px;background:white;border-radius:18px}h1,h2{line-height:1.3}a{color:#17633a}small{color:#596a5f}</style><main><a href="/">← Back to LIFEGEN</a><h1>Privacy notice</h1><p>${esc(settings.church_name||'Lifegiver Church of Faith')} uses this system for visitor welcome, VIP registration and Sunday attendance.</p><h2>What we store</h2><p>Your name, age, school/institution, inviter and optional contact number, plus registration, attendance and consent records. Staff may add optional profile details you provide.</p><h2>Where and who</h2><p>Records are stored in a Supabase PostgreSQL database. Authorized staff access them through signed-in accounts. Viewer accounts receive names and attendance counts, not private contact/profile fields. Database credentials are kept only on the server.</p><h2>Prayer wall</h2><p>Posts are public. Do not include information you want kept confidential. New anonymous posts omit your name entirely. Legacy imported posts may retain their original source information privately for the church administrator.</p><h2>Cookies and security</h2><p>Necessary secure cookies keep you signed into your VIP portal or staff account and remember prayer reactions. Temporary hashed request information limits spam and sign-in abuse. There are no advertising trackers.</p><h2>Your choices</h2><p>Ask the LIFEGEN team to see, correct, withdraw consent for or delete your details. Records are retained for church follow-up and should be reviewed under the church’s retention policy. Downloaded backups must be stored securely.</p><p><b>Privacy contact:</b> ${esc(settings.privacy_contact||settings.church_contact||'Ask a LIFEGEN leader; the administrator should set a privacy contact in Settings.')}</p><h2>Videos and third-party players</h2><p>Testimony and highlight videos play through the official YouTube, Facebook, Vimeo or Google Drive players and load only after you tap play; no connection is made to the provider before that. When a video plays, the provider receives the technical data needed for playback (such as your IP address) and may apply its own cookies under its own privacy policy. YouTube videos use the privacy-enhanced no-cookie player, and Vimeo uses do-not-track mode, where available. Provider policies: <a href="https://policies.google.com/privacy">Google / YouTube</a>, <a href="https://www.facebook.com/privacy/policy/">Facebook</a>, <a href="https://vimeo.com/privacy">Vimeo</a>.</p><h2>Photos, testimonies and consent</h2><p>Photos, posters and testimonies on this site are published by the church with the permission of the people shown. If you appear in a photo or video and would like it corrected or removed, contact the privacy contact below and it will be taken down promptly.</p><h2>Reporting content concerns</h2><p>If you believe anything on this site infringes your copyright or any other right, send the web address of the page and a short description to the privacy contact. Every report is reviewed and infringing content is removed promptly.</p><small>This notice describes the software. The church must establish its lawful basis, retention policy and appropriate handling for younger attendees under the Philippine Data Privacy Act.</small></main></html>`);
});
// Versioned public assets (?v=x.y.z) are content-addressed by the HTML, so they can be
// cached immutably for a year. The HTML references per-file versions (styles.css?v=…,
// app.js?v=…), so accept any semver-like version, not just ADMIN_ASSET_VERSION.
app.use((req,res,next)=>{const u=new URL(req.originalUrl,'http://lifegen.invalid');res.locals.immutableStatic=['GET','HEAD'].includes(req.method)&&/^\/(?:lifegen|vip-announce|brand|vendor)\//.test(u.pathname)&&/^\d+\.\d+\.\d+$/.test(u.searchParams.get('v')||'')&&/\.(?:css|js|jpe?g|png|webp|svg|woff2?)$/i.test(u.pathname);next();});
app.use((req,res,next)=>{const marker=`/admin/_assets-${ADMIN_ASSET_VERSION}/`;if(req.url.startsWith(marker)){req.url='/admin/'+req.url.slice(marker.length);res.set('Cache-Control','no-store');}else if(req.path.startsWith('/admin/')&&/\.(?:js|css)$/.test(req.path)){res.set('Cache-Control','no-store');}next();});
app.use(express.static(path.join(root,'public'),{index:false,maxAge:'5m',setHeaders(res,filePath){if(res.locals.immutableStatic)res.setHeader('Cache-Control','public, max-age=31536000, immutable');}}));
app.use('/api',(req,res)=>res.status(404).json({message:'API route not found.'}));
app.use((error,req,res,next)=>{
 if(res.headersSent){res.end();return;}
 const code=error.code;let status=error.status||500,message=error.message;
 if(code==='23505'){status=409;message='That record already exists. Check for a duplicate.';}
 else if(['23502','23503','23514','22P02','22007','22008'].includes(code)){status=400;message='The data contains an invalid value or reference. Nothing was saved.';}
 else if(status>=500){message=status===503?message:'The database request could not be completed. Please try again or contact an administrator.';}
 if(status>=500)console.error('[LIFEGEN API]',code||error.name,process.env.NODE_ENV==='test'?error.stack:'Request failed (details withheld).');
 res.status(status).json({message,details:status<500?error.details:undefined});
});
export default app;
