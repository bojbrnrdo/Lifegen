import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/public-api.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../docs/sql/draft-service-attendance-claims.sql',import.meta.url),'utf8');
test('regular claims require authenticated attendee sessions and csrf',()=>{
 assert.match(api,/readAttendeeSession\(req\)/);
 assert.match(api,/safeEqual\(req.get\('x-csrf-token'\),vip\?\.csrf_token\|\|attendee\?\.csrf_token\)/);
});
test('claim write is behind explicit activation flag',()=>{
 assert.match(api,/SERVICE_ATTENDANCE_CLAIMS_ENABLED!=='true'/);
});
test('each person can have only one claim per service',()=>{
 assert.match(sql,/UNIQUE \(service_id,person_id\)/);
 assert.match(api,/ON CONFLICT \(service_id,person_id\)/);
});
test('admin review requires permission and pending claim',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(app,/validateRegularCheckin:\['attendance:write',true\]/);
 assert.match(app,/claim.status!=='pending'/);
 assert.match(app,/logAction\(client,actor,'service_attendance_claims'/);
});
test('repeat scan reads existing claim without updating validation status',()=>{
 assert.match(api,/ON CONFLICT \(service_id,person_id\) DO NOTHING/);
 assert.match(api,/SELECT id,status FROM service_attendance_claims WHERE service_id=/);
});
test('public claimant cannot directly write valid status',()=>{
 assert.match(sql,/status text NOT NULL DEFAULT 'pending'/);
 assert.match(api,/INSERT INTO service_attendance_claims\(service_id,person_id,source\)/);
});
