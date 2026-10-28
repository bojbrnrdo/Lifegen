// Sunday service cycle + fullscreen VIP announcement.
//
// The cycle module is pure, so its phase transitions are asserted directly at
// the instants that matter. The browser page and the SQL migration are checked
// the way this repository already checks public assets and migrations: by
// asserting on the shipped source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  resolveCycle,
  attributeServiceDate,
  nextServiceStart,
  nextSundayKey,
  previousSundayKey,
  isSundayKey,
  describeServiceDate,
  shortServiceDate,
  cycleFromSettings,
  cycleSettingsToPersist,
  CYCLE_STATE,
  CYCLE_PHASE,
} from '../src/service-cycle.js';
import { cleanInviter, cleanName, INVITER_FALLBACK } from '../src/vip-announcement.js';

const root = path.resolve(import.meta.dirname, '..');

// Asia/Manila is UTC+08:00 with no DST, so a Manila wall clock reads directly
// off these ISO instants. 2026-10-18 is a Sunday.
const at = (iso) => new Date(iso);

test('the service date is derived in Asia/Manila, never hardcoded', () => {
  // Saturday 23:30 UTC is already Sunday 07:30 in Manila.
  assert.equal(attributeServiceDate(at('2026-10-17T23:30:00Z')), '2026-10-18');
  // Friday 20:00 UTC is Saturday 04:00 in Manila — still the coming Sunday.
  assert.equal(attributeServiceDate(at('2026-10-16T20:00:00Z')), '2026-10-18');
  // Wednesday in Manila belongs to the coming Sunday.
  assert.equal(attributeServiceDate(at('2026-10-13T22:00:00Z')), '2026-10-18');
  // Registered during the service itself belongs to that same Sunday.
  assert.equal(attributeServiceDate(at('2026-10-18T05:30:00Z')), '2026-10-18');
  // After the service, still that Sunday (not the next one).
  assert.equal(attributeServiceDate(at('2026-10-18T14:00:00Z')), '2026-10-18');
  // Monday in Manila rolls forward a full week.
  assert.equal(attributeServiceDate(at('2026-10-19T02:00:00Z')), '2026-10-25');
  assert.equal(isSundayKey(attributeServiceDate(at('2026-10-19T02:00:00Z'))), true);
});

test('Sunday arithmetic is correct at the week boundaries', () => {
  assert.equal(nextSundayKey('2026-10-13'), '2026-10-18');
  assert.equal(nextSundayKey('2026-10-18'), '2026-10-25'); // a Sunday rolls a full week
  assert.equal(previousSundayKey('2026-10-18'), '2026-10-11');
  assert.equal(previousSundayKey('2026-10-13'), '2026-10-11');
  assert.equal(nextSundayKey('2026-12-29'), '2027-01-03'); // crosses the year
});

test('before the service the cycle counts down to the upcoming Sunday', () => {
  const wednesday = resolveCycle({ now: at('2026-10-14T02:00:00Z') }); // Wed 10:00 Manila
  assert.equal(wednesday.state, CYCLE_STATE.COUNTDOWN);
  assert.equal(wednesday.phase, CYCLE_PHASE.COUNTDOWN);
  assert.equal(wednesday.countdown_service_date, '2026-10-18');
  assert.equal(wednesday.service_date, '2026-10-18');
  assert.equal(wednesday.countdown_target_iso, '2026-10-18T05:00:00.000Z'); // 1:00 PM Manila
  assert.equal(wednesday.service_is_live, false);
  // A projector opened before the service prepares TODAY's list, not last week's.
  assert.equal(wednesday.announce_service_date, '2026-10-18');
});

test('the countdown does not switch back the instant it reaches zero', () => {
  const oneSecondBefore = resolveCycle({ now: at('2026-10-18T04:59:59Z') });
  assert.equal(oneSecondBefore.state, CYCLE_STATE.COUNTDOWN);
  assert.equal(oneSecondBefore.countdown_service_date, '2026-10-18');

  const atStart = resolveCycle({ now: at('2026-10-18T05:00:00Z') }); // 1:00:00 PM Manila
  assert.equal(atStart.state, CYCLE_STATE.VIP_ANNOUNCEMENT);
  assert.equal(atStart.phase, CYCLE_PHASE.VIP_ANNOUNCEMENT);
  assert.equal(atStart.announce_service_date, '2026-10-18');
  assert.equal(atStart.service_date, '2026-10-18');
  assert.equal(atStart.service_is_live, true);

  const justAfter = resolveCycle({ now: at('2026-10-18T05:00:02Z') });
  assert.equal(justAfter.state, CYCLE_STATE.VIP_ANNOUNCEMENT,
    'two seconds into the service the board must still show the announcement');
});

