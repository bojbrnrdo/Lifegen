// Pure calendar logic: Sunday generation, merge, validation, ICS export.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sundaysInRange, mergeWithWeeklySundays, weeklySundayShape, publicShape,
  validateEventInput, manilaToUtcStamp, eventToIcs, byStart,
} from '../src/calendar.js';

test('sundaysInRange lists every Sunday with from<=date<to', () => {
  assert.deepEqual(sundaysInRange('2026-10-05', '2026-10-19'), ['2026-10-11', '2026-10-18']);
  assert.deepEqual(sundaysInRange('2026-10-11', '2026-10-12'), ['2026-10-11']); // Sunday itself, [from,to)
  assert.deepEqual(sundaysInRange('2026-10-12', '2026-10-18'), []); // week without a Sunday yet
  assert.deepEqual(sundaysInRange('2026-12-28', '2027-01-05'), ['2027-01-03']); // crosses the year
});

test('mergeWithWeeklySundays adds the weekly service and keeps events sorted', () => {
  const events = [
    publicShape({ id: 2, title: 'Youth Night', event_date: '2026-10-09', category: 'youth', start_time: '18:00', end_time: '20:30' }),
    publicShape({ id: 1, title: 'Prayer Gathering', event_date: '2026-10-12', category: 'prayer', start_time: '06:00', all_day: false }),
  ];
  const merged = mergeWithWeeklySundays(events, '2026-10-01', '2026-10-18');
  assert.deepEqual(merged.map((e) => `${e.date} ${e.title}`), [
    '2026-10-04 LIFEGEN Sunday Service',
    '2026-10-09 Youth Night',
    '2026-10-11 LIFEGEN Sunday Service',
    '2026-10-12 Prayer Gathering',
  ]);
  const sunday = merged.find((e) => e.recurring);
  assert.equal(sunday.start_time, '13:00');
  assert.equal(sunday.end_time, '15:00');
  assert.equal(sunday.label, 'Every Sunday');
});

test('a stored service-category event replaces the auto Sunday on its date', () => {
  const events = [publicShape({ id: 5, title: 'Combined Service with guests', event_date: '2026-10-11', category: 'service', start_time: '10:00', end_time: '12:00' })];
  const merged = mergeWithWeeklySundays(events, '2026-10-05', '2026-10-19');
  const sundays = merged.filter((e) => e.date === '2026-10-11');
  assert.equal(sundays.length, 1);
  assert.equal(sundays[0].recurring, false);
  assert.equal(sundays[0].start_time, '10:00');
  assert.ok(merged.some((e) => e.date === '2026-10-18' && e.recurring)); // other Sundays remain
});

test('validateEventInput normalizes and rejects bad input', () => {
  const ok = validateEventInput({ title: '  Youth   Night ', category: 'youth', date: '2026-11-13', start_time: '18:00', end_time: '20:30', location: ' Main hall ', description: 'Bring a friend.' });
  assert.equal(ok.title, 'Youth Night');
  assert.equal(ok.location, 'Main hall');
  assert.equal(ok.is_published, true);

  assert.throws(() => validateEventInput({ title: 'Y', date: '2026-11-13' }), /title between 2 and 200/);
  assert.throws(() => validateEventInput({ title: 'Ok', category: 'party', date: '2026-11-13' }), /valid event category/);
  assert.throws(() => validateEventInput({ title: 'Ok', date: '2026-02-30' }), /valid event date/);
  assert.throws(() => validateEventInput({ title: 'Ok', date: '2026-11-13', start_time: '7pm' }), /HH:MM/);
  assert.throws(() => validateEventInput({ title: 'Ok', date: '2026-11-13', start_time: '20:00', end_time: '18:00' }), /end time must be after/);
  const allDay = validateEventInput({ title: 'Retreat', date: '2026-11-14', all_day: true, start_time: '18:00', end_time: '21:00' });
  assert.equal(allDay.all_day, true);
  assert.equal(allDay.start_time, null);
  assert.equal(allDay.end_time, null);
});

test('manilaToUtcStamp converts Asia/Manila wall time to UTC (UTC+8, no DST)', () => {
  assert.equal(manilaToUtcStamp('2026-10-11', '13:00'), '20261011T050000Z'); // 1 PM PHT -> 05:00 UTC
  assert.equal(manilaToUtcStamp('2026-10-11', '03:00'), '20261010T190000Z'); // crosses midnight backwards
  assert.equal(manilaToUtcStamp('2026-10-11', '00:30'), '20261010T163000Z');
});

test('eventToIcs produces RFC 5545 output', () => {
  const sunday = weeklySundayShape('2026-10-11');
  const ics = eventToIcs(sunday, '20261010T000000Z');
  assert.match(ics, /^BEGIN:VEVENT/);
  assert.match(ics, /UID:lifegen-sunday-service@lifegen/);
  assert.equal(eventToIcs(weeklySundayShape('2026-10-18'), '20261010T000000Z').match(/UID:.*/)[0], ics.match(/UID:.*/)[0], 'every weekly Sunday shares one UID');
  assert.match(ics, /DTSTART:20261011T050000Z/);
  assert.match(ics, /DTEND:20261011T070000Z/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=SU/);
  assert.match(ics, /SUMMARY:LIFEGEN Sunday Service/);
  assert.match(ics, /END:VALARM/);

  const long = eventToIcs(publicShape({
    id: 9, title: 'Outreach — Long description with comma, semicolon; and line\nbreak', event_date: '2026-11-14', all_day: true, category: 'outreach',
  }), '20261010T000000Z');
  assert.match(long, /DTSTART;VALUE=DATE:20261114/);
  assert.match(long, /SUMMARY:[^\r\n]*comma\\, semicolon\\;/);
  assert.match(long, /break/); // folded continuation contains the escaped newline tail
  assert.ok(long.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'every ICS line is folded to <=75 octets');

});

test('byStart orders by date, then time, then title', () => {
  const a = { date: '2026-10-11', start_time: '09:00', title: 'A' };
  const b = { date: '2026-10-11', start_time: '13:00', title: 'B' };
  const c = { date: '2026-10-12', start_time: null, title: 'C' };
  assert.deepEqual([b, c, a].sort(byStart), [a, b, c]);
});
