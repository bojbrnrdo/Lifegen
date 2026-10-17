import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/public-api.js',import.meta.url),'utf8');
const identity=readFileSync(new URL('../src/attendee-pass.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/checkin/checkin.js',import.meta.url),'utf8');

test('never issue attendee pass for public registration that matched existing email',()=>{
 assert.match(api,/attendee_recovery_pass=created\?await issueNewAttendeePass\(client,person.id\):null/);
});
test('account-free passes require feature flag and verification',()=>{
 assert.match(identity,/ATTENDEE_PASSES_ENABLED==='true'/);
 assert.match(identity,/hashToken\(pass\)/);
 assert.match(identity,/revoked_at IS NULL AND ap.expires_at>now\(\)/);
 assert.match(identity,/cookieOptions\(req\)/);
});
test('public attendee recovery requires same origin and rate limiting',()=>{
 assert.match(api,/checkOrigin\(req\);await rateLimit\(req,'attendee-restore',8\)/);
});
test('regular attendee cannot tap Present until a regular attendance claim backend exists',()=>{
 assert.match(api,/can_check_in:serviceCheckinOpen\(pass.service_date\)&&!!vip/);
 assert.match(client,/identity_type==='regular'/);
});
