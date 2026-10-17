// Positive-path integration test. Writes only to isolated local PostgreSQL.
// Run with LIFEGEN_INTEGRATION_DATABASE_URL and test admin credentials.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
const localHosts=new Set(['localhost','127.0.0.1','::1']);
const db=process.env.LIFEGEN_INTEGRATION_DATABASE_URL;
const direct=process.env.LIFEGEN_INTEGRATION_DIRECT_URL||db;
for(const [label,value] of [['LIFEGEN_INTEGRATION_DATABASE_URL',db],['LIFEGEN_INTEGRATION_DIRECT_URL',direct]]){
 let url;
 try{url=new URL(value);}catch{console.error(label+' must be a local PostgreSQL URL.');process.exit(2);}
 if(!localHosts.has(url.hostname)){console.error(label+' must be local.');process.exit(2);}
}
if(!process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD){console.error('Provide local integration admin password.');process.exit(2);}
process.env.DATABASE_URL=db;process.env.DATABASE_DIRECT_URL=direct;
process.env.LOCAL_DEMO='true';process.env.NODE_ENV='test';
const {default:app}=await import('../src/app.js');
const {closePool}=await import('../src/db.js');
const server=app.listen(0,'127.0.0.1');
await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
const origin='http://127.0.0.1:'+server.address().port;
const tag=crypto.randomBytes(8).toString('hex');
const fixtures={people:[],registrations:[],network:null,cell:null,meeting:null};
let client;
async function request(path,body,auth=null){
 const response=await fetch(origin+path,{method:'POST',
  headers:{'Content-Type':'application/json',Origin:origin,...(auth?{'X-Lifegen-Preview-Session':auth.token,'X-CSRF-Token':auth.csrf}:{})},
  body:JSON.stringify(body)});
 const data=await response.json();
 assert.equal(response.ok,true,path+': '+(data.message||response.status));
 return data;
}
async function signup(role){
 const response=await request('/api/public/registrations',{
  full_name:'Test '+role+' '+tag,age:25,gender:'male',
  school:'Integration fixture',inviter:'Integration fixture',privacy_consent:true,
  idempotency_key:crypto.randomBytes(24).toString('hex'),
 });
 const personId=Number(response.vip.person_id),registrationId=Number(response.vip.id);
 fixtures.people.push(personId);fixtures.registrations.push(registrationId);
 assert.ok(personId>0&&registrationId>0);
 return personId;
}
try{
 const login=await request('/api/auth/login',{username:process.env.LIFEGEN_INTEGRATION_ADMIN_USERNAME||'demo@lifegen.local',password:process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD});
 assert.ok(login.user?.permissions?.includes('lifegroups:manage'));
 const auth={token:login.preview_session_token,csrf:login.csrf_token};
 const leaderId=await signup('Leader');
 const network=await request('/api/tracker/createNetwork',{args:[{name:'Test Network '+tag,gender:'boys',leader_person_id:leaderId,is_active:true,is_demo:false}]},auth);
 fixtures.network=Number(network.id);assert.ok(fixtures.network>0);
 const cell=await request('/api/tracker/createLifegroup',{args:[{
  name:'Test Cell '+tag,gender:'boys',network_id:fixtures.network,
  leader_person_id:leaderId,is_active:true,is_demo:false,capacity:12
 }]},auth);
 fixtures.cell=Number(cell.id);assert.ok(fixtures.cell>0);
 const vipId=await signup('VIP');
 const placement=await request('/api/tracker/autoAssignLifegroup',{args:[vipId,{}]},auth);
 assert.equal(placement.assigned,true,'VIP automatically assigned');
 assert.equal(Number(placement.lifegroup_id),fixtures.cell,'VIP assigned to eligible Cell');
 const repeat=await request('/api/tracker/autoAssignLifegroup',{args:[vipId,{}]},auth);
 assert.equal(repeat.already_assigned,true,'auto assignment idempotent');
 const verifier=new pg.Client({connectionString:db,ssl:false});
 try{
  await verifier.connect();
  const activeMemberships=await verifier.query(
   'SELECT count(*)::int AS total FROM lifegroup_memberships WHERE person_id=$1 AND left_at IS NULL',
   [vipId]
  );
  assert.equal(activeMemberships.rows[0].total,1,'repeated auto-placement retains exactly one active membership');
 }finally{await verifier.end().catch(()=>{});}
 const roster=await request('/api/tracker/lifegroup',{args:[fixtures.cell]},auth);
 assert.ok(roster.members.some(p=>Number(p.id)===vipId&&p.is_vip),'assigned VIP appears in roster');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
 const meetingDay=new Date(today+'T12:00:00+08:00');
 if(meetingDay.getUTCDay()!==0)meetingDay.setUTCDate(meetingDay.getUTCDate()-meetingDay.getUTCDay());
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(meetingDay);
 const attendance=await request('/api/tracker/saveMeeting',{args:[fixtures.cell,{
  meeting_date:date,held:true,present_ids:[vipId],devotion_ids:[]
 }]},auth);
 fixtures.meeting=Number(attendance.meeting_id);
 assert.ok(attendance.progress.members.some(p=>Number(p.id)===vipId),'VIP included in meeting progress');
 const attendanceVerifier=new pg.Client({connectionString:db,ssl:false});
 try{
  await attendanceVerifier.connect();
  const saved=await attendanceVerifier.query(
   'SELECT a.present,a.absent,a.devotion,m.lifegroup_id FROM lifegroup_meeting_attendance a JOIN lifegroup_meetings m ON m.id=a.meeting_id WHERE a.meeting_id=$1 AND a.person_id=$2',
   [fixtures.meeting,vipId]
  );
  assert.equal(saved.rowCount,1,'one persisted attendance record for VIP');
  assert.equal(saved.rows[0].present,true,'VIP attendance persisted as present');
  assert.equal(saved.rows[0].absent,false,'VIP attendance not marked absent');
  assert.equal(Number(saved.rows[0].lifegroup_id),fixtures.cell,'attendance belongs to assigned Cell');
 }finally{await attendanceVerifier.end().catch(()=>{});}

 console.log('PASS: signup -> eligible non-demo Cell auto-assignment -> idempotency -> attendance');
}finally{
 try{
  client=new pg.Client({connectionString:db,ssl:false});await client.connect();
  await client.query('BEGIN');
  if(fixtures.cell){
   await client.query('DELETE FROM lifegroup_meetings WHERE lifegroup_id=$1',[fixtures.cell]);
   await client.query('DELETE FROM lifegroup_memberships WHERE lifegroup_id=$1',[fixtures.cell]);
   await client.query('DELETE FROM lifegroups WHERE id=$1',[fixtures.cell]);
  }
  if(fixtures.network)await client.query('DELETE FROM networks WHERE id=$1',[fixtures.network]);
  for(const id of fixtures.registrations){
   await client.query('DELETE FROM vip_sessions WHERE registration_id=$1',[id]);
   await client.query('DELETE FROM vip_checkins WHERE registration_id=$1',[id]);
   await client.query('DELETE FROM vip_registrations WHERE id=$1',[id]);
  }
  for(const id of fixtures.people){
   await client.query('DELETE FROM audit WHERE person_id=$1',[id]);
  }
  // Test-generated audit logs should not reference removed fixtures.
  await client.query("DELETE FROM audit_log WHERE (entity='people' AND entity_id=ANY($1::text[])) OR (entity='vip_registrations' AND entity_id=ANY($2::text[])) OR (entity='networks' AND entity_id=$3) OR (entity='lifegroups' AND entity_id=$4) OR (entity='lifegroup_meetings' AND entity_id=$5)",
   [fixtures.people.map(String),fixtures.registrations.map(String),String(fixtures.network),String(fixtures.cell),String(fixtures.meeting)]);
  for(const id of fixtures.people)await client.query('DELETE FROM people WHERE id=$1',[id]);
  await client.query('COMMIT');
 }catch(error){await client?.query('ROLLBACK').catch(()=>{});console.error('Local integration cleanup failed:',error.message);process.exitCode=1;}
 finally{await client?.end().catch(()=>{});await new Promise(resolve=>server.close(resolve));await closePool();}
}
