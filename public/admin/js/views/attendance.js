// Service Attendance — the Sunday register, in the Admin portal.
//
// Faithful to the "Service Attendance" page the church drafted, rebuilt on the
// portal's own design system and on the portal's own data:
//
//   Sunday picker      previous / next Sunday, date picker, Today
//   roll call          Members · VIP first timers · VIP returning · headcount
//   headcount          people in the room who were never checked in by name
//   list               search, All / Members / VIPs / Not yet in, one tap to mark
//   follow-up          every VIP still building towards 4 Sundays, and who is
//                      ready to become a Member and receive a token
//   attendance history the four Sundays of a VIP, per person
//   report             the month per Sunday, copyable, printable
//   add / check in     walk-in by name: existing person, or a new VIP
//
// Where the data comes from: a VIP's presence is the validated VIP check-in that
// the VIP portal, the prize streak and the Gift Tracker already read; a member's
// presence is a service_attendance row. Marking a VIP here writes the check-in.
// See src/service-attendance.js for the rules.

import { api } from '../api.js';
import { state, can } from '../app.js';
import { html, raw, icon, fmtDate, fmtDateTime, toast, withLoading, openModal, closeModal, debounce, esc, emptyState } from '../ui.js';

const STATUS_ORDER = ['first', 'second', 'third', 'fourth'];
const STAGE_LABELS = { first: '1st Sunday', second: '2nd Sunday', third: '3rd Sunday', fourth: '4th Sunday' };
const GIFT_SUNDAYS = 4;

/** Manila "today", so the page agrees with the server's service date. */
function manilaToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
/** The Sunday of a date key, or the nearest previous one. */
function sundayOf(dateKey) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function shiftSunday(dateKey, weeks) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
/**
 * What the numbers mean. Kept in one place because the hero, the list summary
 * and the copied report must never disagree: a person counted as a Member today
 * is not also counted as a VIP, and the headcount is always people who are not
 * in the list.
 */
function stats(data) {
  const marked = data.items.filter((i) => i.present);
  const members = marked.filter((i) => i.category === 'member').length;
  const vipFirst = marked.filter((i) => i.category === 'vip' && i.first_timer).length;
  const vipReturning = marked.filter((i) => i.category === 'vip' && !i.first_timer).length;
  const headcount = Number(data.headcount) || 0;
  return {
    members, vipFirst, vipReturning, headcount,
    vips: vipFirst + vipReturning,
    total: members + vipFirst + vipReturning + headcount,
    notYetIn: data.items.filter((i) => !i.present).length,
    roster: data.items.length,
  };
}

/** One conic-gradient ring, in the same four colours as the legend. */
function ringSvg(s) {
  const total = s.members + s.vipFirst + s.vipReturning + s.headcount;
  const parts = [[s.members, 'var(--green-600)'], [s.vipFirst, 'var(--amber-600)'], [s.vipReturning, 'var(--blue-600)'], [s.headcount, 'var(--ink-300)']];
  if (!total) return '<div class="sa-ring__empty" aria-hidden="true"></div>';
  let at = 0;
  const stops = parts.filter(([, ]) => true).map(([n, color]) => {
    if (!n) return '';
    const from = (at / total) * 100, to = ((at + n) / total) * 100;
    at += n;
    return `${color} ${from.toFixed(2)}% ${to.toFixed(2)}%`;
  }).filter(Boolean);
  return `<div class="sa-ring__ring" style="background:conic-gradient(${stops.join(',')})" aria-hidden="true"></div>`;
}

