// VIP promotion rules.
//
// Attendance is tracked only for VIPs, and a validated check-in is the record,
// so these tests drive the rules through vip_checkins rows rather than through
// a general Sunday roster that no longer exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promoteVipMemberIfEligible, domainContext } from '../src/domain.js';

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
    vip_registrations: vip ? [{ id: 1, person_id: 1 }] : [],
    vip_checkins: [],
    seq: { people: 1, vip_registrations: 1, vip_checkins: 0 },
    settings: {},
  };
}

/** Mark a Sunday present for person 1, the way validateCheckin does. */
function attend(data, sundayIndex) {
  data.vip_checkins.push({
    id: data.seq.vip_checkins = (data.seq.vip_checkins || 0) + 1,
    registration_id: 1,
    date_key: SUNDAYS[sundayIndex],
    status: 'valid',
  });
}

test('a VIP becomes a Member on the fifth distinct Sunday, and stays a Member after a correction', async () => {
  const data = fixture();
  await domainContext.run({ data }, async () => {
    for (let i = 0; i < 4; i++) attend(data, i);
    promoteVipMemberIfEligible(1);
    assert.equal(data.people[0].status, 'first_timer', 'four visits are not enough');

    // The same Sunday marked twice must not count as another visit.
    attend(data, 0);
    promoteVipMemberIfEligible(1);
    assert.equal(data.people[0].status, 'first_timer', 'a repeated Sunday is not a new visit');

    attend(data, 4);
    assert.equal(promoteVipMemberIfEligible(1), true, 'the fifth distinct Sunday promotes the linked VIP');
    assert.equal(data.people[0].status, 'member');

    // Invalidating the fifth check-in (an undo/correction) must not downgrade.
    data.vip_checkins.find((c) => c.date_key === SUNDAYS[4]).status = 'invalid';
    promoteVipMemberIfEligible(1);
    assert.equal(data.people[0].status, 'member', 'a correction does not silently downgrade a promoted status');
  });
});

test('five visits do not auto-promote someone without a VIP registration', async () => {
  const data = fixture({ vip: false });
  await domainContext.run({ data }, async () => {
    // No registration means the check-ins cannot even be attached to a person,
    // so the person stays a first timer.
    data.vip_checkins.push({ id: 1, registration_id: 1, date_key: SUNDAYS[0], status: 'valid' });
    for (let i = 1; i < 5; i++) attend(data, i);
    promoteVipMemberIfEligible(1);
    assert.equal(data.people[0].status, 'first_timer');
  });
});

test('an only pending or invalid check-in never counts as attendance', async () => {
  const data = fixture();
  await domainContext.run({ data }, async () => {
    for (let i = 0; i < 5; i++) {
      data.vip_checkins.push({
        id: data.seq.vip_checkins = (data.seq.vip_checkins || 0) + 1,
        registration_id: 1,
        date_key: SUNDAYS[i],
        status: i === 0 ? 'pending' : 'invalid',
      });
    }
    promoteVipMemberIfEligible(1);
    assert.equal(data.people[0].status, 'first_timer', 'only a verified check-in is attendance');
  });
});
