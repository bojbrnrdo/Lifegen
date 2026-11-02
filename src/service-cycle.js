// Single source of truth for the LIFEGEN Sunday service cycle.
//
// The public countdown (public/lifegen/app.js), the fullscreen VIP announcement
// (public/vip-announce/app.js) and the VIP attribution rule (database/007 and
// attributeServiceDate below) all derive their Sunday from this one module, so
// they cannot disagree about which service "today's" means.
//
// All arithmetic is done in Asia/Manila. That zone has observed no DST since
// 1978, so a fixed +08:00 offset is exact. Intl is preferred; the offset is the
// fallback for a runtime without full ICU data.

export const TIME_ZONE = 'Asia/Manila';

// Demo-only clock for the local preview database. LOCAL_DEMO_CLOCK holds a
// Manila-time instant (e.g. 2026-10-18T13:05:00+08:00) and the clock then runs
// forward in real time from that point, so the Sunday service, the countdown and
// the VIP board behave as they would on the day. It is honoured only when
// LOCAL_DEMO=true and the process is not production or Vercel, so a real
// deployment always reads the true clock.
let demoClockAnchor = null;
let demoClockBootReal = 0;
export function demoClockEnabled() {
  return process.env.LOCAL_DEMO === 'true'
    && process.env.NODE_ENV !== 'production'
    && !process.env.VERCEL
    && Boolean(process.env.LOCAL_DEMO_CLOCK);
}
// The clock every server-side cycle decision reads. Real time unless the
// demo clock is enabled.
export function currentInstant() {
  if (!demoClockEnabled()) return new Date();
  if (demoClockAnchor === null) {
    const at = new Date(process.env.LOCAL_DEMO_CLOCK);
    if (Number.isNaN(at.getTime())) return new Date();
    demoClockAnchor = at.getTime();
    demoClockBootReal = Date.now();
  }
  return new Date(demoClockAnchor + (Date.now() - demoClockBootReal));
}
const OFFSET_MINUTES = 480; // Asia/Manila is permanently UTC+08:00.

export const CYCLE_STATE = Object.freeze({
  COUNTDOWN: 'COUNTDOWN',
  VIP_ANNOUNCEMENT: 'VIP_ANNOUNCEMENT',
});

// The three-phase cycle named in the spec. COUNTDOWN and VIP_ANNOUNCEMENT are
// machine states; NEXT_SUNDAY_COUNTDOWN is the COUNTDOWN phase that follows a
// finished announcement, reported separately so a projector can tell them apart.
export const CYCLE_PHASE = Object.freeze({
  COUNTDOWN: 'COUNTDOWN',
  VIP_ANNOUNCEMENT: 'VIP_ANNOUNCEMENT',
  NEXT_SUNDAY_COUNTDOWN: 'NEXT_SUNDAY_COUNTDOWN',
});

export const DEFAULT_CONFIG = Object.freeze({
  start_hour: 13,
  start_minute: 0,
  end_hour: 15,
  end_minute: 0,
  announce_minutes: 120,
});

let intlFormatter = null;
let intlUsable = true;

function manilaFormatter() {
  if (intlFormatter || !intlUsable) return intlFormatter;
  try {
    intlFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    intlUsable = false;
    intlFormatter = null;
  }
  return intlFormatter;
}

// Wall-clock parts in Asia/Manila for an instant.
export function manilaParts(instant = new Date()) {
  const at = instant instanceof Date ? instant : new Date(instant);
  const fmt = manilaFormatter();
  if (fmt) {
    const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
    return {
      year: Number(p.year), month: Number(p.month), day: Number(p.day),
      hour: Number(p.hour === '24' ? 0 : p.hour), minute: Number(p.minute), second: Number(p.second),
    };
  }
  const shifted = new Date(at.getTime() + OFFSET_MINUTES * 60000);
  return {
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), second: shifted.getUTCSeconds(),
  };
}

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' as read on a wall clock in Manila.
export function manilaDateKey(instant = new Date()) {
  const p = manilaParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// Minutes since Manila midnight.
export function manilaMinutesOfDay(instant = new Date()) {
  const p = manilaParts(instant);
  return p.hour * 60 + p.minute;
}

export function isSundayKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return false;
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay() === 0;
}

