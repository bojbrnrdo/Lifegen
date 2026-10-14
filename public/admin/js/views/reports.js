import { api } from '../api.js';
import { state } from '../app.js';
import { html, raw, icon, fmtDate, fmtNum, fmtPct, fmtMonth, fmtMonthShort, emptyState, downloadUrl, toISODate, lastSunday } from '../ui.js';
import { barChart, lineChart, donutChart } from '../charts.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortSunday = (d) => { const [, m, day] = d.split('-'); return `${MONTHS[+m - 1].slice(0, 3)} ${+day}`; };

export async function renderReports({ main, query }) {
  if (query.view === 'lifegroups') { location.hash = '#/lifegroups?tab=progress'; return; }
  const years = await api.reportYears();
  const now = new Date();
  // The report period is Month, Quarter, Year or Custom. Older links that still
  // ask for mode=week open the month view instead of breaking.
  const mode = query.mode === 'week' ? 'month' : query.mode || (query.year && !query.quarter && !query.month ? 'year' : query.quarter ? 'quarter' : query.from ? 'range' : 'month');
  const sel = {
    mode,
    year: Number(query.year) || now.getFullYear(),
    month: Number(query.month) || now.getMonth() + 1,
    quarter: Number(query.quarter) || Math.floor(now.getMonth() / 3) + 1,
    from: query.from || toISODate(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
    to: query.to || toISODate(lastSunday()),
  };

  main.innerHTML = html`
    <div class="page-header">
      <div><h1>Reports</h1></div>
      <div class="page-actions">
        <div class="filter-tabs" style="margin:0"><button class="active">Attendance</button><button id="toLgReport">Lifegroups</button></div>
        <button class="btn" id="printBtn">${icon('print')} Print / PDF</button>
        <div class="row" style="position:relative">
          <button class="btn" id="exportBtn">${icon('download')} Export</button>
          <div class="gsearch__results" id="exportMenu" hidden style="left:auto;right:0;min-width:240px;top:calc(100% + 6px)">
            <a class="gsearch__item" href="#" data-x="weekly">Weekly breakdown (CSV)</a>
            <a class="gsearch__item" href="#" data-x="monthly">Monthly breakdown (CSV)</a>
            <a class="gsearch__item" href="#" data-x="detail">Per-person detail (CSV)</a>
          </div>
        </div>
      </div>
    </div>

    <div class="card mb-2"><div class="card__body">
      <div class="row row--between" style="gap:12px">
        <div class="segmented" id="modeSeg">
          ${['month', 'quarter', 'year', 'range'].map((m) => html`<button data-m="${m}" class="${sel.mode === m ? 'active' : ''}">${m === 'range' ? 'Custom' : m[0].toUpperCase() + m.slice(1)}</button>`)}
        </div>
        <div class="row" id="pickers"></div>
      </div>
    </div></div>

    <div id="report"><div class="loading">Building report…</div></div>`;

  const pickers = main.querySelector('#pickers');
  const yearOpts = (v) => years.map((y) => html`<option value="${y}" ${y === v ? 'selected' : ''}>${y}</option>`);

  function drawPickers() {
    const m = sel.mode;
    pickers.innerHTML = html`
      ${m === 'month' ? html`<select id="pMonth" style="width:auto">${MONTHS.map((n, i) => html`<option value="${i + 1}" ${sel.month === i + 1 ? 'selected' : ''}>${n}</option>`)}</select>` : ''}
      ${m === 'quarter' ? html`<select id="pQuarter" style="width:auto">${[1, 2, 3, 4].map((q) => html`<option value="${q}" ${sel.quarter === q ? 'selected' : ''}>Q${q} (${MONTHS[(q - 1) * 3].slice(0, 3)}–${MONTHS[q * 3 - 1].slice(0, 3)})</option>`)}</select>` : ''}
      ${m !== 'range' ? html`<select id="pYear" style="width:auto">${yearOpts(sel.year)}</select>` : ''}
      ${m === 'range' ? html`<input type="date" id="pFrom" value="${sel.from}" style="width:auto"/> <span class="muted">to</span> <input type="date" id="pTo" value="${sel.to}" style="width:auto"/>` : ''}`;
    pickers.querySelectorAll('select,input').forEach((el) => (el.onchange = () => {
      if (el.id === 'pMonth') sel.month = Number(el.value);
      if (el.id === 'pQuarter') sel.quarter = Number(el.value);
      if (el.id === 'pYear') sel.year = Number(el.value);
      if (el.id === 'pFrom') sel.from = el.value;
      if (el.id === 'pTo') sel.to = el.value;
      load();
    }));
  }

  function params() {
    if (sel.mode === 'month') return { year: sel.year, month: sel.month };
    if (sel.mode === 'quarter') return { year: sel.year, quarter: sel.quarter };
    if (sel.mode === 'year') return { year: sel.year };
    return { from: sel.from, to: sel.to };
  }

  main.querySelector('#modeSeg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sel.mode = b.dataset.m;
    main.querySelectorAll('#modeSeg button').forEach((x) => x.classList.toggle('active', x === b));
    drawPickers(); load();
  };
  main.querySelector('#toLgReport').onclick = () => { location.hash = '#/lifegroups?tab=progress'; };
  main.querySelector('#printBtn').onclick = () => window.print();
  const exportMenu = main.querySelector('#exportMenu');
  main.querySelector('#exportBtn').onclick = (e) => { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; };
  document.addEventListener('click', () => { exportMenu.hidden = true; }, { once: false });
  exportMenu.onclick = (e) => {
    const a = e.target.closest('[data-x]'); if (!a) return;
    e.preventDefault();
    downloadUrl(`/api/reports/export/${a.dataset.x}.csv${api.qs(params())}`);
    exportMenu.hidden = true;
  };

  const report = main.querySelector('#report');

  async function load() {
    history.replaceState(null, '', '#/reports' + api.qs({ mode: sel.mode, ...params() }));
    report.innerHTML = '<div class="loading">Building report…</div>';
    let r;
    try { r = await api.reportSummary(params()); } catch (err) { report.innerHTML = html`<div class="alert alert--error">${err.message}</div>`; return; }
    const t = r.totals;

    if (!r.weekly.length) {
      report.innerHTML = html`<div class="card">${raw(emptyState({ icon: 'chart', title: `No attendance recorded for ${r.range.label}`, text: 'Choose a different period, or record Sundays on the Attendance page.' }))}</div>`;
      return;
    }

    report.innerHTML = html`
      <div class="print-header"><h1>${state.settings.church_name} — Lifegen Attendance Report</h1><p>${r.range.label} · generated ${fmtDate(toISODate(new Date()))}</p></div>
      <div class="card mb-2">
        <div class="card__header"><h2>${r.range.label}</h2><span class="hint">${fmtDate(r.range.from || r.weekly[0].service_date, { short: true })} – ${fmtDate(r.range.to || r.weekly.at(-1).service_date, { short: true })} · ${t.services} Sunday${t.services === 1 ? '' : 's'}</span></div>
        <div class="card__body kpi-row">
          <div class="kpi kpi--teal"><b>${fmtNum(t.total_attendance)}</b><span>Total attendance</span></div>
          <div class="kpi"><b>${fmtNum(t.average_attendance)}</b><span>Average / Sunday</span></div>
          <div class="kpi kpi--green"><b>${fmtNum(t.highest?.present_count)}</b><span>Highest · ${t.highest ? fmtDate(t.highest.service_date, { short: true }) : ''}</span></div>
          <div class="kpi kpi--red"><b>${fmtNum(t.lowest?.present_count)}</b><span>Lowest · ${t.lowest ? fmtDate(t.lowest.service_date, { short: true }) : ''}</span></div>
          <div class="kpi kpi--amber"><b>${fmtNum(t.first_timers)}</b><span>First timers</span></div>
          <div class="kpi kpi--blue"><b>${fmtNum(t.returning)}</b><span>Returning</span></div>
          <div class="kpi"><b>${fmtPct(t.average_rate)}</b><span>Avg attendance rate</span></div>
          <div class="kpi"><b>${fmtNum(t.unique_attendees)}</b><span>Unique people</span></div>
          <div class="kpi"><b>${fmtNum(t.new_registrations)}</b><span>New registrations</span></div>
        </div>
      </div>

      <div class="grid grid--2 mb-2">
        <div class="card">
          <div class="card__header"><h2>Weekly attendance</h2><span class="legend-row"><span>Returning</span><span class="alt">First timers</span></span></div>
          <div class="card__body">${raw(barChart(r.weekly.map((w) => ({ label: shortSunday(w.service_date), returning: w.returning_count, first: w.first_timer_count, title: fmtDate(w.service_date) })), { stacked: [{ key: 'returning', label: 'Returning' }, { key: 'first', label: 'First timers', cls: 'bar--alt' }], showValues: true, aria: 'Weekly attendance' }))}</div>
        </div>
        <div class="card">
          <div class="card__header"><h2>Attendance trend</h2><span class="legend-row"><span>Present</span><span class="alt">4-week average</span></span></div>
          <div class="card__body">${raw(lineChart(r.weekly.map((w) => ({ label: shortSunday(w.service_date), value: w.present_count, title: fmtDate(w.service_date) })), { average: true }))}</div>
        </div>
        ${r.monthly.length > 1 ? html`<div class="card">
          <div class="card__header"><h2>Monthly attendance</h2></div>
          <div class="card__body">${raw(barChart(r.monthly.map((m) => ({ label: fmtMonthShort(m.month), value: m.present, title: fmtMonth(m.month) })), { aria: 'Monthly attendance' }))}</div>
        </div>` : ''}
        <div class="card">
          <div class="card__header"><h2>First timers vs returning</h2></div>
          <div class="card__body">${raw(donutChart([{ label: 'Returning', value: t.returning, color: '#0f766e' }, { label: 'First timers', value: t.first_timers, color: '#b9ddd8' }], { centerLabel: 'present' }))}</div>
        </div>
      </div>

      <div class="card mb-2">
        <div class="card__header"><h2>Weekly breakdown</h2></div>
        <div class="table-wrap"><table class="table table--stack">
          <thead><tr><th>Sunday</th><th class="num">Present</th><th class="num">First timers</th><th class="num">Returning</th><th class="num">Absent</th><th class="num">Registered</th><th class="num">Rate</th></tr></thead>
          <tbody>${r.weekly.map((w) => html`<tr>
            <td data-label="Sunday"><a href="#/attendance/history/${w.id}">${fmtDate(w.service_date)}</a></td>
            <td data-label="Present" class="num"><b>${w.present_count}</b></td><td data-label="First timers" class="num">${w.first_timer_count}</td>
            <td data-label="Returning" class="num">${w.returning_count}</td><td data-label="Absent" class="num">${w.absent_count}</td>
            <td data-label="Registered" class="num">${w.registered_base}</td><td data-label="Rate" class="num">${fmtPct(w.attendance_rate)}</td></tr>`)}</tbody>
          <tfoot><tr><td data-label="">Total / average</td><td data-label="Present" class="num">${t.total_attendance}</td><td data-label="First timers" class="num">${t.first_timers}</td><td data-label="Returning" class="num">${t.returning}</td><td data-label="Absent" class="num">${t.absent}</td><td data-label="" class="num">—</td><td data-label="Rate" class="num">${fmtPct(t.average_rate)}</td></tr></tfoot>
        </table></div>
      </div>

      <div class="card">
        <div class="card__header"><h2>Monthly breakdown</h2></div>
        <div class="table-wrap"><table class="table table--stack">
          <thead><tr><th>Month</th><th class="num">Sundays</th><th class="num">Total present</th><th class="num">Average</th><th class="num">First timers</th><th class="num">Returning</th><th class="num">Absent</th></tr></thead>
          <tbody>${r.monthly.map((m) => html`<tr>
            <td data-label="Month"><b>${fmtMonth(m.month)}</b></td><td data-label="Sundays" class="num">${m.services}</td><td data-label="Total" class="num"><b>${m.present}</b></td>
            <td data-label="Average" class="num">${m.average}</td><td data-label="First timers" class="num">${m.first_timers}</td><td data-label="Returning" class="num">${m.returning}</td><td data-label="Absent" class="num">${m.absent}</td></tr>`)}</tbody>
        </table></div>
      </div>`;
  }

  drawPickers();
  load();
}