test('the announcement holds for the configured duration, then returns to the countdown', () => {
  const inside = resolveCycle({ now: at('2026-10-18T06:29:00Z') }); // 2:29 PM Manila — still inside 120-min window
  assert.equal(inside.state, CYCLE_STATE.VIP_ANNOUNCEMENT);
  assert.equal(inside.window.seconds_remaining > 0, true);

  const after = resolveCycle({ now: at('2026-10-18T07:00:01Z') }); // 3:00:01 PM Manila — after the 120-min window
  assert.equal(after.state, CYCLE_STATE.COUNTDOWN);
  assert.equal(after.phase, CYCLE_PHASE.NEXT_SUNDAY_COUNTDOWN);
  assert.equal(after.countdown_service_date, '2026-10-25');
  // The service has ended at 3:00 PM.
  assert.equal(after.service_is_live, false);

  const ended = resolveCycle({ now: at('2026-10-18T07:30:00Z') }); // 3:30 PM Manila
  assert.equal(ended.service_is_live, false);
  assert.equal(ended.phase, CYCLE_PHASE.NEXT_SUNDAY_COUNTDOWN);
  assert.equal(ended.countdown_service_date, '2026-10-25');

  const weekday = resolveCycle({ now: at('2026-10-20T02:00:00Z') }); // Tuesday
  assert.equal(weekday.phase, CYCLE_PHASE.COUNTDOWN,
    'a plain weekday is COUNTDOWN, not NEXT_SUNDAY_COUNTDOWN');
});

test('the configured duration and start time drive the transition', () => {
  const long = resolveCycle({
    now: at('2026-10-18T06:45:00Z'), // 2:45 PM Manila
    config: { announce_minutes: 120 },
  });
  assert.equal(long.state, CYCLE_STATE.VIP_ANNOUNCEMENT);

  const early = resolveCycle({
    now: at('2026-10-18T01:30:00Z'), // 9:30 AM Manila
    config: { start_hour: 9, start_minute: 0, announce_minutes: 30 },
  });
  assert.equal(early.state, CYCLE_STATE.VIP_ANNOUNCEMENT);
  assert.equal(early.announce_service_date, '2026-10-18');

  const junk = resolveCycle({ now: at('2026-10-14T02:00:00Z'), config: { announce_minutes: 'abc' } });
  assert.equal(junk.config.announce_minutes, 120, 'a bad setting falls back to the default');
});

test('the persisted window survives a projector refresh', () => {
  const opened = resolveCycle({ now: at('2026-10-18T05:00:00Z') });
  assert.equal(opened.window.source, 'derived');
  const toPersist = cycleSettingsToPersist(opened);
  assert.deepEqual(toPersist, {
    vip_announce_start: '2026-10-18T05:00:00.000Z',
    vip_announce_service_date: '2026-10-18',
  });

  // Same instant read back from settings: identical state, so a refresh cannot
  // restart the cycle or flip it early.
  const refreshed = resolveCycle({
    now: at('2026-10-18T05:12:00Z'),
    announce_start: toPersist.vip_announce_start,
    announce_service_date: toPersist.vip_announce_service_date,
  });
  assert.equal(refreshed.state, CYCLE_STATE.VIP_ANNOUNCEMENT);
  assert.equal(refreshed.window.source, 'persisted');
  assert.equal(cycleSettingsToPersist(refreshed), null, 'a persisted window is not rewritten');

  // A window persisted for LAST Sunday must not keep today's board open.
  const stale = resolveCycle({
    now: at('2026-10-25T04:00:00Z'), // the following Sunday, before 1:00 PM
    announce_start: '2026-10-18T05:00:00.000Z',
    announce_service_date: '2026-10-18',
  });
  assert.equal(stale.state, CYCLE_STATE.COUNTDOWN);
});

test('cycleFromSettings reads the announcement window out of settings rows', () => {
  const rows = [
    { key: 'vip_announce_minutes', value: 45 },
    { key: 'vip_announce_start', value: '2026-10-18T05:00:00.000Z' },
    { key: 'vip_announce_service_date', value: '2026-10-18' },
  ];
  const cycle = cycleFromSettings(rows, at('2026-10-18T05:40:00Z'));
  assert.equal(cycle.config.announce_minutes, 45);
  assert.equal(cycle.state, CYCLE_STATE.VIP_ANNOUNCEMENT);
  assert.equal(cycle.announce_service_date, '2026-10-18');
  // 'null' JSON (the migration's initial value) must read as "no window yet".
  const empty = cycleFromSettings([{ key: 'vip_announce_start', value: null }], at('2026-10-14T02:00:00Z'));
  assert.equal(empty.state, CYCLE_STATE.COUNTDOWN);
});

