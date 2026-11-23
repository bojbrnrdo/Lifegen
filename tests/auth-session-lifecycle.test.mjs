import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldRenewStaffSession } from '../src/auth.js';

const auth = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8');
const now = Date.UTC(2026, 10, 2, 0, 0, 0);

test('staff session renewal starts only when less than one hour remains', () => {
  assert.equal(shouldRenewStaffSession(now + 12 * 60 * 60 * 1000, now), false);
  assert.equal(shouldRenewStaffSession(now + 60 * 60 * 1000 + 1, now), false);
  assert.equal(shouldRenewStaffSession(now + 60 * 60 * 1000, now), true);
  assert.equal(shouldRenewStaffSession(now - 1, now), true);
  assert.equal(shouldRenewStaffSession('not a timestamp', now), false);
});

test('authenticated activity renews the server session and cookie near expiry', () => {
  assert.match(auth, /expires_at:rows\[0\]\.expires_at/);
  assert.match(auth, /async function renewStaffSession\(req,res,actor\)/);
  assert.match(auth, /UPDATE staff_sessions SET expires_at=now\(\)\+\(\$2::int\*interval '1 minute'\)/);
  assert.match(auth, /if\(cookieToken\)setStaffCookie\(req,res,cookieToken\)/);
  assert.match(auth, /await renewStaffSession\(req,res,req\.actor\)/);
});