/** "2026-11" -> "November 2026", without borrowing a timezone. */
function monthLabel(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return String(month || '');
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

/**
 * "Ready for a token" — the church's own rule: four Sundays in a row inside the
 * month, with a Sunday that already happened and was missed resetting the run.
 * The remaining Sundays of the month are the target, so 4 is reachable in a
 * short month too.
 */
function giftProgress(item, ctx) {
  const attended = new Set(ctx.attendedByPerson.get(item.person_id) || []);
  const past = ctx.sundays.filter((d) => d <= ctx.today);
  let run = 0;
  let best = 0;
  for (const d of past) {
    if (attended.has(d)) { run += 1; if (run > best) best = run; }
    else if (d !== ctx.today) run = 0;
  }
  const target = Math.min(GIFT_SUNDAYS, ctx.sundays.length) || GIFT_SUNDAYS;
  const inRun = Math.min(run, target);
  return {
    target,
    thisMonth: past.filter((d) => attended.has(d)).length,
    run: inRun,
    best: Math.min(best, target),
    ready: best >= target,
    remaining: Math.max(0, target - inRun),
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export async function renderServiceAttendance({ main, query }) {
  if (!can('people:view')) {
    main.innerHTML = html`<div class="page-header"><div><h1>Service Attendance</h1></div></div>
      ${emptyState({ icon: 'lock', title: 'Attendance is for staff', text: 'Your role can open People but not the attendance register. Ask an administrator for Attendance Staff access.' })}`;
    return;
  }
  const writable = () => can('registrations:manage');
  const today = state.serverToday || manilaToday();

  const view = {
    date: sundayOf(query.date || today),
    tab: ['all', 'member', 'vip', 'absent'].includes(query.tab) ? query.tab : 'all',
    q: '',
    register: null,
    report: null,
    unrecorded: [],
    progress: null,
    loading: true,
    savingHeadcount: false,
  };
  if (view.date > today) view.date = sundayOf(today);

  main.innerHTML = html`
    <div class="page-header">
      <div><h1>Service Attendance</h1><p class="sub">The Sunday roll call — members, VIPs and the headcount that never checked in.</p></div>
      <div class="page-actions">
        <button class="btn" id="saPrint" title="Print this Sunday">${icon('print')} Print</button>
        <button class="btn" id="saRefresh" title="Reload">${icon('undo')} Refresh</button>
        ${writable() ? html`<button class="btn btn--primary" id="saAdd">${icon('plus')} Check in someone</button>` : ''}
      </div>
    </div>

    <section class="sa-datebar" aria-label="Choose the Sunday service">
      <button class="sa-datebar__step" id="saPrev" type="button" aria-label="Previous Sunday">${icon('chevL', 18)}</button>
      <label class="sa-datebar__pick">
        ${icon('calendar', 17)}
        <span class="sa-datebar__label" id="saDateLabel">Loading…</span>
        <input type="date" id="saDateInput" max="${today}" aria-label="Sunday service date" />
      </label>
      <button class="sa-datebar__step" id="saNext" type="button" aria-label="Next Sunday">${icon('chevR', 18)}</button>
      <button class="btn btn--sm" id="saToday" type="button">Today</button>
      <span class="sa-datebar__state" id="saDateState" aria-live="polite"></span>
    </section>

    <div class="grid grid--2 sa-top">
      <section class="card sa-hero" id="saHero" aria-label="Sunday totals"><div class="card__body"><div class="loading">Loading the Sunday…</div></div></section>

      <section class="card sa-side">
        <div class="card__header"><div><h2>Headcount</h2><p class="hint">People in the room who were never checked in by name.</p></div></div>
        <div class="card__body">
          <div class="sa-headcount">
            <button class="sa-headcount__step" id="saHcMinus" type="button" aria-label="Fewer by one">−</button>
            <input id="saHcInput" type="number" min="0" max="100000" step="1" inputmode="numeric" value="0" aria-label="Headcount not checked in" />
            <button class="sa-headcount__step" id="saHcPlus" type="button" aria-label="More by one">+</button>
            ${writable() ? html`<button class="btn btn--sm" id="saHcSave" type="button">Save</button>` : ''}
          </div>
          <p class="small muted mt-1">Total = checked in + headcount. Saved for this Sunday, so the month report keeps its history.</p>
          <div class="sa-unrecorded" id="saUnrecorded" aria-live="polite"></div>
        </div>
      </section>
    </div>

    <section class="card sa-list-card">
      <div class="card__header">
        <div><h2>Roll call</h2><p class="hint" id="saListHint">Loading…</p></div>
        <div class="segmented" id="saTabs" role="group" aria-label="Filter the roll call">
          <button data-sa-tab="all" class="${view.tab === 'all' ? 'active' : ''}">All</button>
          <button data-sa-tab="member" class="${view.tab === 'member' ? 'active' : ''}">Members</button>
          <button data-sa-tab="vip" class="${view.tab === 'vip' ? 'active' : ''}">VIPs</button>
          <button data-sa-tab="absent" class="${view.tab === 'absent' ? 'active' : ''}">Not yet in</button>
        </div>
      </div>
      <div class="card__body">
        <div class="toolbar sa-toolbar">
          <label class="gsearch grow" aria-label="Search the roll call">${icon('search', 17)}<input type="search" id="saSearch" placeholder="Search a name…" autocomplete="off" /></label>
          ${writable() ? html`<button class="btn btn--sm" id="saMarkAll" type="button">Mark everyone listed in</button>` : html`<span class="small muted">Read-only: your role can see attendance but not record it.</span>`}
        </div>
        <div id="saList" class="sa-list"><div class="loading">Loading the roll call…</div></div>
      </div>
    </section>

    <section class="card sa-followup" id="saFollowup" aria-label="VIP follow-up">
      <div class="card__header"><div><h2>VIP follow-up</h2><p class="hint">First timers building towards their fourth Sunday, and who is ready for a token.</p></div></div>
      <div class="card__body" id="saFollowupBody"><div class="loading">Loading…</div></div>
    </section>

    <section class="card sa-report" id="saReport" aria-label="Monthly attendance report">
      <div class="card__header">
        <div><h2>Month report</h2><p class="hint" id="saReportHint">Every Sunday of the month, with its totals.</p></div>
        <div class="row">
          <button class="btn btn--sm" id="saReportCopy" type="button">${icon('copy')} Copy report</button>
        </div>
      </div>
      <div class="card__body" id="saReportBody"><div class="loading">Loading the month…</div></div>
    </section>`;

  /** The context the gift counter needs, safe before the profiles have loaded. */
  const progressContext = (data) => view.progress
    || { sundays: data?.sundays || [], today: data?.today || today, attendedByPerson: new Map() };

  const $ = (sel) => main.querySelector(sel);
  const dateInput = $('#saDateInput');
  const hcInput = $('#saHcInput');
  const searchInput = $('#saSearch');

  // ---- data --------------------------------------------------------------
  async function loadRegister({ keepHeadcount = false } = {}) {
    const data = await api.serviceAttendance(view.date);
    // A Sunday in the future cannot have happened yet: keep the newest real one.
    if (data.date && data.date !== view.date) view.date = data.date;
    view.register = data;
    if (!keepHeadcount) hcInput.value = String(data.headcount ?? 0);
    dateInput.max = data.today || today;
    dateInput.value = data.date;
    $('#saDateLabel').textContent = fmtDate(data.date, { weekday: true });
    const isToday = data.date === data.today;
    $('#saToday').hidden = isToday;
    $('#saNext').disabled = data.date >= (data.today || today);
    $('#saDateState').textContent = data.is_future ? 'This Sunday has not happened yet.'
      : isToday ? 'Today’s service' : '';
    loadProgress();
    await Promise.all([loadReport(data.month), loadUnrecorded()]);
    render();
  }

  /**
   * The Sundays of the month each person attended. The register already carries
   * them (`month_attendance`), so this is a map, not a request per person.
   * `view.progress` is the only context the gift counter needs, so the hero, the
   * follow-up list and the history sheet cannot disagree.
   */
  function loadProgress() {
    const data = view.register;
    const attended = new Map();
    for (const [personId, dates] of Object.entries(data?.month_attendance || {})) {
      attended.set(Number(personId), dates);
    }
    view.progress = { sundays: data?.sundays || [], today: data?.today || today, attendedByPerson: attended };
  }

  async function loadReport(month) {
    try { view.report = await api.serviceAttendanceReport(month); }
    catch (err) { view.report = null; $('#saReportBody').innerHTML = html`<p class="small muted">${err.message}</p>`; }
  }

  async function loadUnrecorded() {
    try { view.unrecorded = (await api.serviceAttendanceUnrecorded(8)).items || []; }
    catch { view.unrecorded = []; }
  }

  // ---- render ------------------------------------------------------------
  function render() {
    const data = view.register;
    if (!data) return;
    renderHero(data);
    renderUnrecorded();
    renderList(data);
    renderFollowup(data);
    renderReport();
  }

  function renderHero(data) {
    const s = stats(data);
    const pct = (n) => (s.total ? Math.round((n / s.total) * 1000) / 10 : 0);
    const ring = ringSvg({ members: s.members, vipFirst: s.vipFirst, vipReturning: s.vipReturning, headcount: s.headcount });
    $('#saHero').innerHTML = html`
      <div class="card__body sa-hero__body">
        <div class="sa-ring">
          ${raw(ring)}
          <div class="sa-ring__center"><b>${s.total}</b><span>Total</span></div>
        </div>
        <div class="sa-hero__info">
          <div class="kpi-row sa-kpis">
            <div class="kpi kpi--green"><b>${s.members}</b><span>Members</span></div>
            <div class="kpi kpi--amber"><b>${s.vipFirst}</b><span>VIP first timers</span></div>
            <div class="kpi kpi--blue"><b>${s.vipReturning}</b><span>VIP returning</span></div>
            <div class="kpi"><b>${s.headcount}</b><span>Headcount</span></div>
          </div>
          <ul class="sa-legend">
            <li><i style="background:var(--green-600)"></i>Members <b>${s.members}</b><span>${pct(s.members)}%</span></li>
            <li><i style="background:var(--amber-600)"></i>VIPs · first timers <b>${s.vipFirst}</b><span>${pct(s.vipFirst)}%</span></li>
            <li><i style="background:var(--blue-600)"></i>VIPs · returning <b>${s.vipReturning}</b><span>${pct(s.vipReturning)}%</span></li>
            <li><i style="background:var(--ink-300)"></i>Headcount <b>${s.headcount}</b><span>${pct(s.headcount)}%</span></li>
          </ul>
          <p class="small muted">${s.notYetIn} of ${s.roster} people on the roll call are not marked in yet.</p>
        </div>
      </div>`;
  }

  function renderUnrecorded() {
    const box = $('#saUnrecorded');
    if (!view.unrecorded.length) { box.innerHTML = ''; return; }
    const missed = view.unrecorded.filter((d) => !d.recorded && !d.future && !d.today);
    box.innerHTML = missed.length
      ? html`<p class="sa-warn">${icon('warn', 15)} ${missed.length} recent ${missed.length === 1 ? 'Sunday has' : 'Sundays have'} no attendance at all: ${missed.map((d) => fmtDate(d.date, { short: true })).join(', ')}.</p>`
      : html`<p class="sa-ok">${icon('check', 15)} Every recent Sunday has some attendance recorded.</p>`;
  }

  function filtered(data) {
    const q = view.q.trim().toLowerCase();
    return data.items.filter((i) => {
      if (q && !i.full_name.toLowerCase().includes(q) && !(i.person_code || '').toLowerCase().includes(q)) return false;
      if (view.tab === 'absent') return !i.present;
      if (view.tab === 'member') return i.category === 'member';
      if (view.tab === 'vip') return i.category === 'vip';
      return true;
    }).sort((a, b) => (Number(b.present) - Number(a.present)) || a.full_name.localeCompare(b.full_name));
  }

  function renderList(data) {
    const rows = filtered(data);
    const list = $('#saList');
    const s = stats(data);
    $('#saListHint').textContent = `${s.total} present (${s.members} members, ${s.vips} VIPs) + ${s.headcount} headcount · ${rows.length} shown`;
    if (!rows.length) {
      list.innerHTML = html`<div class="empty"><h3>Nobody matches</h3><p>Try another name, or switch the filter.</p></div>`;
      return;
    }
    list.innerHTML = html`<div class="sa-rows">${rows.map((i) => row(i, data)).reduce((a, b) => html`${a}${b}`, '')}</div>`;
    list.querySelectorAll('[data-sa-toggle]').forEach((btn) => {
      btn.onclick = (event) => toggle(Number(btn.dataset.saToggle), !btn.classList.contains('is-on'), event.currentTarget);
    });
    list.querySelectorAll('[data-sa-history]').forEach((el) => {
      el.onclick = () => openHistory(Number(el.dataset.saHistory));
    });
    list.querySelectorAll('[data-sa-cat]').forEach((sel) => {
      sel.onchange = (event) => setCategory(Number(sel.dataset.saCat), event.target.value, event.target);
    });
  }

  function row(item, data) {
    const progress = item.category === 'vip' ? giftProgress(item, progressContext(data)) : null;
    const tag = item.category === 'vip'
      ? (item.first_timer ? html`<span class="badge badge--first_timer">First timer</span>` : html`<span class="badge badge--returning">VIP</span>`)
      : html`<span class="badge badge--member">Member</span>`;
    const dots = progress ? html`<span class="sa-dots" title="${progress.thisMonth} of ${progress.target} Sundays this month" aria-label="${progress.thisMonth} of ${progress.target} Sundays this month">${Array.from({ length: progress.target }, (_, n) => html`<i class="${n < Math.min(progress.thisMonth, progress.target) ? 'on' : ''}"></i>`)}</span>` : '';
    const meta = [
      item.lifegroup_name ? html`<span>${item.lifegroup_name}</span>` : (item.category === 'vip' ? html`<span class="sa-nocell">No cell yet</span>` : ''),
      item.status === 'member' || item.status === 'leader' || item.status === 'volunteer' ? html`<span>${item.status.charAt(0).toUpperCase() + item.status.slice(1)}</span>` : '',
      progress ? html`<span>${progress.thisMonth}/${progress.target} this month</span>` : '',
      item.present_source === 'vip_checkin' ? html`<span title="Validated VIP check-in">${icon('check', 13)} VIP check-in</span>` : '',
      item.marked_by_name && item.present_source === 'roster' ? html`<span>by ${item.marked_by_name}</span>` : '',
      data.is_future ? html`<span>Kept to plan the service</span>` : '',
    ].filter(Boolean);
    const disabled = !writable() || data.is_future;
    return html`
      <div class="sa-row ${item.present ? 'is-present' : ''}">
        <span class="sa-row__avatar" aria-hidden="true">${initials(item.full_name)}</span>
        <button class="sa-row__who" type="button" data-sa-history="${item.person_id}" title="Attendance history">
          <strong>${item.full_name}${tag}</strong>
          <small>${meta.length ? meta.map((m, n) => (n ? html` · ${m}` : m)) : html`<span class="muted">No lifegroup</span>`}</small>
        </button>
        ${writable() && item.category === 'vip' && item.present ? html`<select class="sa-row__cat" data-sa-cat="${item.person_id}" aria-label="Roll-call category for ${item.full_name}">
          <option value="record" selected>${`As recorded (${item.stored_category === 'vip' ? 'VIP' : 'Member'})`}</option>
          <option value="member">Count as Member</option>
          <option value="vip">Count as VIP</option>
        </select>` : ''}
        <button class="sa-check ${item.present ? 'is-on' : ''}" type="button" data-sa-toggle="${item.person_id}"
          ${disabled ? 'disabled' : ''} aria-pressed="${item.present ? 'true' : 'false'}"
          aria-label="${item.present ? 'Mark absent' : 'Mark present'}: ${item.full_name}">
          ${icon('check', 20)}
        </button>
      </div>`;
  }

  function renderFollowup(data) {
    const box = $('#saFollowupBody');
    const vips = data.items.filter((i) => i.category === 'vip');
    if (!vips.length) {
      box.innerHTML = html`<p class="small muted">No VIPs on this Sunday’s roll call yet.</p>`;
      return;
    }
    const ctx = progressContext(data);
    const rows = vips.map((i) => ({ item: i, p: giftProgress(i, ctx) }))
      .sort((a, b) => (Number(b.p.ready) - Number(a.p.ready)) || (b.p.best - a.p.best) || a.item.full_name.localeCompare(b.item.full_name));
    const ready = rows.filter((r) => r.p.ready);
    box.innerHTML = html`
      ${ready.length ? html`<div class="sa-ready">
        <div class="row row--between"><div><b>${ready.length} ready for a token</b><div class="small muted">Four Sundays in a row this month. Make them a Member in People, then record the gift in Registration.</div></div>
        ${can('registrations:manage') ? html`<a class="btn btn--sm" href="#/registrations">Open Registration</a>` : ''}</div>
        <div class="sa-ready__names">${ready.map((r) => html`<a href="#/people/${r.item.person_id}">${r.item.full_name}</a>`)}</div>
      </div>` : ''}
      <div class="sa-fu-grid">
        ${rows.map(({ item, p }) => html`
          <div class="sa-fu ${p.ready ? 'is-ready' : ''}">
            <div class="sa-fu__head">
              <div><a href="#/people/${item.person_id}"><b>${item.full_name}</b></a>
                <small>${item.lifegroup_name ? esc(item.lifegroup_name) : 'No cell yet'}${item.present ? ' · in today' : ' · not in yet'}</small></div>
              ${p.ready ? html`<span class="badge badge--present">Completed ${p.target}/${p.target}</span>` : html`<span class="badge">${p.run}/${p.target}</span>`}
            </div>
            <div class="sa-steps" aria-label="${p.run} of ${p.target} Sundays in a row">
              ${STATUS_ORDER.slice(0, p.target).map((s, n) => html`<span class="${n < p.run ? 'on' : ''}" title="${STAGE_LABELS[s]}"></span>`)}
            </div>
            <div class="row row--between">
              <span class="small muted">${p.ready ? 'Ready to become a Member and receive a token.' : `${p.remaining} more in a row for the token`}</span>
              <button class="btn btn--sm" type="button" data-sa-history="${item.person_id}">History</button>
            </div>
          </div>`)}
      </div>`;
    box.querySelectorAll('[data-sa-history]').forEach((b) => { b.onclick = () => openHistory(Number(b.dataset.saHistory)); });
  }

  function renderReport() {
    const report = view.report;
    const body = $('#saReportBody');
    if (!report) return;
    const t = report.totals;
    $('#saReportHint').textContent = `${monthLabel(report.month)} · ${t.services} recorded ${t.services === 1 ? 'Sunday' : 'Sundays'}`;
    body.innerHTML = html`
      <div class="kpi-row mb-2">
        <div class="kpi kpi--green"><b>${t.total}</b><span>Total attendance</span></div>
        <div class="kpi"><b>${t.members}</b><span>Members</span></div>
        <div class="kpi kpi--blue"><b>${t.vips}</b><span>VIPs</span></div>
        <div class="kpi"><b>${t.headcount}</b><span>Headcount</span></div>
        <div class="kpi"><b>${t.average}</b><span>Average per Sunday</span></div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Sunday</th><th class="num">Members</th><th class="num">VIPs</th><th class="num">Headcount</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${report.sundays.map((d) => html`<tr class="${d.today ? 'is-today' : ''}">
          <td>${fmtDate(d.date, { weekday: true })}${d.today ? html` <span class="badge badge--staff">today</span>` : ''}</td>
          <td class="num">${d.members}</td>
          <td class="num">${d.vips}</td>
          <td class="num">${d.headcount}</td>
          <td class="num"><b>${d.total}</b></td>
          <td class="actions">${d.held ? html`<button class="btn btn--sm" type="button" data-sa-open="${d.date}">Open</button>` : html`<span class="small muted">${d.future ? 'upcoming' : 'not recorded'}</span>`}</td>
        </tr>`)}</tbody>
        <tfoot><tr><td>Month total</td><td class="num">${t.members}</td><td class="num">${t.vips}</td><td class="num">${t.headcount}</td><td class="num">${t.total}</td><td></td></tr></tfoot>
      </table></div>
      <p class="small muted mt-1">Totals count only Sundays that have happened. A Sunday with no attendance at all reads 0 — see the warning under Headcount.</p>`;
    body.querySelectorAll('[data-sa-open]').forEach((b) => { b.onclick = () => { view.date = b.dataset.saOpen; searchInput.value = ''; view.q = ''; refresh(); }; });
  }

  // ---- actions -----------------------------------------------------------
  async function refresh() {
    try { await loadRegister(); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function toggle(personId, present, btn) {
    if (!writable()) return;
    try {
      await withLoading(btn, async () => {
        const result = await api.setServiceAttendance(view.date, personId, present);
        view.register = result.register;
        hcInput.value = String(result.register.headcount ?? 0);
        if (result.message) toast(result.message, 'info');
        else toast(present ? 'Marked present.' : 'Marked not in.');
        loadProgress();
        await loadReport(result.register.month);
        render();
      });
    } catch (err) { toast(err.message, 'error'); }
  }

  async function setCategory(personId, category, select) {
    try {
      const result = await api.setServiceAttendanceCategory(view.date, personId, category === 'record' ? null : category);
      view.register = result.register;
      hcInput.value = String(result.register.headcount ?? 0);
      toast(category === 'record' ? 'Counting them as recorded.' : `Counting them as ${category === 'vip' ? 'VIP' : 'Member'} this Sunday.`);
      await loadReport(result.register.month);
      render();
    } catch (err) {
      toast(err.message, 'error');
      if (select) select.value = 'record';
    }
  }

  async function saveHeadcount() {
    const value = Math.max(0, Math.floor(Number(hcInput.value) || 0));
    hcInput.value = String(value);
    try {
      const result = await api.setServiceHeadcount(view.date, value);
      view.register = result.register;
      toast('Headcount saved.');
      await loadReport(result.register.month);
      render();
    } catch (err) { toast(err.message, 'error'); }
  }

  /** Attendance history for one person — the four Sundays, in order. */
  async function openHistory(personId) {
    let person;
    try { person = await api.person(personId); }
    catch (err) { toast(err.message, 'error'); return; }
    const monthStart = view.register.sundays[0];
    const history = (person.history || []).filter((h) => h.service_date >= monthStart);
    const attended = new Set(history.map((h) => h.service_date));
    const item = (view.register?.items || []).find((i) => i.person_id === Number(personId));
    const isVip = item ? item.category === 'vip' : person.status === 'first_timer' || person.status === 'new_believer';
    const target = Math.min(GIFT_SUNDAYS, view.register.sundays.length);
    const modal = openModal({
      title: person.full_name || `Person ${personId}`,
      subtitle: `${person.person_code || ''}${item ? ' · ' + (item.category === 'vip' ? (item.first_timer ? 'VIP first timer' : 'VIP') : 'Member') : ''}`,
      body: html`
        <p class="small muted">${isVip ? `VIP · ${history.length}/${target} Sundays this month` : `Member · ${history.length} of ${view.register.sundays.filter((d) => d <= view.register.today).length} Sundays marked in this month`}</p>
        <div class="mt-2">${view.register.sundays.map((d, n) => html`
          <div class="sa-hist ${attended.has(d) ? 'is-on' : ''}">
            <span class="sa-hist__n">${n + 1}</span>
            <div><b>${STAGE_LABELS[STATUS_ORDER[n]] || `Sunday ${n + 1}`}</b><small>${fmtDate(d, { weekday: true })}</small></div>
            <span class="sa-hist__s">${attended.has(d) ? 'Present' : d > view.register.today ? 'Upcoming' : 'Not recorded'}</span>
          </div>`)}</div>
        <p class="small muted mt-2">${isVip ? 'A VIP’s presence is the validated VIP check-in that the VIP portal, the prize streak and the Gift Tracker read.' : 'A member is marked present on the roll call. Members do not have a VIP streak or a prize counter.'}</p>`,
      footer: html`<a class="btn" href="#/people/${personId}">Open profile</a><button class="btn btn--primary" data-sa-close>Close</button>`.value,
    });
    modal.querySelector('[data-sa-close]')?.addEventListener('click', () => closeModal());
  }

  /** Walk-in: an existing person checked in, or a brand new VIP recorded properly. */
  function openAddPerson() {
    if (!writable()) return;
    const modal = openModal({
      title: 'Check in someone',
      subtitle: fmtDate(view.date, { weekday: true }),
      body: html`
        <label class="sa-field">Full name
          <input id="saNewName" type="text" maxlength="120" autocomplete="off" placeholder="e.g. Maria Dela Cruz" />
        </label>
        <p class="small muted" id="saMatchHint">Start typing — an existing person is matched by name so nobody is duplicated.</p>
        <div id="saMatches" class="sa-matches"></div>
        <label class="sa-field">Invited by <em>(optional)</em>
          <input id="saNewInviter" type="text" maxlength="200" autocomplete="off" placeholder="Who brought them" />
        </label>
        <label class="sa-field">Count them as
          <select id="saNewCategory"><option value="vip">VIP (first timer)</option><option value="member">Member</option></select>
        </label>
        <label class="row" style="gap:8px;align-items:center"><input id="saNewPresent" type="checkbox" checked /> <span>Mark present for this Sunday</span></label>
        <p class="small muted mt-1" id="saAddNote">A new name becomes a Person record with a VIP registration, so attendance is never orphaned.</p>`,
      footer: html`<button class="btn" data-sa-close>Cancel</button><button class="btn btn--primary" id="saAddSave">Save &amp; check in</button>`.value,
    });
    const nameInput = modal.querySelector('#saNewName');
    const matches = modal.querySelector('#saMatches');
    const hint = modal.querySelector('#saMatchHint');
    const save = modal.querySelector('#saAddSave');
    let picked = null;
    modal.querySelectorAll('[data-sa-close]').forEach((b) => b.addEventListener('click', () => closeModal()));

    const search = debounce(async () => {
      const q = nameInput.value.trim();
      picked = null;
      if (q.length < 2) { matches.innerHTML = ''; hint.textContent = 'Start typing — an existing person is matched by name so nobody is duplicated.'; return; }
      try {
        const found = await api.search(q);
        const rows = (found.people || []).slice(0, 6);
        matches.innerHTML = rows.length
          ? html`${rows.map((p) => html`<button type="button" class="sa-match" data-sa-pick="${p.id}" data-sa-name="${p.full_name || p.first_name + ' ' + p.last_name}">
              <b>${p.full_name || `${p.first_name} ${p.last_name}`}</b><small>${p.person_code} · ${(p.status || '').replace('_', ' ')}</small></button>`)}`
          : '';
        hint.textContent = rows.length ? 'Choose an existing person, or keep the typed name to create a new one.' : 'No match — this will create a new person.';
        matches.querySelectorAll('[data-sa-pick]').forEach((b) => {
          b.onclick = () => {
            picked = Number(b.dataset.saPick);
            nameInput.value = b.dataset.saName;
            matches.querySelectorAll('[data-sa-pick]').forEach((x) => x.classList.toggle('is-picked', x === b));
            hint.textContent = `Existing person: ${b.dataset.saName}. They will be marked present.`;
            modal.querySelector('#saAddNote').textContent = 'Nobody is duplicated: the existing Person record is used.';
            modal.querySelector('#saNewCategory').disabled = true;
          };
        });
      } catch (err) { hint.textContent = err.message; }
    }, 250);
    nameInput.addEventListener('input', () => {
      // Editing the name drops any earlier match: otherwise a picked person could
      // be checked in while a different name sits in the box.
      picked = null;
      matches.querySelectorAll('[data-sa-pick]').forEach((x) => x.classList.remove('is-picked'));
      const cat = modal.querySelector('#saNewCategory');
      cat.disabled = false;
      modal.querySelector('#saAddNote').textContent = 'A new name becomes a Person record with a VIP registration, so attendance is never orphaned.';
      search();
    });

    save.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const present = modal.querySelector('#saNewPresent').checked;
      await withLoading(save, async () => {
        try {
          if (picked) {
            const result = await api.setServiceAttendance(view.date, picked, present);
            view.register = result.register;
            if (result.message) toast(result.message, 'info');
            else toast(`${name} checked in.`);
          } else {
            const result = await api.addServiceAttendancePerson(view.date, name, modal.querySelector('#saNewCategory').value, modal.querySelector('#saNewInviter').value, present);
            view.register = result.register;
            toast(`${result.full_name} registered as ${result.category === 'vip' ? 'a VIP' : 'a member'}${present ? ' and checked in' : ''}.`);
          }
          hcInput.value = String(view.register.headcount ?? 0);
          closeModal();
          loadProgress();
          await loadReport(view.register.month);
          render();
        } catch (err) { toast(err.message, 'error'); }
      });
    };
    setTimeout(() => nameInput.focus(), 60);
  }

  /** "Mark everyone listed in" — the one-tap sweep at the end of a service. */
  async function markAllListed() {
    if (!writable()) return;
    const data = view.register;
    const toMark = filtered(data).filter((i) => !i.present);
    if (!toMark.length) { toast('Everyone listed is already in.', 'info'); return; }
    const ok = await new Promise((resolve) => {
      const modal = openModal({
        title: `Mark ${toMark.length} ${toMark.length === 1 ? 'person' : 'people'} present?`,
        body: html`<p>This marks everyone matching the current filter on <b>${fmtDate(data.date, { weekday: true })}</b> as present.</p>
          <p class="small muted">VIPs will be recorded through their VIP check-in, members on the roster. Anyone already present is left alone.</p>`,
        footer: html`<button class="btn" data-sa-no>Cancel</button><button class="btn btn--primary" data-sa-yes>Mark ${toMark.length} present</button>`.value,
      });
      modal.querySelector('[data-sa-no]').onclick = () => { closeModal(); resolve(false); };
      modal.querySelector('[data-sa-yes]').onclick = () => { closeModal(); resolve(true); };
    });
    if (!ok) return;
    try {
      // Two at a time: quick enough for a full room, gentle on a single-session
      // database, and every response carries the same fresh register.
      let register = data;
      const queue = [...toMark];
      const worker = async () => {
        while (queue.length) {
          const item = queue.shift();
          const result = await api.setServiceAttendance(view.date, item.person_id, true);
          register = result.register;
        }
      };
      await Promise.all([worker(), worker()]);
      view.register = register;
      hcInput.value = String(register.headcount ?? 0);
      toast(`${toMark.length} marked present.`);
      loadProgress();
      await loadReport(register.month);
      render();
    } catch (err) { toast(err.message, 'error'); }
  }

  function reportText() {
    const r = view.report;
    if (!r) return '';
    const lines = r.sundays.map((d) => `${fmtDate(d.date, { weekday: true }).padEnd(26)} members ${d.members} · VIPs ${d.vips} · headcount ${d.headcount} · total ${d.total}`);
    const s = stats(view.register);
    return [`LIFEGEN Service Attendance — ${monthLabel(r.month)}`,
      ...lines,
      `Month total: ${r.totals.total} (members ${r.totals.members}, VIPs ${r.totals.vips}, headcount ${r.totals.headcount}) · average per Sunday ${r.totals.average}`,
      `This Sunday (${fmtDate(view.register.date, { weekday: true })}): total ${s.total} · members ${s.members} · VIPs ${s.vips} (first timers ${s.vipFirst}, returning ${s.vipReturning}) · headcount ${s.headcount}`].join('\n');
  }

  // ---- wiring ------------------------------------------------------------
  $('#saPrev').onclick = () => { view.date = shiftSunday(view.date, -1); searchInput.value = ''; view.q = ''; refresh(); };
  $('#saNext').onclick = () => { const next = shiftSunday(view.date, 1); if (next > today) return; view.date = next; searchInput.value = ''; view.q = ''; refresh(); };
  $('#saToday').onclick = () => { view.date = sundayOf(today); searchInput.value = ''; view.q = ''; refresh(); };
  dateInput.onchange = () => {
    const value = dateInput.value;
    if (!value) return;
    view.date = sundayOf(value > today ? today : value);
    searchInput.value = ''; view.q = '';
    refresh();
  };
  $('#saRefresh').onclick = () => refresh();
  $('#saPrint').onclick = () => window.print();
  $('#saAdd')?.addEventListener('click', openAddPerson);
  $('#saMarkAll')?.addEventListener('click', markAllListed);
  searchInput.oninput = debounce(() => { view.q = searchInput.value; renderList(view.register); }, 160);
  $('#saTabs').onclick = (event) => {
    const btn = event.target.closest('[data-sa-tab]');
    if (!btn) return;
    view.tab = btn.dataset.saTab;
    main.querySelectorAll('[data-sa-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    renderList(view.register);
  };
  const stepHeadcount = (delta) => {
    const next = Math.max(0, (Math.floor(Number(hcInput.value) || 0)) + delta);
    hcInput.value = String(next);
    if (writable()) saveHeadcount();
  };
  $('#saHcMinus').onclick = () => stepHeadcount(-1);
  $('#saHcPlus').onclick = () => stepHeadcount(1);
  $('#saHcSave')?.addEventListener('click', () => saveHeadcount());
  hcInput.onchange = () => { if (writable()) saveHeadcount(); };
  $('#saReportCopy').onclick = async () => {
    const text = reportText();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast('Report copied.'); }
    catch { toast('Could not copy the report.', 'error'); }
  };

  await refresh();
  // Stay in step with other devices marking attendance on the same Sunday.
  main.__liveReload = () => refresh();
}