test('a weekday afternoon never opens the board or targets a phantom service', () => {
  // Wednesday 1:15 PM Manila sits inside the 1:00–1:30 window numerically.
  const wednesday = resolveCycle({ now: at('2026-10-14T05:15:00Z') });
  assert.equal(wednesday.state, CYCLE_STATE.COUNTDOWN);
  assert.equal(wednesday.countdown_service_date, '2026-10-18');
  assert.equal(wednesday.countdown_target_iso, '2026-10-18T05:00:00.000Z');
  assert.equal(wednesday.service_is_live, false);
  // The projector still prepares the coming Sunday's list, never a weekday's.
  assert.equal(wednesday.announce_service_date, '2026-10-18');
});

test('nextServiceStart always returns a future Sunday 1:00 PM in Manila', () => {
  assert.equal(nextServiceStart(at('2026-10-14T02:00:00Z')).toISOString(), '2026-10-18T05:00:00.000Z');
  // A weekday past 1:00 PM must not return today.
  assert.equal(nextServiceStart(at('2026-10-14T05:15:00Z')).toISOString(), '2026-10-18T05:00:00.000Z');
  assert.equal(nextServiceStart(at('2026-10-18T04:00:00Z')).toISOString(), '2026-10-18T05:00:00.000Z');
  // While a service runs, the countdown already targets next week.
  assert.equal(nextServiceStart(at('2026-10-18T05:30:00Z')).toISOString(), '2026-10-25T05:00:00.000Z');
});

test('display dates are rendered from the date, not from a fixed string', () => {
  assert.equal(describeServiceDate('2026-10-18'), 'Sunday, October 18, 2026');
  assert.equal(describeServiceDate('2026-10-18', { year: false }), 'Sunday, October 18');
  assert.equal(shortServiceDate('2026-10-18'), 'Oct 18');
  assert.equal(shortServiceDate('2026-11-01'), 'Nov 1');
  assert.equal(describeServiceDate('2026-10-19'), '', 'a non-Sunday has no service label');
});

test('a missing inviter falls back to the agreed wording', () => {
  assert.equal(cleanInviter(null), INVITER_FALLBACK);
  assert.equal(cleanInviter(''), INVITER_FALLBACK);
  assert.equal(cleanInviter('   '), INVITER_FALLBACK);
  assert.equal(cleanInviter(undefined), INVITER_FALLBACK);
  assert.equal(cleanInviter('  Pastor   Reyes '), 'Pastor Reyes');
  assert.equal(INVITER_FALLBACK, 'Inviter not specified');
});

test('names are trimmed and collapsed before they reach the board', () => {
  assert.equal(cleanName('  Juan   Dela   Cruz '), 'Juan Dela Cruz');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('a'.repeat(400)).length, 200);
});

// ---- Shipped-source checks --------------------------------------------------

