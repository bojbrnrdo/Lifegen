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
const ids=[920001,920002,920003,920004,920005];
try {
 const hash=await passwordHash('PR134-local-test-pass-2026');
 await db.query("INSERT INTO people(id,person_code,first_name,last_name,status,date_registered,sex) VALUES (920001,'PR134-NA','Network','A','leader',CURRENT_DATE,'male'),(920002,'PR134-CA','Cell','A','leader',CURRENT_DATE,'male'),(920003,'PR134-MA','Member','A','member',CURRENT_DATE,'male'),(920004,'PR134-MB','Member','B','member',CURRENT_DATE,'male'),(920005,'PR134-UA','Unassigned','A','member',CURRENT_DATE,'male')");
 await db.query('UPDATE people SET email=$1, contact_number=$2 WHERE id=$3',['member-pr134@local.test','09170000000',920003]);
 await db.query('INSERT INTO staff_users(id,username,display_name,password_hash,role_id,person_id) VALUES (920001,$1,$2,$3,$4,$5),(920002,$6,$7,$3,$4,$8),(920005,$9,$10,$3,$4,$11),(920006,$12,$13,$3,\'staff\',NULL),(920007,$14,$15,$3,\'admin\',NULL)',['network-pr134@local.test','Network A',hash,'staff',920001,'cell-pr134@local.test','Cell A',920002,'unassigned-pr134@local.test','Unassigned A',920005,'legacy-pr134@local.test','Legacy Staff','admin-pr134@local.test','Local Admin']);
 await db.query("INSERT INTO networks(id,name,gender,leader_person_id) VALUES (920001,'Network A','boys',920001),(920002,'Network B','boys',NULL)");
 await db.query("INSERT INTO lifegroups(id,name,gender,network_id,leader_person_id) VALUES (920001,'Cell A','boys',920001,920002),(920002,'Cell B','boys',920002,NULL)");
 await db.query('INSERT INTO lifegroup_memberships(id,person_id,lifegroup_id) VALUES (920001,920003,920001),(920003,920004,920002)');
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function login(username){const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username,password:'PR134-local-test-pass-2026'})});assert.equal(response.status,200);return response.json();}
 async function call(a,method,args=[]){const response=await fetch(base+'/api/tracker/'+method,{method:'POST',headers:{'content-type':'application/json',origin:base,'x-lifegen-preview-session':a.preview_session_token,'x-csrf-token':a.csrf_token},body:JSON.stringify({args})});return {status:response.status,data:await response.json()};}
 const n=await login('network-pr134@local.test'),c=await login('cell-pr134@local.test'),u=await login('unassigned-pr134@local.test'),legacy=await login('legacy-pr134@local.test'),admin=await login('admin-pr134@local.test');
 if(process.env.LIFEGEN_SAFARI_TEST==='1'){
  const driver='http://127.0.0.1:55435';
  async function wd(path,method='GET',body){const r=await fetch(driver+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json();if(j.value?.error)throw Error(j.value.message);return j.value;}
  const session=await wd('/session','POST',{capabilities:{alwaysMatch:{browserName:'safari'}}});
  const sid='/session/'+session.sessionId;
  const run=async(script,args=[])=>wd(sid+'/execute/sync','POST',{script,args});
  try{
   await wd(sid+'/url','POST',{url:base+'/admin/'});
   for(let i=0;i<30;i++){if(await run('return !!document.querySelector("#u")'))break;await new Promise(r=>setTimeout(r,200));}
   await run("document.querySelector('#u').value='cell-pr134@local.test';document.querySelector('#p').value='PR134-local-test-pass-2026';document.querySelector('#loginForm button[type=submit]').click()");
   let status='';
   for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,250));status=await run('return location.hash+"|"+document.body.innerText.slice(0,450)');if(status.includes('My Lifegroups'))break;}
   assert.match(status,/My Lifegroups/,'Safari sign-in reaches the scoped directory');
   assert.ok(status.includes('Member A'),'Safari shows assigned People');
   assert.ok(!status.includes('Member B'),'Safari hides other Network People');
   await run("document.querySelector('a[href=\"#/people/920003\"]').click()");
   for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,250));status=await run('return location.hash+"|"+document.body.innerText.slice(0,900)');if(status.includes('Restricted'))break;}
   assert.match(status,/Restricted/,'Safari profile hides private fields');
   await wd(sid+'/window/rect','POST',{width:390,height:844});
   const mobile=await run('return {width:window.innerWidth,scroll:document.documentElement.scrollWidth,menu:!!document.querySelector("#menuToggle")}');
   assert.ok(mobile.width<=500,'Safari uses a narrow mobile-sized window');
   assert.ok(mobile.scroll<=mobile.width+1,'Safari mobile layout has no page-level horizontal overflow');
   assert.ok(mobile.menu,'Safari mobile menu is available');
   await run('document.querySelector("#menuToggle").click()');
   assert.equal(await run('return document.querySelector("#sidebar").classList.contains("open")'),true,'Safari sidebar opens');
   await run('document.querySelector("#backdrop").click()');
   assert.equal(await run('return document.querySelector("#sidebar").classList.contains("open")'),false,'Safari sidebar closes');
   console.log('PASS: Safari 26.5 linked leader sign-in, scoped directory and protected profile');
  }finally{await wd(sid,'DELETE');}
 }
 if(process.env.LIFEGEN_BROWSER_TEST==='1'){
 const {chromium}=await import('playwright-core');
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  for(const size of [{width:1440,height:900},{width:390,height:844}]){
   const page=await browser.newPage({viewport:size});
   await page.goto(base+'/admin/');
   await page.locator('#u').fill('cell-pr134@local.test');
   await page.locator('#p').fill('PR134-local-test-pass-2026');
   await page.locator('#loginForm button[type=submit]').click();
   await page.waitForTimeout(700);
   await page.waitForURL(/#\/lifegroups/,{timeout:5000});
   await page.getByRole('heading',{name:'My Lifegroups'}).waitFor();
   assert.ok(await page.getByText('Member A').count()>0,'assigned Person appears in scoped directory');
   assert.equal(await page.getByText('Member B').count(),0,'other Network Person is hidden');
   const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,inner:window.innerWidth}));
   assert.ok(widths.scroll<=widths.inner+1,'no page-level horizontal overflow at '+size.width);
   await page.locator('a[href="#/people/920003"]').first().click();
   await page.waitForURL(/#\/people\/920003/);
   await page.getByRole('heading',{name:'Member A'}).waitFor();
   assert.ok(await page.getByText('Restricted',{exact:true}).count()>0,'private details are marked restricted');
   await page.locator('a[href="#/lifegroups"]').filter({hasText:'My Lifegroups'}).first().click();
   await page.waitForURL(/#\/lifegroups/);
   await page.getByRole('heading',{name:'My Lifegroups'}).waitFor();
   if(size.width===390){
    await page.locator('#menuToggle').click();
    assert.ok(await page.locator('#sidebar').evaluate(el=>el.classList.contains('open')||el.classList.contains('is-open')||el.getAttribute('aria-hidden')==='false'),'mobile menu opens');
    assert.ok(await page.locator('#backdrop').evaluate(el=>el.classList.contains('show')),'mobile backdrop appears');
    await page.locator('#backdrop').click({position:{x:380,y:300}});
    assert.equal(await page.locator('#sidebar').evaluate(el=>el.classList.contains('open')),false,'mobile menu closes when backdrop clicked');
   }
   console.log('PASS: Chrome linked leader directory at '+size.width+'px');
   await page.close();
  }
 }finally{await browser.close();}
 }
 assert.equal((await call(legacy,'leaderScope')).data.linked,false);
 assert.equal((await call(admin,'leaderScope')).data.kind,'admin');
 assert.equal((await call(legacy,'person',[920004])).status,200,'unlinked Staff retains cross-network access');
 assert.equal((await call(admin,'person',[920004])).status,200,'admin retains cross-network access');
 assert.equal((await call(legacy,'search',['Member'])).status,200,'unlinked Staff retains global search');
 assert.equal((await call(admin,'search',['Member'])).status,200,'admin retains global search');
 assert.equal((await call(u,'leaderScope')).data.kind,'unassigned');
 assert.equal((await call(u,'people',[{paged:1,limit:100}])).status,403);
 assert.equal((await call(u,'lifegroup',[920001])).status,403);
 assert.equal((await call(u,'person',[920003])).status,403);
 for(const id of [null,undefined,0,-1,'abc','1 OR 1=1',{},[],9007199254740992]){
  assert.equal((await call(c,'lifegroup',[id])).status,403,'invalid Cell ID denied: '+String(id));
  assert.equal((await call(c,'person',[id])).status,403,'invalid Person ID denied: '+String(id));
 }
 assert.equal((await call(n,'leaderScope')).data.kind,'network_leader');
 assert.equal((await call(c,'leaderScope')).data.kind,'cell_leader');
 const scoped=await call(n,'people',[{status:'all',paged:1,limit:100,offset:0}]);
 assert.equal(scoped.status,200);
 assert.ok(scoped.data.rows.some(p=>Number(p.id)===920003));
 assert.ok(!scoped.data.rows.some(p=>Number(p.id)===920004));
 await db.query("INSERT INTO people(id,person_code,first_name,last_name,status,date_registered,sex) SELECT 930000+g,'PR134-PAGE-'||g,'Paged','Member'||lpad(g::text,3,'0'),'member',CURRENT_DATE,'male' FROM generate_series(1,101) g");
 await db.query("INSERT INTO lifegroup_memberships(id,person_id,lifegroup_id) SELECT 930000+g,930000+g,920001 FROM generate_series(1,101) g");
 const firstPage=await call(c,'people',[{status:'all',paged:1,limit:100,offset:0}]);
 const secondPage=await call(c,'people',[{status:'all',paged:1,limit:100,offset:100}]);
 const beyondPage=await call(c,'people',[{status:'all',paged:1,limit:100,offset:300}]);
 for(const page of [firstPage,secondPage,beyondPage])assert.equal(page.status,200);
 assert.equal(firstPage.data.total,102);
 assert.equal(firstPage.data.rows.length,100);
 assert.equal(firstPage.data.has_more,true);
 assert.equal(secondPage.data.rows.length,2);
 assert.equal(secondPage.data.has_more,false);
 assert.equal(beyondPage.data.total,102);
 assert.equal(beyondPage.data.rows.length,0);
 const allIds=[...firstPage.data.rows,...secondPage.data.rows].map(p=>Number(p.id));
 assert.equal(new Set(allIds).size,102,'each assigned Person appears exactly once');
 assert.ok(!allIds.includes(920004),'other Network Person is excluded from both pages');
 await db.query('DELETE FROM lifegroup_memberships WHERE id BETWEEN 930001 AND 930101');
 await db.query('DELETE FROM people WHERE id BETWEEN 930001 AND 930101');
 assert.equal((await call(n,'person',[920004])).status,403);
 assert.equal((await call(c,'person',[920004])).status,403);
 assert.equal((await call(n,'search',['Member'])).status,403);
 assert.equal((await call(n,'lifegroup',[920001])).status,200);
 assert.equal((await call(c,'lifegroup',[920001])).status,200);
 assert.equal((await call(n,'lifegroup',[920002])).status,403);
 assert.equal((await call(c,'network',[920001])).status,403);
 const scopedPerson=await call(n,'person',[920003]);
 assert.equal(scopedPerson.status,200);
 assert.equal(scopedPerson.data.contact_number,undefined);
 assert.equal(scopedPerson.data.email,undefined);
 assert.equal(scopedPerson.data.private_hidden,true);
 assert.equal((await call(c,'reportSummary')).status,403);
 assert.equal((await call(c,'setTier',[920002,920003,'solid'])).status,403);
 assert.equal((await call(c,'leaveLifegroup',[920002,920003])).status,403);
 assert.equal((await call(c,'setTier',[920001,920003,'solid'])).status,200);
 assert.equal((await db.query('SELECT tier FROM lifegroup_memberships WHERE id=920001')).rows[0].tier,'solid');
 assert.equal((await call(c,'leaveLifegroup',[920001,920003])).status,200);
 assert.ok((await db.query('SELECT left_at FROM lifegroup_memberships WHERE id=920001')).rows[0].left_at);
 assert.equal((await call(c,'assignLifegroup',[920002,920003])).status,403);
 assert.equal((await call(c,'assignLifegroup',[920001,920003])).status,200);
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM lifegroup_memberships WHERE person_id=920003 AND left_at IS NULL')).rows[0].n),1);
 await db.query("INSERT INTO lifegroup_memberships(id,person_id,lifegroup_id,role) VALUES (920002,920002,920001,'leader')");
 assert.equal((await call(n,'setTier',[920001,920002,'solid'])).status,403);
 assert.equal((await call(n,'leaveLifegroup',[920001,920002])).status,403); 
 await db.query("UPDATE people SET status='inactive' WHERE id=920002");
 assert.equal((await call(c,'leaderScope')).data.kind,'unassigned');
 assert.equal((await call(c,'lifegroup',[920001])).status,403);
 await db.query("UPDATE people SET status='leader',archived_at=now() WHERE id=920002");
 assert.equal((await call(c,'lifegroup',[920001])).status,403);
 await db.query("UPDATE staff_users SET is_active=false WHERE id=920002");
 assert.equal((await call(c,'leaderScope')).status,401);
 console.log('PASS: authenticated HTTP linked leader access checks');
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 await db.query('DELETE FROM staff_sessions WHERE user_id IN (920001,920002,920005,920006,920007)').catch(()=>{});
 await db.query('DELETE FROM lifegroup_memberships WHERE id BETWEEN 930001 AND 930101').catch(()=>{});
 await db.query('DELETE FROM people WHERE id BETWEEN 930001 AND 930101').catch(()=>{});
 await db.query('DELETE FROM lifegroup_memberships WHERE id IN (920001,920002,920003) OR person_id IN (920003,920004)').catch(()=>{});
 await db.query('DELETE FROM lifegroups WHERE id IN (920001,920002,920005,920006,920007)').catch(()=>{});
 await db.query('DELETE FROM networks WHERE id IN (920001,920002,920005,920006,920007)').catch(()=>{});
 await db.query('DELETE FROM staff_users WHERE id IN (920001,920002,920005,920006,920007)').catch(()=>{});
 await db.query('DELETE FROM people WHERE id=ANY($1::bigint[])',[ids]).catch(()=>{});
 await db.end();await closePool();
}
