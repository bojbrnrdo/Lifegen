/* ============================================================================
   LIFEGEN fullscreen VIP announcement — client
   ----------------------------------------------------------------------------
   Renders the approved design entirely from the live API payload:

     GET /api/public/vip-announcement   names, inviters, total, Sunday date, cycle
     GET /api/public/vip-announcement/stream   PostgreSQL LISTEN/NOTIFY change feed

   Design rules this file follows:
   * The Sunday date, every name, every inviter and the total all come from the
     server. Nothing is hardcoded and no date or number is ever guessed locally.
   * The page is never reloaded or navigated to refresh data, so an active
     fullscreen session survives every update.
   * A database failure is shown as an error state. Placeholder names are never
     substituted for real records.
   ========================================================================== */
(() => {
  'use strict';

  // ?preview=1 renders the announcement layout right now, so the tech team can
  // check a design on the projector before Sunday instead of guessing. It is
  // presentational only: every name, date and count still comes from the live
  // API payload, and the server's own cycle state is never changed.
  const previewMode = new URLSearchParams(location.search).get('preview') === '1';

  const $ = (id) => document.getElementById(id);
  const el = {
    stage: $('stage'),
    phasePill: $('phasePill'),
    connPill: $('connPill'),
    countdownPhase: $('countdownPhase'),
    announcePhase: $('announcePhase'),
    cdHeading: $('cdHeading'),
    cdDate: $('cdDate'),
    countdown: $('countdown'),
    welcome: $('welcomeHeading'),
    svcDate: $('svcDate'),
    svcTime: $('svcTime'),
    countBadge: $('countBadge'),
    countNum: $('countNum'),
    countWord: $('countWord'),
    roster: $('roster'),
    stateBox: $('stateBox'),
    stateTitle: $('stateTitle'),
    stateBody: $('stateBody'),
    updated: $('updated'),
    sourceTag: $('sourceTag'),
    refreshBtn: $('refreshBtn'),
    fsBtn: $('fsBtn'),
    designLayer: $('designLayer'),
    designFrame: $('designFrame'),
    designImg: $('designImg'),
    designOverlay: $('designOverlay'),
    designError: $('designError'),
    designControls: $('designControls'),
    dcRefresh: $('dcRefresh'),
    dcFullscreen: $('dcFullscreen'),
  };

  const POLL_MS = 15000;      // Backstop refresh when the change feed is down.
  const DEBOUNCE_MS = 450;    // Collapse a burst of NOTIFY events into one fetch.
  const NEW_FOR_MS = 20000;   // How long a freshly added VIP is highlighted.

  const state = {
    payload: null,            // Last good payload from the database.
    clockSkew: 0,             // server_time - local clock, in ms.
    seen: new Map(),          // full_name -> first seen timestamp
    inflight: null,
    pollTimer: null,
    debounceTimer: null,
    tickTimer: null,
    stream: null,
    streamFailures: 0,
    lastGoodAt: null,
    booted: false,
  };

  const cdNums = Object.fromEntries(
    Array.from(document.querySelectorAll('#countdown .cd-num')).map((n) => [n.dataset.u, n]),
  );

  // ---- Small helpers --------------------------------------------------------
  const now = () => Date.now() + state.clockSkew;

  const two = (n) => String(Math.max(0, n)).padStart(2, '0');

  // Columns and rows for the roster. A portrait screen is narrower, so it gets fewer columns.
  const portraitQuery = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  function rosterGrid(count) {
    const portrait = Boolean(portraitQuery && portraitQuery.matches);
    const cols = portrait ? (count <= 3 ? 1 : 2) : (count <= 4 ? 1 : count <= 10 ? 2 : 3);
    el.roster.style.setProperty('--roster-cols', String(cols));
    el.roster.style.setProperty('--roster-rows', String(Math.max(1, Math.ceil(count / cols))));
    // A single VIP is centered at a comfortable size instead of filling the whole list area.
    el.roster.dataset.size = count === 1 ? 'one' : 'many';
  }
  if (portraitQuery && portraitQuery.addEventListener) {
    portraitQuery.addEventListener('change', () => rosterGrid(state.payload ? state.payload.vips.length : 6));
  }

  // First letters of the first two words, e.g. "Ana Reyes" -> "AR".
  const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase()).join('') || '?';

  function setNum(key, value) {
    const node = cdNums[key];
    if (!node) return;
    const text = two(value);
    if (node.textContent === text) return;
    node.textContent = text;
    node.classList.remove('tick');
    void node.offsetWidth;
    node.classList.add('tick');
  }

  function setConn(kind, label) {
    el.connPill.dataset.state = kind;
    el.connPill.textContent = label;
  }

  function setStateBox(kind, title, body) {
    if (kind === null) {
      el.stateBox.hidden = true;
      el.stateBox.removeAttribute('data-kind');
      return;
    }
    el.stateBox.hidden = false;
    el.stateBox.dataset.kind = kind;
    el.stateTitle.textContent = title;
    el.stateBody.textContent = body;
  }

  // ---- Rendering ------------------------------------------------------------
  function showSkeleton(count = 6) {
    el.roster.replaceChildren();
    for (let i = 0; i < count; i += 1) {
      const card = document.createElement('div');
      card.className = 'vip-card skeleton';
      card.setAttribute('aria-hidden', 'true');
      const name = document.createElement('p');
      name.className = 'vip-name';
      name.textContent = 'Loading';
      const inv = document.createElement('p');
      inv.className = 'vip-inviter';
      inv.textContent = 'Loading';
      card.append(name, inv);
      el.roster.append(card);
    }
  }

  function renderRoster(vips) {
    const first = !state.booted;
    const fresh = [];
    const frag = document.createDocumentFragment();
    // Fewer, larger cards for a short list; more columns as the list grows. Rows share
    // the screen height exactly, so every VIP is visible on one page without scrolling.
    rosterGrid(vips.length);

    vips.forEach((vip, index) => {
      const key = vip.full_name;
      const known = state.seen.has(key);
      if (!known) {
        state.seen.set(key, Date.now());
        if (first === false) fresh.push(key);
      }

      const card = document.createElement('div');
      card.className = 'vip-card';
      card.setAttribute('role', 'listitem');
      card.style.animationDelay = `${Math.min(index, 24) * 28}ms`;
      if (!known && !first) card.classList.add('is-new');

      const avatar = document.createElement('span');
      avatar.className = 'vip-avatar';
      avatar.dataset.tone = String(index % 3);
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = initials(vip.full_name);

      const name = document.createElement('p');
      name.className = 'vip-name';
      name.textContent = vip.full_name;

      const inviter = document.createElement('p');
      inviter.className = 'vip-inviter';
      const lead = document.createElement('span');
      lead.textContent = 'Invited by';
      const who = document.createElement('b');
      who.textContent = vip.inviter;
      inviter.append(lead, document.createTextNode(' '), who);

      card.append(avatar, name, inviter);

      if (!known && !first) {
        const tag = document.createElement('span');
        tag.className = 'vip-new-tag';
        tag.textContent = 'New';
        card.append(tag);
      }
      frag.append(card);
    });

    // Drop names that left the payload so the board never shows stale records.
    const live = new Set(vips.map((v) => v.full_name));
    for (const key of state.seen.keys()) if (!live.has(key)) state.seen.delete(key);

    el.roster.replaceChildren(frag);

    fresh.forEach((key) => {
      window.setTimeout(() => {
        const cards = el.roster.querySelectorAll('.vip-card.is-new');
        cards.forEach((card) => {
          if (card.querySelector('.vip-name')?.textContent === key) {
            card.classList.remove('is-new');
            card.querySelector('.vip-new-tag')?.remove();
          }
        });
      }, NEW_FOR_MS);
    });
  }

  // The count wording is identical on the branded board and on the design overlay.
  function countParts(total) {
    return { num: two(total), word: total === 1 ? 'VIP TODAY' : 'VIPs TODAY' };
  }

  function renderCount(total, previous) {
    const changed = previous !== total;
    const parts = countParts(total);
    el.countNum.textContent = parts.num;
    el.countWord.textContent = parts.word;
    if (changed && state.booted) {
      el.countBadge.classList.remove('bump');
      void el.countBadge.offsetWidth;
      el.countBadge.classList.add('bump');
    }
  }

  // ---- Selected design ------------------------------------------------------
  // The design comes from the database, keyed on the Sunday, so it never changes
  // on a refresh. It only covers the screen while the announcement is active.
  function renderDesign(payload) {
    const design = payload.design;
    const announcing = previewMode || payload.state === 'VIP_ANNOUNCEMENT';
    if (!announcing || !design) {
      el.stage.classList.remove('has-design');
      el.designLayer.hidden = true;
      el.designControls.hidden = true;
      return;
    }
    el.stage.classList.add('has-design');
    el.designLayer.hidden = false;
    el.designControls.hidden = false;
    el.designLayer.classList.toggle('is-template', design.display_mode === 'template');
    el.designError.hidden = true;

    // Swap the image only when the selection actually changed, so a background
    // refresh never re-downloads or flashes the artwork.
    if (el.designImg.dataset.src !== design.url) {
      el.designImg.dataset.src = design.url;
      el.designImg.alt = design.title ? `${design.title} — LIFEGEN VIP announcement design` : '';
      el.designImg.onload = () => {
        // The frame takes the artwork's own proportions, so the overlay lines up with it.
        const w = el.designImg.naturalWidth, h = el.designImg.naturalHeight;
        if (w && h) el.designFrame.style.setProperty('--ar', String(w / h));
      };
      el.designImg.onerror = () => {
        // Fall back to the branded layout rather than showing a broken frame.
        el.designError.hidden = false;
        el.stage.classList.remove('has-design');
        el.designLayer.hidden = true;
      };
      el.designImg.src = design.url;
    }

    if (design.display_mode === 'template') buildOverlay(payload, design);
    else el.designOverlay.hidden = true;
  }

  // Template mode: live VIP data placed in the administrator's configured area.
  function buildOverlay(payload, design) {
    const l = design.layout || {};
    const area = l.area || {};
    const t = l.title || {};
    const d = l.date || {};
    const c = l.count || {};
    const n = l.names || {};

    el.designOverlay.style.setProperty('--o-top', `${area.top ?? 16}%`);
    el.designOverlay.style.setProperty('--o-left', `${area.left ?? 7}%`);
    el.designOverlay.style.setProperty('--o-width', `${area.width ?? 86}%`);
    el.designOverlay.style.setProperty('--o-height', `${area.height ?? 62}%`);
    el.designOverlay.style.setProperty('--o-align', l.align || 'left');
    el.designOverlay.style.setProperty('--o-align-items', l.align === 'center' ? 'center' : l.align === 'right' ? 'flex-end' : 'flex-start');
    el.designOverlay.style.setProperty('--cols', String(l.columns || 2));
    el.designOverlay.style.setProperty('--t-size', t.size ?? 5.2);
    el.designOverlay.style.setProperty('--t-color', t.color || '#F6F1E6');
    el.designOverlay.style.setProperty('--d-size', d.size ?? 2.2);
    el.designOverlay.style.setProperty('--d-color', d.color || '#D9B44A');
    el.designOverlay.style.setProperty('--c-size', c.size ?? 2.6);
    el.designOverlay.style.setProperty('--c-color', c.color || '#D4AF37');
    el.designOverlay.style.setProperty('--n-size', n.size ?? 1.9);
    el.designOverlay.style.setProperty('--n-color', n.color || '#F6F1E6');
    el.designOverlay.style.setProperty('--i-size', n.inviterSize ?? 1.1);
    el.designOverlay.style.setProperty('--i-color', n.inviterColor || 'rgba(246,241,230,.72)');
    el.designOverlay.style.setProperty('--n-gap', n.gap ?? 1.4);

    const frag = document.createDocumentFragment();

    if (t.show !== false) {
      const h = document.createElement('h2');
      h.className = 'o-title';
      h.textContent = t.text || 'Welcome our VIPs';
      frag.append(h);
    }
    if (d.show !== false) {
      const p = document.createElement('p');
      p.className = 'o-date';
      p.textContent = payload.service_date_display || payload.service_date;
      frag.append(p);
    }
    if (c.show !== false) {
      const parts = countParts(payload.total);
      const p = document.createElement('p');
      p.className = 'o-count';
      const strong = document.createElement('strong');
      strong.textContent = parts.num;
      const span = document.createElement('span');
      span.textContent = parts.word;
      p.append(strong, span);
      frag.append(p);
    }
    if (n.show !== false) {
      const ul = document.createElement('ul');
      ul.className = 'o-names';
      if (!payload.vips.length) {
        const li = document.createElement('li');
        li.className = 'o-empty';
        li.textContent = 'No VIP registrations recorded for this Sunday yet.';
        ul.append(li);
      }
      for (const vip of payload.vips) {
        const li = document.createElement('li');
        const name = document.createElement('p');
        name.className = 'o-name';
        name.textContent = vip.full_name;
        li.append(name);
        if (n.showInviter !== false) {
          const inv = document.createElement('p');
          inv.className = 'o-inviter';
          inv.textContent = `Invited by ${vip.inviter}`;
          li.append(inv);
        }
        ul.append(li);
      }
      frag.append(ul);
    }

    el.designOverlay.replaceChildren(frag);
    el.designOverlay.hidden = false;
  }

  function render(payload) {
    const previousTotal = state.payload ? state.payload.total : null;
    const announcing = previewMode || payload.state === 'VIP_ANNOUNCEMENT';

    el.phasePill.dataset.phase = payload.state;
    el.phasePill.textContent = previewMode
      ? 'Preview — not live yet'
      : announcing ? 'VIP announcement' : payload.phase === 'NEXT_SUNDAY_COUNTDOWN' ? 'Next Sunday' : 'Countdown';

    // Countdown block — always driven by the server's target instant.
    el.cdHeading.textContent = announcing ? 'Service in progress' : 'Next LIFEGEN service';
    el.cdDate.textContent = payload.countdown_service_date_display || payload.countdown_service_date;

    // Announcement block — the Sunday actually being announced.
    el.svcDate.textContent = payload.service_date_display || payload.service_date;
    el.svcTime.textContent = serviceTimeLabel(payload);

    el.countdownPhase.hidden = announcing;
    el.announcePhase.hidden = !announcing;

    renderCount(payload.total, previousTotal);
    renderDesign(payload);

    if (announcing) {
      if (payload.total === 0) {
        renderRoster([]);
        setStateBox(
          'empty',
          'No VIPs registered yet',
          `No first-time VIP registrations are recorded for ${payload.service_date_display || payload.service_date}. This board fills in automatically as soon as someone registers — no refresh or admin step is needed.`,
        );
      } else {
        setStateBox(null);
        renderRoster(payload.vips);
      }
    }

    el.updated.textContent = `Updated ${new Date(payload.generated_at).toLocaleTimeString('en-PH', { hour12: true })}`;
    el.sourceTag.textContent = payload.source === 'database'
      ? `Live from the LIFEGEN database · ${payload.timezone}`
      : 'Live from the LIFEGEN database';

    state.payload = payload;
    state.lastGoodAt = Date.now();
    state.booted = true;
    el.stage.setAttribute('aria-busy', 'false');
    setConn('live', 'Live');
  }

  function serviceTimeLabel(payload) {
    const cfg = payload.config || {};
    const fmt = (h, m) => {
      const hour12 = ((h + 11) % 12) + 1;
      const suffix = h < 12 ? 'AM' : 'PM';
      return `${hour12}:${two(m)} ${suffix}`;
    };
    const start = fmt(cfg.start_hour ?? 13, cfg.start_minute ?? 0);
    const end = fmt(cfg.end_hour ?? 15, cfg.end_minute ?? 0);
    return `${start} – ${end}`;
  }

  // ---- Countdown ticking ----------------------------------------------------
  function tick() {
    const payload = state.payload;
    if (!payload) return;
    const target = new Date(payload.countdown_target_iso).getTime();
    if (!Number.isFinite(target)) return;
    const diff = Math.max(0, target - now());
    const seconds = Math.floor(diff / 1000);
    setNum('d', Math.floor(seconds / 86400));
    setNum('h', Math.floor((seconds % 86400) / 3600));
    setNum('m', Math.floor((seconds % 3600) / 60));
    setNum('s', seconds % 60);

    // When the server's target has passed, re-ask rather than trusting a local
    // rollover — the server owns the cycle state machine.
    if (diff <= 0) load({ reason: 'countdown-elapsed' });
  }

  // ---- Data loading ---------------------------------------------------------
  async function load({ reason = 'manual' } = {}) {
    if (state.inflight) return state.inflight;
    const run = (async () => {
      try {
        const res = await fetch('/api/public/vip-announcement', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) {
          let message = `The server answered ${res.status}.`;
          try {
            const body = await res.json();
            if (body && body.message) message = body.message;
          } catch { /* keep the status message */ }
          throw new Error(message);
        }
        const payload = await res.json();
        const serverAt = Date.parse(payload.server_time || payload.generated_at);
        if (Number.isFinite(serverAt)) state.clockSkew = serverAt - Date.now();
        render(payload);
      } catch (error) {
        fail(error, reason);
      } finally {
        state.inflight = null;
      }
    })();
    state.inflight = run;
    return run;
  }

  function fail(error, reason) {
    // Never invent records. Keep the last real payload on screen and label it.
    if (state.payload) {
      setConn('error', 'Reconnecting');
      const age = Math.round((Date.now() - (state.lastGoodAt || Date.now())) / 1000);
      el.updated.textContent = `Showing data from ${age < 60 ? `${age}s` : `${Math.round(age / 60)} min`} ago`;
      el.sourceTag.textContent = 'Waiting for the database to respond';
      return;
    }
    el.stage.setAttribute('aria-busy', 'false');
    setConn('error', 'Offline');
    el.roster.replaceChildren();
    if (!state.booted) {
      el.announcePhase.hidden = false;
      el.countdownPhase.hidden = true;
      el.svcDate.textContent = '—';
      renderCount(0, 0);
    }
    setStateBox(
      'error',
      'Cannot reach the LIFEGEN database',
      `${error && error.message ? error.message : 'The connection failed.'} The board retries automatically and shows real records as soon as the database responds. Placeholder names are never displayed.`,
    );
  }

  // ---- Live updates ---------------------------------------------------------
  function scheduleLoad(reason) {
    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(() => load({ reason }), DEBOUNCE_MS);
  }

  function connectStream() {
    if (typeof window.EventSource !== 'function') return;
    try {
      state.stream?.close();
      const stream = new EventSource('/api/public/vip-announcement/stream');
      state.stream = stream;
      stream.addEventListener('open', () => {
        state.streamFailures = 0;
        setConn('live', 'Live');
      });
      stream.addEventListener('sync', () => scheduleLoad('stream-sync'));
      stream.addEventListener('change', () => scheduleLoad('stream-change'));
      stream.addEventListener('reconnect', () => scheduleLoad('stream-reconnect'));
      stream.addEventListener('error', () => {
        state.streamFailures += 1;
        // EventSource reconnects on its own; the poll remains the real backstop.
        if (state.streamFailures > 2) setConn('stale', 'Polling');
      });
    } catch {
      setConn('stale', 'Polling');
    }
  }

  function startPolling() {
    window.clearInterval(state.pollTimer);
    state.pollTimer = window.setInterval(() => load({ reason: 'poll' }), POLL_MS);
  }

  // ---- Fullscreen -----------------------------------------------------------
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.stage.requestFullscreen();
    } catch {
      // Some projector browsers deny the request; the board still works inline.
      el.fsBtn.textContent = 'Fullscreen blocked';
      window.setTimeout(() => { el.fsBtn.textContent = 'Fullscreen'; }, 2500);
    }
  }

  function syncFullscreenLabel() {
    const label = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    el.fsBtn.textContent = label;
    el.dcFullscreen.textContent = label;
  }

  // ---- Idle chrome ----------------------------------------------------------
  let idleTimer = null;
  function wake() {
    el.stage.classList.remove('idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => el.stage.classList.add('idle'), 6000);
  }

  // ---- Boot -----------------------------------------------------------------
  function boot() {
    showSkeleton();
    el.stage.setAttribute('aria-busy', 'true');
    setConn('connecting', 'Connecting…');
    el.refreshBtn.addEventListener('click', () => load({ reason: 'manual' }));
    el.fsBtn.addEventListener('click', toggleFullscreen);
    // Same controls, shown over the artwork when a design owns the screen.
    el.dcRefresh.addEventListener('click', () => load({ reason: 'manual' }));
    el.dcFullscreen.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', syncFullscreenLabel);
    ['pointermove', 'pointerdown', 'keydown'].forEach((evt) => window.addEventListener(evt, wake, { passive: true }));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'f' || event.key === 'F') toggleFullscreen();
      if (event.key === 'r' || event.key === 'R') load({ reason: 'manual' });
    });
    // A projector that was asleep must re-sync the moment it wakes.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) load({ reason: 'visible' });
    });

    wake();
    syncFullscreenLabel();
    load({ reason: 'boot' });
    startPolling();
    connectStream();
    state.tickTimer = window.setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
