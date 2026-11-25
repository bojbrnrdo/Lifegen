import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manilaToday,sundayOptions} from '../public/admin/js/serviceQrDates.js';
const view=readFileSync(new URL('../public/admin/js/views/registrations.js',import.meta.url),'utf8');
test('Sunday QR defaults to next upcoming Sunday even after service day',()=>{
 assert.deepEqual(sundayOptions('2026-11-25',3),['2026-11-29','2026-12-06','2026-12-13']);
 assert.deepEqual(sundayOptions('2026-11-29',3),['2026-11-29','2026-12-06','2026-12-13']);
 assert.deepEqual(sundayOptions('2026-12-31',2),['2027-01-03','2027-01-10']);
 assert.throws(()=>sundayOptions('2026-02-30'),/Invalid Manila date/);
});
test('Sunday QR uses Manila-local date when client is in another timezone',()=>{
 assert.equal(manilaToday(new Date('2026-11-28T16:30:00Z')),'2026-11-29');
 assert.equal(manilaToday(new Date('2026-11-29T15:30:00Z')),'2026-11-29');
});
test('QR UI has Sunday selection, disabled-before-loaded print/copy and clear error',()=>{
 for(const feature of ['id="serviceQrDate"','id="refreshServiceQr"','id="printServiceQr" disabled','id="copyServiceQr" disabled','role="status"','aria-live="polite"','navigator.clipboard.writeText(currentUrl)','poster.hidden=true','if(seq!==request||!main.isConnected)return'])assert.ok(view.includes(feature),feature);
 assert.doesNotMatch(view,/toISODate\(lastSunday\(\)\)/);
 assert.match(view,/api\.serviceQr\(date\)/);
});