test('the announcement page exists and renders every value from live data', async () => {
  const html = await readFile(path.join(root, 'public/vip-announce/index.html'), 'utf8');
  const js = await readFile(path.join(root, 'public/vip-announce/app.js'), 'utf8');
  const css = await readFile(path.join(root, 'public/vip-announce/styles.css'), 'utf8');

  // The approved design tokens: dark forest green, gold border and accents.
  assert.match(css, /--forest:#0F3D1C/);
  assert.match(css, /--gold:#D4AF37/);
  assert.match(css, /border:2px solid var\(--gold\)/);

  // Branding and the heading are markup, so their text is never baked into an image.
  assert.match(html, /\/brand\/lifegen-logo\.jpg/);
  assert.match(html, /Welcome our <em>VIPs<\/em>/);

  // Every dynamic value has a node the client fills in from the payload.
  for (const id of ['svcDate', 'countNum', 'countWord', 'roster', 'stateBox', 'cdDate']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  // No date, name or count is hardcoded in the page.
  assert.doesNotMatch(html, /October\s+\d{1,2}|2026-1\d-\d\d/i);

  // The count format from the spec: two digits, singular only at exactly one.
  assert.match(js, /padStart\(2, '0'\)/);
  assert.match(js, /total === 1 \? 'VIP TODAY' : 'VIPs TODAY'/);

  // Live updates, states, and no invented records.
  assert.match(js, /\/api\/public\/vip-announcement/);
  assert.match(js, /EventSource/);
  assert.match(js, /setStateBox\(\s*'empty'/);
  assert.match(js, /setStateBox\(\s*'error'/);
  assert.match(js, /showSkeleton/);
  assert.match(js, /requestFullscreen/);
  // The roster is built only from the payload's VIP records — never from a list
  // baked into the page.
  assert.match(js, /renderRoster\(payload\.vips\)/);
  assert.doesNotMatch(js, /\[\s*{\s*full_name:/);
});

test('the projector updates in place so fullscreen survives a data change', async () => {
  const js = await readFile(path.join(root, 'public/vip-announce/app.js'), 'utf8');
  // In-place DOM updates only — no navigation or reload that would drop fullscreen.
  assert.doesNotMatch(js, /location\.(href|assign|reload)|window\.location/);
  assert.match(js, /replaceChildren/);
  // A change event and the polling backstop both trigger a refetch.
  assert.match(js, /stream-change/);
  assert.match(js, /startPolling/);
  // Rendering uses textContent for user-supplied strings, so a name cannot inject markup.
  assert.match(js, /name\.textContent = vip\.full_name/);
  assert.match(js, /who\.textContent = noInviter \? 'not recorded' : vip\.inviter/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
});

test('the migration adds a Sunday-only service_date with duplicate protection', async () => {
  const sql = await readFile(path.join(root, 'database/007_vip_service_date.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS service_date date/);
  assert.match(sql, /EXTRACT\(DOW FROM service_date\) = 0/);
  assert.match(sql, /vip_registrations_service_person_uniq/);
  assert.match(sql, /vip_registrations_service_identity_uniq/);
  // The backfill reads created_at in Asia/Manila and keeps the earliest row only.
  assert.match(sql, /AT TIME ZONE 'Asia\/Manila'/);
  assert.match(sql, /ROW_NUMBER\(\) OVER/);
  assert.match(sql, /WHERE service_date IS NOT NULL/);
  // Non-destructive: the migration must not delete registrations.
  assert.doesNotMatch(sql, /DELETE FROM vip_registrations|DROP TABLE/i);
  // The shared window state is created so the cycle survives a refresh.
  assert.match(sql, /vip_announce_start/);
  assert.match(sql, /schema_migrations/);
});

test('the public API exposes the announcement, the cycle and a change stream', async () => {
  const api = await readFile(path.join(root, 'src/public-api.js'), 'utf8');
  assert.match(api, /publicRouter\.get\('\/vip-announcement'/);
  assert.match(api, /publicRouter\.get\('\/vip-announcement\/stream'/);
  assert.match(api, /publicRouter\.get\('\/service-cycle'/);
  // Registrations are attributed to a Sunday service on insert.
  assert.match(api, /attributeServiceDate\(currentInstant\(\)\)/);
  assert.match(api, /service_date/);
});

test('the projector page is routed and kept read-only', async () => {
  const app = await readFile(path.join(root, 'src/app.js'), 'utf8');
  assert.match(app, /page\(res,'vip-announce'\)/);
  assert.match(app, /\/vip-announce/);
  // The announcement payload must not leak private VIP fields.
  const announcement = await readFile(path.join(root, 'src/vip-announcement.js'), 'utf8');
  assert.match(announcement, /SELECT v\.full_name, v\.inviter, v\.person_id, v\.created_at/);
  for (const private_column of ['v.contact', 'v.age', 'v.school', 'v.recovery_hash', 'v.legacy_token_hash']) {
    assert.doesNotMatch(announcement, new RegExp(private_column.replace('.', '\\.')),
      `${private_column} must never be selected for the public board`);
  }
  // The count cannot be inflated by a duplicate: distinct people only.
  assert.match(announcement, /COUNT\(DISTINCT person_id\)/);
});

test('the hero countdown and the projector read the same service-date source', async () => {
  const site = await readFile(path.join(root, 'public/lifegen/app.js'), 'utf8');
  const projector = await readFile(path.join(root, 'public/vip-announce/app.js'), 'utf8');
  assert.match(site, /\/api\/public\/service-cycle/);
  assert.match(site, /countdown_target_iso/);
  assert.match(projector, /countdown_target_iso/);
  // The site keeps a local fallback so a slow API cannot blank the countdown.
  assert.match(site, /keep the locally computed countdown/);
});
