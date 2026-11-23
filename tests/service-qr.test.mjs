import test from 'node:test';
import assert from 'node:assert/strict';
import {signServicePass,verifyServicePass,serviceQrConfigured} from '../src/service-qr.js';

const secret='a'.repeat(40);

// The pass identifies a SUNDAY. General Sunday attendance and the `services`
// table were removed, so the date alone is the identity.
test('a valid signed QR identifies its Sunday',()=>{
 const token=signServicePass('2026-10-18',secret);
 assert.deepEqual(verifyServicePass(token,secret),{service_date:'2026-10-18'});
});

test('tampering with the date invalidates the QR',()=>{
 const token=signServicePass('2026-10-18',secret);
 assert.equal(verifyServicePass(token.replace('2026-10-18','2026-10-25'),secret),null);
});

test('a QR is refused for a day that is not a Sunday',()=>{
 assert.throws(()=>signServicePass('2026-10-19',secret));
 assert.throws(()=>signServicePass('not-a-date',secret));
});

test('weak or missing signing secret is rejected',()=>{
 assert.throws(()=>signServicePass('2026-10-18','short'));
 assert.equal(serviceQrConfigured('short'),false);
 assert.equal(serviceQrConfigured(secret),true);
 assert.equal(verifyServicePass('bad','short'),null);
});

test('a pass signed with one secret does not verify with another',()=>{
 const token=signServicePass('2026-10-18',secret);
 assert.equal(verifyServicePass(token,'b'.repeat(40)),null);
});