function shiftDays(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 0 when dateKey is already a Sunday, otherwise the days forward to the next one.
export function daysToNextSunday(dateKey) {
  return (7 - new Date(`${dateKey}T12:00:00Z`).getUTCDay()) % 7;
}

export function nextSundayKey(dateKey) {
  const offset = daysToNextSunday(dateKey);
  return shiftDays(dateKey, offset === 0 ? 7 : offset);
}

export function previousSundayKey(dateKey) {
  return shiftDays(dateKey, -((new Date(`${dateKey}T12:00:00Z`).getUTCDay() || 7)));
}

export function normalizeConfig(input = {}) {
  const src = input || {};
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
  };
  const announce = num(src.announce_minutes, DEFAULT_CONFIG.announce_minutes, 1, 600);
  const start_hour = num(src.start_hour, DEFAULT_CONFIG.start_hour, 0, 23);
  const start_minute = num(src.start_minute, DEFAULT_CONFIG.start_minute, 0, 59);
  const end_hour = num(src.end_hour, DEFAULT_CONFIG.end_hour, 0, 23);
  const end_minute = num(src.end_minute, DEFAULT_CONFIG.end_minute, 0, 59);
  return { start_hour, start_minute, end_hour, end_minute, announce_minutes: announce };
}

// The UTC instant of a given hour:minute on a Manila calendar date.
export function manilaInstantOn(dateKey, hour, minute = 0) {
  return new Date(`${dateKey}T${pad(hour)}:${pad(minute)}:00+08:00`);
}

export function serviceStartInstant(dateKey, config = DEFAULT_CONFIG) {
  const cfg = normalizeConfig(config);
  return manilaInstantOn(dateKey, cfg.start_hour, cfg.start_minute);
}

export function serviceEndInstant(dateKey, config = DEFAULT_CONFIG) {
  const cfg = normalizeConfig(config);
  return manilaInstantOn(dateKey, cfg.end_hour, cfg.end_minute);
}

// Which Sunday service a registration made at `instant` belongs to.
//
//   * registered ON a Sunday  -> that Sunday
//   * registered any other day -> the coming Sunday
//
// database/007_vip_service_date.sql applies the identical rule when backfilling,
// so historical rows and new rows are attributed the same way.
export function attributeServiceDate(instant = new Date()) {
  const key = manilaDateKey(instant);
  const offset = daysToNextSunday(key);
  return offset === 0 ? key : shiftDays(key, offset);
}

// Next Sunday service start strictly in the future. While a service is running
// this is next week's, which is what the hero countdown displays.
export function nextServiceStart(instant = new Date(), config = DEFAULT_CONFIG) {
  const cfg = normalizeConfig(config);
  const key = manilaDateKey(instant);
  // Only an actual Sunday can host today's service. Any other day targets the
  // coming Sunday, even if the clock has not yet passed 1:00 PM.
  if (isSundayKey(key) && instant < serviceStartInstant(key, cfg)) return serviceStartInstant(key, cfg);
  return serviceStartInstant(nextSundayKey(key), cfg);
}

// 'Sunday, October 18, 2026' — rendered in Asia/Manila so the server and every
// projector agree regardless of the host's own timezone.
export function describeServiceDate(dateKey, { weekday = true, year = true } = {}) {
  if (!isSundayKey(dateKey)) return '';
  const at = new Date(`${dateKey}T12:00:00Z`);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      ...(weekday ? { weekday: 'long' } : {}),
      month: 'long', day: 'numeric',
      ...(year ? { year: 'numeric' } : {}),
    }).format(at);
  } catch {
    return dateKey;
  }
}

// Short form for the compact count badge: 'Oct 18'.
export function shortServiceDate(dateKey) {
  if (!isSundayKey(dateKey)) return '';
  const at = new Date(`${dateKey}T12:00:00Z`);
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(at);
  } catch {
    return dateKey;
  }
}

function parseInstant(value) {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at;
}

