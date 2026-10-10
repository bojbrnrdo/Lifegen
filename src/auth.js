import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { query, transaction, logAction } from './db.js';
import { httpError } from './domain.js';
const scrypt=promisify(crypto.scrypt);
export const hashToken=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
export const randomToken=()=>crypto.randomBytes(32).toString('base64url');
export const PERMISSIONS={
 admin:['dashboard:view','reports:view','reports:export','people:view','people:view_private','people:write','people:delete','attendance:view','attendance:write','lifegroups:view','lifegroups:manage','registrations:manage','calendar:manage','users:manage','settings:manage'],
 staff:['dashboard:view','reports:view','reports:export','people:view','people:view_private','people:write','attendance:view','attendance:write','lifegroups:view','lifegroups:manage','registrations:manage','calendar:manage'],
 viewer:['dashboard:view','reports:view','people:view','attendance:view','lifegroups:view']
};
export const publicUser=u=>({id:u.id,username:u.username,display_name:u.display_name,role_id:u.role_id,permissions:PERMISSIONS[u.role_id]||[],is_active:u.is_active});
export function safeEqual(a,b) {const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
export async function passwordHash(password) {
 if(typeof password!=='string'||password.length<12||password.length>256) throw httpError(400,'Use a password of 12–256 characters.');
 const salt=crypto.randomBytes(16).toString('hex');const hash=await scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return `scrypt$32768$${salt}$${hash.toString('hex')}`;
}
export async function passwordMatches(password,encoded) {
 if(typeof password!=='string'||password.length>256||!encoded) return false;
 const [alg,n,salt,expected]=encoded.split('$');if(alg!=='scrypt'||n!=='32768'||!salt||!expected) return false;
 const value=await scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return safeEqual(value.toString('hex'),expected);
}
export const previewSessionTokensEnabled=()=>process.env.HOSTED_PREVIEW==='true'&&process.env.NODE_ENV!=='production'&&!process.env.VERCEL;
export const cookieOptions=req=>{const preview=(process.env.LOCAL_DEMO==='true'||process.env.HOSTED_PREVIEW==='true')&&String(req.get('x-forwarded-host')||req.get('host')||'').endsWith('.e2b.app');return {httpOnly:true,secure:preview||process.env.NODE_ENV==='production'||Boolean(process.env.VERCEL)||req.secure,path:'/',sameSite:preview?'none':'lax',...(preview?{partitioned:true}:{})};};
export const setStaffCookie=(req,res,token)=>{if(!previewSessionTokensEnabled())res.cookie('lg_staff',token,{...cookieOptions(req),maxAge:12*60*60*1000});};
export const setVipCookie=(req,res,token)=>res.cookie('lg_vip',token,{...cookieOptions(req),maxAge:90*24*60*60*1000});
export const clearStaffCookie=(req,res)=>res.clearCookie('lg_staff',cookieOptions(req));
export function checkOrigin(req) {
 const origin=req.get('origin');if(!origin) throw httpError(403,'A same-origin request is required.');
 let host;try{host=new URL(origin).host;}catch{throw httpError(403,'Invalid request origin.');}
 const requestHost=req.app.get('trust proxy')?(req.get('x-forwarded-host')||req.get('host')).split(',')[0].trim():req.get('host');
 // The public website and Admin portal use relative same-origin /api URLs. No permissive CORS.
 if(host!==requestHost) throw httpError(403,'Cross-origin writes are not permitted.');
}
export async function rateLimit(req,action,limit=20,minutes=15) {
 const window=Math.floor(Date.now()/(minutes*60000));
 const bucket=hashToken(`${action}|${req.ip}|${window}`);
 const {rows}=await query('INSERT INTO rate_limits(bucket,hits,expires_at) VALUES($1,1,now()+($2::int*interval \'1 minute\')) ON CONFLICT(bucket) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits',[bucket,minutes*2]);
 if(rows[0].hits>limit) throw httpError(429,`Too many attempts. Please try again in ${minutes} minutes.`);
 if(Math.random()<.01) await query('DELETE FROM rate_limits WHERE expires_at<now()');
}
export async function readStaff(req) {
 const cookieToken=req.cookies?.lg_staff;
 const previewHeader=req.get('x-lifegen-preview-session')||'';
 // Sandboxed embedded previews can discard even partitioned cookies. Allow a short-lived
 // in-memory browser session header only on the explicit non-production setup preview.
 // Production continues to require its HttpOnly Secure cookie exclusively.
 const previewToken=previewSessionTokensEnabled()&&/^[A-Za-z0-9_-]{32,128}$/.test(previewHeader)?previewHeader:null;
 // In the sandboxed preview, prefer the freshly issued in-memory bearer over any old
 // partitioned cookie the browser may still send. Production never accepts this bearer.
 const token=previewToken||cookieToken;if(!token)return null;
 const {rows}=await query('SELECT u.*,s.csrf_token,s.token_hash,s.expires_at FROM staff_sessions s JOIN staff_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active=true',[hashToken(token)]);
 if(!rows[0])return null;
 return {...publicUser(rows[0]),csrf_token:rows[0].csrf_token,session_hash:rows[0].token_hash};
}
export async function requireStaff(req,res,next) {
 try {req.actor=await readStaff(req);if(!req.actor)throw httpError(401,'Please sign in to the tracker.');next();}catch(e){next(e);}
}
export function requirePermission(actor,permission) {if(!actor?.permissions?.includes(permission))throw httpError(actor?403:401,'Your account is not allowed to do that.');}
export function checkCsrf(req) {if(!safeEqual(req.get('x-csrf-token'),req.actor?.csrf_token))throw httpError(403,'Session verification failed. Reload the page and try again.');}
async function newSession(client,user) {
 const token=randomToken(),csrf=randomToken();
 await client.query('INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval \'12 hours\')',[hashToken(token),user.id,csrf]);
 return {token,user:publicUser(user),csrf_token:csrf};
}
export async function setupAdmin(body) {
 if(!process.env.SETUP_KEY||process.env.SETUP_KEY.length<32||!safeEqual(body.setup_key,process.env.SETUP_KEY)) throw httpError(403,'The private setup code is incorrect or is not configured on the server.');
 const username=String(body.username||'').trim().toLowerCase();const name=String(body.display_name||'').trim();
 if(!/^[a-z0-9._@+\-]{3,100}$/.test(username)||!name||name.length>200)throw httpError(400,'Enter a valid username/email and your name.');
 const hash=await passwordHash(body.password);
 return transaction(async client=>{
  if((await client.query('SELECT id FROM staff_users LIMIT 1')).rows.length)throw httpError(409,'An administrator already exists. Sign in instead.');
  const {rows}=await client.query('INSERT INTO staff_users(username,display_name,password_hash,role_id) VALUES($1,$2,$3,\'admin\') RETURNING *',[username,name,hash]);
  if(body.church_name)await client.query('UPDATE settings SET value=$1::jsonb WHERE key=\'church_name\'',[JSON.stringify(String(body.church_name).slice(0,300))]);
  await logAction(client,rows[0],'staff_users',rows[0].id,'initial_admin');
  return newSession(client,rows[0]);
 });
}
export async function login(body) {
 const username=String(body.username||body.email||'').trim().toLowerCase();
 const result=await transaction(async client=>{
  const u=(await client.query('SELECT * FROM staff_users WHERE lower(username)=$1 FOR UPDATE',[username])).rows[0];
  if(!u||!u.is_active)return {error:'Invalid username or password.'};
  if(u.locked_until&&new Date(u.locked_until)>new Date())return {error:'This account is temporarily locked. Try again in 15 minutes.'};
  if(!await passwordMatches(body.password,u.password_hash)) {
   await client.query('UPDATE staff_users SET failed_attempts=CASE WHEN failed_attempts>=5 THEN 0 ELSE failed_attempts+1 END,locked_until=CASE WHEN failed_attempts>=5 THEN now()+interval \'15 minutes\' ELSE locked_until END WHERE id=$1',[u.id]);
   return {error:'Invalid username or password.'};
  }
  await client.query('UPDATE staff_users SET last_login_at=now(),failed_attempts=0,locked_until=NULL WHERE id=$1',[u.id]);
  await logAction(client,u,'staff_users',u.id,'sign_in');return newSession(client,u);
 });
 if(result.error)throw httpError(401,result.error);return result;
}
export async function changePassword(actor,current,next) {
 const hash=await passwordHash(next);
 return transaction(async client=>{
  const u=(await client.query('SELECT * FROM staff_users WHERE id=$1 FOR UPDATE',[actor.id])).rows[0];
  if(!await passwordMatches(current,u.password_hash))throw httpError(400,'The current password is incorrect.');
  await client.query('UPDATE staff_users SET password_hash=$1 WHERE id=$2',[hash,u.id]);
  await client.query('DELETE FROM staff_sessions WHERE user_id=$1 AND token_hash<>$2',[u.id,actor.session_hash]);
  await logAction(client,actor,'staff_users',u.id,'password_changed');return {};
 });
}
export async function userAccounts(actor,method,args) {
 requirePermission(actor,'users:manage');
 if(method==='roles')return Object.entries(PERMISSIONS).map(([id,permissions])=>({id,name:id==='admin'?'Admin':id==='staff'?'Attendance Staff':'Viewer / Leader',permissions}));
 if(method==='users')return (await query('SELECT id,username,display_name,role_id,is_active,created_at,last_login_at FROM staff_users ORDER BY id')).rows.map(u=>({...u,role_name:u.role_id}));
 const [idOrBody,bodyMaybe]=args;const editing=method==='updateUser';const body=editing?bodyMaybe:idOrBody;
 if(!body||!PERMISSIONS[body.role_id])throw httpError(400,'Choose a valid staff role.');
 const username=String(body.username||'').trim().toLowerCase();const display=String(body.display_name||'').trim();
 if(!/^[a-z0-9._@+\-]{3,100}$/.test(username)||!display||display.length>200)throw httpError(400,'Enter a valid username and display name.');
 const hash=body.password?await passwordHash(body.password):null;if(!editing&&!hash)throw httpError(400,'A password is required.');
 return transaction(async client=>{
  let u;
  if(editing) {
   const current=(await client.query('SELECT * FROM staff_users WHERE id=$1 FOR UPDATE',[Number(idOrBody)])).rows[0];if(!current)throw httpError(404,'User not found.');
   const active=body.is_active===undefined?current.is_active:Boolean(body.is_active);
   if(current.role_id==='admin'&&current.is_active&&(!active||body.role_id!=='admin')&&(await client.query('SELECT id FROM staff_users WHERE role_id=\'admin\' AND is_active=true')).rows.length===1)throw httpError(409,'The last active administrator cannot be disabled or demoted.');
   u=(await client.query('UPDATE staff_users SET username=$1,display_name=$2,role_id=$3,is_active=$4,password_hash=COALESCE($5,password_hash) WHERE id=$6 RETURNING *',[username,display,body.role_id,active,hash,current.id])).rows[0];
   await client.query('DELETE FROM staff_sessions WHERE user_id=$1 AND token_hash<>$2',[u.id,actor.session_hash]);
  }else u=(await client.query('INSERT INTO staff_users(username,display_name,role_id,password_hash) VALUES($1,$2,$3,$4) RETURNING *',[username,display,body.role_id,hash])).rows[0];
  await logAction(client,actor,'staff_users',u.id,editing?'update':'create',{role:u.role_id});return publicUser(u);
 });
}
export function redactForViewer(value) {
 if(Array.isArray(value))return value.map(redactForViewer);
 if(!value||typeof value!=='object')return value;
 const personKeys=new Set(['id','person_id','person_code','first_name','last_name','full_name','status','date_registered','date_first_attended','sundays_attended','last_attended','archived_at','is_demo','att_status','classification','expected_classification','record_id','recorded_at','recorded_by','recorded_by_name','attended_before','role','joined_at','left_at','membership_id','services_since','attendance_rate','history','lifegroup','lifegroup_history','leadership']);
 const isPerson='first_name' in value && 'last_name' in value;
 const sensitive=new Set(['contact_number','contact','email','address','notes','birthdate','age','ministry','school','course_year','occupation','inviter','privacy_consent_at','preferred_area','preferred_day','preferred_time','preferred_category','leader_contact','photo','sex','extras','password_hash','legacy_token_hash','recovery_hash','csrf_token']);
 return Object.fromEntries(Object.entries(value).filter(([k])=>!sensitive.has(k)&&(!isPerson||personKeys.has(k))).map(([k,v])=>[k,redactForViewer(v)]));
}
