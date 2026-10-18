import test from 'node:test';
import assert from 'node:assert/strict';
import {signServicePass,verifyServicePass} from '../src/service-qr.js';
const secret='correct-horse-battery-staple-long-secret-value';
test('valid signed service QR identifies same service and date',()=>{
 const token=signServicePass(17,'2026-10-18',secret);
 assert.deepEqual(verifyServicePass(token,secret),{service_id:17,service_date:'2026-10-18'});
});
test('tampered QR cannot change service or date',()=>{
 const token=signServicePass(17,'2026-10-18',secret);
 assert.equal(verifyServicePass(token.replace('17.','18.'),secret),null);
 assert.equal(verifyServicePass(token.replace('2026-10-18','2026-10-25'),secret),null);
});
test('weak or missing signing secret is rejected',()=>{
 assert.throws(()=>signServicePass(1,'2026-10-18','short'));
 assert.equal(verifyServicePass('bad','short'),null);
});