// Resolve the cycle for an instant. Pure and deterministic: the same inputs
// always give the same state, so a projector refresh lands on the same phase and
// never restarts a cycle.
//
//   announce_start        persisted ISO instant the window opened (or null)
//   announce_service_date persisted Sunday that instant belongs to (or null)
export function resolveCycle(input = {}) {
  const now = parseInstant(input.now) || new Date();
  const config = normalizeConfig(input.config);
  const todayKey = manilaDateKey(now);

  const isSunday = isSundayKey(todayKey);
  const todayStart = serviceStartInstant(todayKey, config);
  const todayEnd = serviceEndInstant(todayKey, config);
  const durationMs = config.announce_minutes * 60000;
  const todayClose = new Date(todayStart.getTime() + durationMs);

  // The Sunday the countdown targets — always the next service start still in
  // the future. Only an actual Sunday can host today's service, so a weekday
  // afternoon targets the coming Sunday rather than a phantom 1:00 PM today.
  const countdownStart = (isSunday && now < todayStart)
    ? todayStart
    : serviceStartInstant(nextSundayKey(todayKey), config);
  const countdownKey = manilaDateKey(countdownStart);

  // Is the announcement window for TODAY open on the clock? A weekday that
  // happens to fall inside 1:00–1:30 PM must never open the board.
  const clockWindowOpen = isSunday && now >= todayStart && now <= todayClose;

  const persistedStart = parseInstant(input.announce_start);
  const persistedForToday = Boolean(
    persistedStart && isSundayKey(input.announce_service_date)
    && input.announce_service_date === todayKey
    && now >= persistedStart && now < new Date(persistedStart.getTime() + durationMs),
  );

  const state = (persistedForToday || clockWindowOpen)
    ? CYCLE_STATE.VIP_ANNOUNCEMENT
    : CYCLE_STATE.COUNTDOWN;

  const announceKey = state === CYCLE_STATE.VIP_ANNOUNCEMENT ? todayKey : countdownKey;

  // The instant the window opened: the persisted one when it is valid for today,
  // otherwise the deterministic clock-derived service start.
  const windowOpensAt = state === CYCLE_STATE.VIP_ANNOUNCEMENT
    ? (persistedForToday ? persistedStart : todayStart)
    : null;
  const windowClosesAt = windowOpensAt ? new Date(windowOpensAt.getTime() + durationMs) : null;

  // NEXT_SUNDAY_COUNTDOWN is the countdown that follows a finished announcement:
  // today is Sunday, the announcement window has closed, and the countdown now
  // targets next week. Any other day is a plain COUNTDOWN.
  const announcementFinishedToday = isSundayKey(todayKey) && now > todayClose;
  const phase = state === CYCLE_STATE.VIP_ANNOUNCEMENT
    ? CYCLE_PHASE.VIP_ANNOUNCEMENT
    : (announcementFinishedToday ? CYCLE_PHASE.NEXT_SUNDAY_COUNTDOWN : CYCLE_PHASE.COUNTDOWN);

  const serviceDate = announceKey;

  return {
    state,
    phase,
    timezone: TIME_ZONE,
    now_iso: now.toISOString(),
    config,
    // What the countdown displays.
    countdown_service_date: countdownKey,
    countdown_service_date_display: describeServiceDate(countdownKey),
    // No-year form, matching the hero countdown's original "Sunday, October 18".
    countdown_service_date_label: describeServiceDate(countdownKey, { year: false }),
    countdown_target_iso: countdownStart.toISOString(),
    seconds_until_countdown: Math.max(0, Math.round((countdownStart - now) / 1000)),
    // What the announcement displays.
    announce_service_date: announceKey,
    announce_service_date_display: describeServiceDate(announceKey),
    announce_short_date: shortServiceDate(announceKey),
    // The date to show for the current state.
    service_date: serviceDate,
    service_date_display: describeServiceDate(serviceDate),
    service_date_short: shortServiceDate(serviceDate),
    service_started_iso: serviceStartInstant(announceKey, config).toISOString(),
    service_ends_iso: serviceEndInstant(announceKey, config).toISOString(),
    // True only between the configured start and end on an actual Sunday. This is
    // independent of the announcement window: the service is still in session at
    // 2:45 PM even after the welcome board has handed back to the countdown.
    service_is_live: isSundayKey(todayKey) && now >= todayStart && now < todayEnd,
    window: {
      opens_at: windowOpensAt ? windowOpensAt.toISOString() : null,
      closes_at: windowClosesAt ? windowClosesAt.toISOString() : null,
      seconds_remaining: windowClosesAt ? Math.max(0, Math.round((windowClosesAt - now) / 1000)) : null,
      // 'persisted' = read back from settings, 'derived' = computed from the
      // clock and worth persisting so every screen shares one start instant.
      source: state === CYCLE_STATE.VIP_ANNOUNCEMENT ? (persistedForToday ? 'persisted' : 'derived') : 'none',
    },
  };
}

// Rows to write back to settings when a derived window opens, so all projectors
// and every later refresh share the same window start.
export function cycleSettingsToPersist(cycle) {
  if (!cycle || cycle.window.source !== 'derived') return null;
  return {
    vip_announce_start: cycle.window.opens_at,
    vip_announce_service_date: cycle.announce_service_date,
  };
}

// Read the cycle config + persisted window out of settings rows.
export function cycleFromSettings(rows = [], now = new Date()) {
  const values = {};
  for (const row of rows) values[row.key] = row.value;
  const config = normalizeConfig({
    announce_minutes: values.vip_announce_minutes,
    start_hour: values.vip_announce_start_hour,
    start_minute: values.vip_announce_start_minute,
    end_hour: values.vip_announce_end_hour,
    end_minute: values.vip_announce_end_minute,
  });
  return resolveCycle({
    now,
    config,
    announce_start: typeof values.vip_announce_start === 'string' ? values.vip_announce_start : null,
    announce_service_date: typeof values.vip_announce_service_date === 'string' ? values.vip_announce_service_date : null,
  });
}
