import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReportRange } from '../src/attendance.js';

test('attendance reports resolve calendar month, quarter, and year boundaries', () => {
  assert.deepEqual(resolveReportRange({ year: 2024, month: 2 }), {
    from: '2024-02-01', to: '2024-02-29', label: 'February 2024',
  });
  assert.deepEqual(resolveReportRange({ year: 2026, quarter: 3 }), {
    from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026',
  });
  assert.deepEqual(resolveReportRange({ year: 2025 }), {
    from: '2025-01-01', to: '2025-12-31', label: '2025',
  });
});

test('attendance report custom ranges reject impossible dates and reversed bounds', () => {
  assert.throws(() => resolveReportRange({ from: '2026-02-30', to: '2026-03-01' }), /valid report date range/i);
  assert.throws(() => resolveReportRange({ from: '2026-10-12', to: '2026-10-11' }), /valid report date range/i);
});
