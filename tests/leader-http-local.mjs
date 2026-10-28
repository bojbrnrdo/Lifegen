import assert from 'node:assert/strict';
import pg from 'pg';
import {passwordHash} from '../src/auth.js';
const url=process.env.LIFEGEN_INTEGRATION_DATABASE_URL;
if(!url||!['localhost','127.0.0.1','::1'].includes(new URL(url).hostname))process.exit(2);
process.env.DATABASE_URL=url;process.env.DATABASE_DIRECT_URL=url;process.env.LOCAL_DEMO='true';process.env.NODE_ENV='test';
const {default:app}=await import('../src/app.js');
const {closePool}=await import('../src/db.js');
const db=new pg.Client({connectionString:url,ssl:false});await db.connect();
let server;
const ids=[920001,920002,920003];
try {
 const hash=await passwordHash('PR134-local-test-pass-2026');
 await db.query("INSERT INTO people(id,person_code,first_name,last_name,status,date_registered) VALUES (920001,'PR134-NA','Network','A','leader',CURRENT_DATE),(920002,'PR134-CA','Cell','A','leader',CURRENT_DATE),(920003,'PR134-MA','Member','A','member',CURRENT_DATE)");
 await db.query('INSERT INTO staff_users(id,username,display_name,password_hash,role_id,person_id) VALUES (920001,$1,$2,$3,$4,$5),(920002,$6,$7,$3,$4,$8)',['network-pr134@local.test','Network A',hash,'staff',920001,'cell-pr134@local.test','Cell A',920002]);
 await db.query("INSERT INTO networks(id,name,gender,leader_person_id) VALUES (920001,'Network A','boys',920001),(920002,'Network B','boys',NULL)");
 await db.query("INSERT INTO lifegroups(id,name,gender,network_id,leader_person_id) VALUES (920001,'Cell A','boys',920001,920002),(920002,'Cell B','boys',920002,NULL)");
 await db.query('INSERT INTO lifegroup_memberships(id,person_id,lifegroup_id) VALUES (920001,920003,920001)');
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function login(username){const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username,password:'PR134-local-test-pass-2026'})});assert.equal(response.status,200);return response.json();}
 async function call(a,method,args=[]){const response=await fetch(base+'/api/tracker/'+method,{method:'POST',headers:{'content-type':'application/json',origin:base,'x-lifegen-preview-session':a.preview_session_token,'x-csrf-token':a.csrf_token},body:JSON.stringify({args})});return {status:response.status,data:await response.json()};}
 const n=await login('network-pr134@local.test'),c=await login('cell-pr134@local.test');
 assert.equal((await call(n,'leaderScope')).data.kind,'network_leader');
 assert.equal((await call(c,'leaderScope')).data.kind,'cell_leader');
 assert.equal((await call(n,'lifegroup',[920001])).status,200);
 assert.equal((await call(c,'lifegroup',[920001])).status,200);
 assert.equal((await call(n,'lifegroup',[920002])).status,403);
 assert.equal((await call(c,'network',[920001])).status,403);
 assert.equal((await call(n,'person',[920003])).status,200);
 assert.equal((await call(c,'reportSummary')).status,403);
 console.log('PASS: authenticated HTTP linked leader access checks');
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 await db.query('DELETE FROM staff_sessions WHERE user_id IN (920001,920002)').catch(()=>{});
 await db.query('DELETE FROM lifegroup_memberships WHERE id=920001').catch(()=>{});
 await db.query('DELETE FROM lifegroups WHERE id IN (920001,920002)').catch(()=>{});
 await db.query('DELETE FROM networks WHERE id IN (920001,920002)').catch(()=>{});
 await db.query('DELETE FROM staff_users WHERE id IN (920001,920002)').catch(()=>{});
 await db.query('DELETE FROM people WHERE id=ANY($1::bigint[])',[ids]).catch(()=>{});
 await db.end();await closePool();
}
