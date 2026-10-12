import test from 'node:test';
import assert from 'node:assert/strict';
import { vipWindowSundays, vipWindowResult } from '../src/domain.js';

test('vipWindowSundays starts on the invite day when it is a Sunday', () => {
  assert.deepEqual(vipWindowSundays('2026-09-06'), ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
});

test('vipWindowSundays rolls forward to the next Sunday for mid-week invites', () => {
  // 2026-10-12 is a Monday.
  assert.deepEqual(vipWindowSundays('2026-10-12'), ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08']);
});

test('vipWindowResult counts only Sundays inside the window and maps outcomes', () => {
  const r = vipWindowResult(['2026-09-06', '2026-09-13', '2026-09-27', '2026-10-04'], '2026-09-06', '2026-10-12');
  assert.equal(r.count, 3); // the Oct 4 visit is outside the window
  assert.equal(r.closed, true);
  assert.equal(r.outcome, 'visitor_3');
  assert.deepEqual(r.attended, [true, true, false, true]);
});

test('vipWindowResult is open while the 4th window Sunday is still ahead', () => {
  const r = vipWindowResult(['2026-10-04'], '2026-10-04', '2026-10-12');
  assert.equal(r.closed, false);
  assert.equal(r.count, 1);
  assert.equal(r.outcome, 'visitor_1');
});

test('vipWindowResult maps 4/4 to regular and 0 to no_returns', () => {
  assert.equal(vipWindowResult(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'], '2026-09-06', '2026-10-12').outcome, 'regular');
  assert.equal(vipWindowResult([], '2026-09-06', '2026-10-12').outcome, 'no_returns');
});
