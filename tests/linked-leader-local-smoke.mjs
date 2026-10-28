import assert from 'node:assert/strict';
import pg from 'pg';
import {resolveLeaderScope,assertLeaderScope} from '../src/leader-scope.js';
import {authorizeLinkedLeaderTrackerMethod} from '../src/leader-tracker-policy.js';
const url=process.env.LIFEGEN_INTEGRATION_DATABASE_URL;
if(!url||!['127.0.0.1','localhost','::1'].includes(new URL(url).hostname)){
 console.error('Only isolated loopback PostgreSQL is allowed.');process.exit(2);
}
const db=new pg.Client({connectionString:url,ssl:false});
await db.connect();
try{
 await db.query('BEGIN');
 // Transaction is rolled back even after successful verification.
 await db.query("INSERT INTO people(id,person_code,first_name,last_name,status,date_registered) VALUES (900001,'PR134-LEADER-A','Leader','A','leader',CURRENT_DATE),(900002,'PR134-LEADER-B','Leader','B','leader',CURRENT_DATE),(900003,'PR134-MEMBER-A','Member','A','member',CURRENT_DATE)");
 await db.query("INSERT INTO staff_users(id,username,display_name,password_hash,role_id,person_id) VALUES (900001,'leader-a@pr134.local','Leader A','not-for-login','staff',900001),(900002,'leader-b@pr134.local','Leader B','not-for-login','staff',900002)");
 await db.query("INSERT INTO networks(id,name,gender,leader_person_id) VALUES (900001,'PR134 Network A','boys',900001),(900002,'PR134 Network B','boys',900002)");
 await db.query("INSERT INTO lifegroups(id,name,gender,network_id,leader_person_id) VALUES (900001,'PR134 Cell A','boys',900001,900001),(900002,'PR134 Cell B','boys',900002,900002)");
 await db.query("INSERT INTO lifegroup_memberships(id,person_id,lifegroup_id) VALUES (900001,900003,900001)");
 const actor={id:900001,role_id:'staff'};
 const scope=await resolveLeaderScope(db,actor);
 assert.equal(scope.kind,'network_leader');assert.deepEqual(scope.networkIds,[900001]);assert.deepEqual(scope.cellIds,[900001]);
 assert.doesNotThrow(()=>assertLeaderScope(scope,{cellId:900001}));
 assert.throws(()=>assertLeaderScope(scope,{cellId:900002}),{status:403});
 await authorizeLinkedLeaderTrackerMethod(db,actor,'person',[900003]);
 await assert.rejects(authorizeLinkedLeaderTrackerMethod(db,actor,'network',[900002]),{status:403});
 await assert.rejects(authorizeLinkedLeaderTrackerMethod(db,actor,'lifegroup',[900002]),{status:403});
 console.log('PASS: linked leader isolated PostgreSQL scope and out-of-network denial.');
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
