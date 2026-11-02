// Live data behind the fullscreen VIP announcement.
//
// Everything here is read straight from the LIFEGEN PostgreSQL/Supabase
// database — the same rows the Admin portal sees. Nothing is mocked, and a
// database failure is reported as an error state rather than silently replaced
// with placeholder names.

import { query, directClient } from './db.js';
import {
  cycleFromSettings,
  cycleSettingsToPersist,
  normalizeConfig,
  resolveCycle,
  attributeServiceDate,
  isSundayKey,
  TIME_ZONE,
  CYCLE_STATE,
  currentInstant,
} from './service-cycle.js';
import { revision } from './events.js';
import { httpError } from './domain.js';
import { ensureDesignSelection } from './vip-designs.js';

export const INVITER_FALLBACK = 'Inviter not specified';

// Settings that drive the cycle. Kept in one list so the read is a single query.
const CYCLE_SETTING_KEYS = [
  'vip_announce_start',
  'vip_announce_minutes',
  'vip_announce_service_date',
  'vip_announce_start_hour',
  'vip_announce_start_minute',
  'vip_announce_end_hour',
  'vip_announce_end_minute',
];

const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function cleanName(value) {
  return collapse(value).slice(0, 200);
}

// Missing or blank inviter is rendered as the agreed fallback, server-side, so
// every consumer displays the same text.
export function cleanInviter(value) {
  const name = collapse(value).slice(0, 200);
  return name || INVITER_FALLBACK;
}

export async function readCycle(now = currentInstant(), client = { query }) {
  const { rows } = await client.query(
    'SELECT key, value FROM settings WHERE key = ANY($1::text[])',
    [CYCLE_SETTING_KEYS],
  );
  return cycleFromSettings(rows, now);
}

// Persist a derived announcement window the first time it opens so every
// projector and every later refresh shares one window start. Idempotent: the
// value is derived from the clock, so concurrent writers write the same instant.
export async function persistCycleWindow(cycle, client = { query }) {
  const next = cycleSettingsToPersist(cycle);
  if (!next) return false;
  await client.query(
    `INSERT INTO settings(key, value) VALUES
       ('vip_announce_start', to_jsonb($1::text)),
       ('vip_announce_service_date', to_jsonb($2::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [next.vip_announce_start, next.vip_announce_service_date],
  );
  return true;
}

// The VIPs attributed to one Sunday service, newest last so the list reads in
// sign-up order. The partial unique index from database/007 guarantees one
// attributed row per person per Sunday; COUNT(DISTINCT person_id) keeps the
// total honest even if a legacy duplicate is ever attributed by hand.
// IMPORTANT: Demo-seeded records (people.is_demo = true) are never shown to
// the congregation — only live registrations from POST /api/public/registrations
// appear on the fullscreen board. Preview can still load demo data in DB, it
// just won't be rendered.
export async function vipsForService(serviceDate, client = { query }) {
  if (!isSundayKey(serviceDate)) throw httpError(400, 'A Sunday service date is required.');
  const { rows } = await client.query(
    `SELECT v.full_name, v.inviter, v.person_id, v.created_at
       FROM vip_registrations v
       LEFT JOIN people p ON p.id = v.person_id
      WHERE v.service_date = $1
        AND (p.is_demo IS NULL OR p.is_demo = false)
      ORDER BY v.created_at, v.id`,
    [serviceDate],
  );
  const { rows: totals } = await client.query(
    `SELECT COUNT(DISTINCT v.person_id)::int AS total
       FROM vip_registrations v
       LEFT JOIN people p ON p.id = v.person_id
      WHERE v.service_date = $1
        AND (p.is_demo IS NULL OR p.is_demo = false)`,
    [serviceDate],
  );
  return {
    vips: rows.map((r) => ({
      full_name: cleanName(r.full_name) || 'Unnamed VIP',
      inviter: cleanInviter(r.inviter),
      registered_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
    })),
    total: Number(totals[0]?.total || 0),
  };
}

// Full announcement payload: cycle + names + count + the database revision the
// client can use to detect change.
export async function vipAnnouncement({ date, now = currentInstant(), persist = true } = {}) {
  const cycle = await readCycle(now);
  const requested = date && isSundayKey(date) ? date : null;
  const serviceDate = requested || cycle.announce_service_date;
  const { vips, total } = await vipsForService(serviceDate);
  // The design is chosen in the database, keyed on the Sunday, so every device
  // gets the same artwork and a refresh never re-rolls it.
  const { design, selection, available } = await ensureDesignSelection(serviceDate).catch((e) => ({ design: null, selection: null, available: null, error: e.message }));
  if (persist) await persistCycleWindow(cycle).catch(() => {});
  return {
    timezone: TIME_ZONE,
    generated_at: currentInstant().toISOString(),
    server_time: now.toISOString(),
    state: cycle.state,
    phase: cycle.phase,
    config: cycle.config,
    service_date: serviceDate,
    service_date_display: cycle.service_date_display,
    service_date_short: cycle.service_date_short,
    requested_explicitly: Boolean(requested),
    announce_service_date: cycle.announce_service_date,
    countdown_service_date: cycle.countdown_service_date,
    countdown_service_date_display: cycle.countdown_service_date_display,
    countdown_target_iso: cycle.countdown_target_iso,
    seconds_until_countdown: cycle.seconds_until_countdown,
    service_is_live: cycle.service_is_live,
    window: cycle.window,
    vips,
    total,
    design: design || null,
    design_selection: selection || null,
    designs_available: available || null,
    revision: await revision().catch(() => null),
    source: 'database',
  };
}

// Which Sunday a registration made right now should be announced under.
// Exported so the registration endpoint and the backfill stay in lockstep.
export { attributeServiceDate };

// Public, read-only change stream. Reuses the PostgreSQL LISTEN/NOTIFY channel
// (database/001_init.sql → lifegen_notify_change), which is the same mechanism
// Supabase Realtime delivers. The projector refetches on each change event; if
// this connection cannot be established the projector keeps polling instead.
export async function streamAnnouncementChanges(req, res) {
  const client = directClient();
  await client.connect();
  let closed = false;
  let heartbeat;
  let deadline;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(deadline);
    await client.end().catch(() => {});
    if (!res.writableEnded) res.end();
  };
  try {
    await client.query('LISTEN lifegen_changes');
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 2000\n\n');
    const send = (name, data) => {
      if (!closed && !res.writableEnded) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    client.on('notification', (n) => {
      try {
        send('change', JSON.parse(n.payload));
      } catch {
        /* ignore a malformed payload; the polling backstop still refreshes */
      }
    });
    client.on('error', () => close());
    send('sync', { revision: await revision().catch(() => null) });
    heartbeat = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(': heartbeat\n\n');
    }, 12000);
    const seconds = Math.min(50, Math.max(10, Number(process.env.SSE_MAX_SECONDS) || 45));
    deadline = setTimeout(() => {
      send('reconnect', {});
      close();
    }, seconds * 1000);
    req.on('close', close);
    res.on('close', close);
    await new Promise((resolve) => res.once('close', resolve));
  } catch (e) {
    await close();
    throw e;
  }
}

export { CYCLE_STATE, normalizeConfig, resolveCycle, isSundayKey };
