import assert from 'node:assert/strict';
import test from 'node:test';
import { domain, domainContext, isValidDate } from '../src/domain.js';
import { effectiveGroupCapacity, CELL_MEMBER_LIMIT } from '../src/lifegroups.js';
import { isIsoDate } from '../src/public-api.js';

test('People status validation matches the database status constraint', async () => {
  const data = { people: [{ id: 1, status: 'member', first_name: 'Test', last_name: '', archived_at: null }], records: [], services: [] };
  const context = { data, actor: { id: 1, display_name: 'Test' } };
  await domainContext.run(context, async () => {
    await assert.rejects(() => domain.setPersonStatus(1, 'visitor_3'), (error) => error.status === 400 && error.message === 'Invalid status.');
    const updated = await domain.setPersonStatus(1, 'leader');
    assert.equal(updated.status, 'leader');
  });
});

test('public and domain date validators reject calendar rollover dates', () => {
  for (const invalid of ['2024-02-30', '2023-02-29', '2024-04-31', '2026-13-01']) {
    assert.equal(isValidDate(invalid), false, `domain accepted ${invalid}`);
    assert.equal(isIsoDate(invalid), false, `public registration accepted ${invalid}`);
  }
  for (const valid of ['2024-02-29', '2026-10-20']) {
    assert.equal(isValidDate(valid), true);
    assert.equal(isIsoDate(valid), true);
  }
});

test('effective Lifegroup capacity honors configured limits without exceeding the hierarchy maximum', () => {
  assert.equal(effectiveGroupCapacity({ capacity: null }), CELL_MEMBER_LIMIT);
  assert.equal(effectiveGroupCapacity({}), CELL_MEMBER_LIMIT);
  assert.equal(effectiveGroupCapacity({ capacity: 4 }), 4);
  assert.equal(effectiveGroupCapacity({ capacity: 999 }), CELL_MEMBER_LIMIT);
});
