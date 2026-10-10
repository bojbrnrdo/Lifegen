import test from 'node:test';
import assert from 'node:assert/strict';
import { domain, domainContext } from '../src/domain.js';

const SUNDAYS = [
  '2026-01-04',
  '2026-01-11',
  '2026-01-18',
  '2026-01-25',
  '2026-02-01',
  '2026-02-08',
];

function fixture({ vip = true, status = 'first_timer' } = {}) {
  return {
    people: [{
      id: 1,
      first_name: 'Jordan',
      last_name: 'Guest',
      full_name: 'Jordan Guest',
      status,
      date_registered: SUNDAYS[0],
      date_first_attended: null,
      archived_at: null,
    }],
    services: SUNDAYS.map((service_date, index) => ({ id: index + 1, service_date })),
    records: [],
    audit: [],
    vip_registrations: vip ? [{ id: 1, person_id: 1 }] : [],
    seq: { people: 1, services: SUNDAYS.length, records: 0, audit: 0 },
    settings: {},
  };
}

test('a VIP becomes a Member on the fifth distinct present Sunday, and stays a Member after an attendance correction', async () => {
  const data = fixture();
  await domainContext.run({ data }, async () => {
    for (let serviceId = 1; serviceId <= 4; serviceId++) {
      await domain.mark(serviceId, 1, 'present');
    }
    assert.equal(data.people[0].status, 'first_timer', 'four visits are not enough');

    await domain.mark(1, 1, 'present');
    assert.equal(data.people[0].status, 'first_timer', 're-marking one Sunday must not count as another visit');

    await domain.mark(5, 1, 'present');
    assert.equal(data.people[0].status, 'member', 'the fifth distinct Sunday promotes the linked VIP');

    await domain.undoMark(5, 1);
    assert.equal(data.people[0].status, 'member', 'a correction does not silently downgrade a promoted status');
  });
});

test('five visits do not auto-promote someone without a VIP registration', async () => {
  const data = fixture({ vip: false });
  await domainContext.run({ data }, async () => {
    for (let serviceId = 1; serviceId <= 5; serviceId++) {
      await domain.mark(serviceId, 1, 'present');
    }
    assert.equal(data.people[0].status, 'first_timer');
  });
});

test('a regular VIP is promoted to Member after their fifth distinct visit', async () => {
  const data = fixture({ status: 'regular' });
  await domainContext.run({ data }, async () => {
    for (let serviceId = 1; serviceId <= 5; serviceId++) {
      await domain.mark(serviceId, 1, 'present');
    }
    assert.equal(data.people[0].status, 'member');
  });
});
