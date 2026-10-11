import { api } from '../api.js';
import { state, can } from '../app.js';
import { html, raw, icon, fmtDate, fmtNum, emptyState } from '../ui.js';
import { lineChart } from '../charts.js';

const shortSunday = (d) => { const [, m, day] = d.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${+day}`; };

/**
 * Compact dashboard: VIP registrations, Sunday attendance at a glance, calendar.
 * Every figure comes from /api/dashboard (people, services, records, vip_registrations).
 */
export async function renderDashboard({ main }) {
  const d = await api.dashboard();
  state.demoLoaded = d.demo_loaded;
  const latest = d.latest;
  const noData = d.services_recorded === 0;

  main.innerHTML = html`
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p class="sub">${latest ? html`Latest Sunday · ${fmtDate(latest.service_date, { weekday: true })}` : fmtDate(d.today, { weekday: true })}</p>
      </div>
      <div class="page-actions">
        ${can('registrations:manage') && !state.standalone ? html`<a class="btn btn--primary" href="#/registrations">${icon('qr')} VIP registrations</a>` : ''}
        <a class="btn" href="#/calendar">${icon('calendar')} Calendar</a>
      </div>
    </div>

    ${state.authDisabled && !state.standalone ? html`<div class="alert alert--warn mb-2">${icon('lock', 18)}<span><b>Sign-in is off.</b> Anyone who can open this address is treated as Admin. Turn it on before storing real records (<span class="mono">LIFEGEN_AUTH=on</span>).</span><a class="btn btn--sm" href="#/settings">Settings</a></div>` : ''}
    ${d.pending_registrations && !state.standalone ? html`<div class="alert alert--info mb-2">${icon('inbox', 18)}<span><b>${fmtNum(d.pending_registrations)} VIP registration${d.pending_registrations === 1 ? '' : 's'}</b> waiting for review.</span><a class="btn btn--sm" href="#/registrations">Review</a></div>` : ''}
    ${d.pending_checkins ? html`<div class="alert alert--info mb-2">${icon('check', 18)}<span><b>${fmtNum(d.pending_checkins)} VIP check-in${d.pending_checkins === 1 ? '' : 's'}</b> waiting to be verified at the service.</span><a class="btn btn--sm" href="#/registrations">Verify</a></div>` : ''}
    ${d.demo_loaded ? html`<div class="alert alert--warn demo-banner mb-2">${icon('warn', 18)}<span><b>Demo data is loaded.</b> People named “Demo Person” and their attendance are sample records, not real church data.</span>${can('settings:manage') ? html`<a class="btn btn--sm" href="#/settings">Review data in Settings</a>` : ''}</div>` : ''}

    ${d.latest_vips?.length ? html`<div class="card mb-2"><div class="card__header"><h2>Latest VIP registrations</h2>${can('registrations:manage')?html`<a class="small" href="#/registrations">Review VIPs</a>`:''}</div><div class="card__body"><div class="row" style="gap:14px 24px">${d.latest_vips.map(v=>html`<a href="#/people/${v.person_id}" class="stat-link"><b>${v.name}</b><span class="welcome-source">${v.review_status==='new'?'New VIP':'Reviewed'}</span></a>`)}</div><p class="small muted mt-2">Sent directly from the LIFEGEN website. No manual import.</p></div></div>`:''}

    <div class="card mb-2">
      <div class="card__header"><h2>People</h2>${can('people:view') ? html`<a class="small" href="#/people">Open People ${icon('chevR', 13)}</a>` : ''}</div>
      <div class="card__body">
        <div class="kpi-row" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
          <div class="kpi"><b>${fmtNum(d.people.total)}</b><span>Registered people</span></div>
          <div class="kpi"><b>${fmtNum(d.people.active)}</b><span>Active</span></div>
          <div class="kpi"><b>${fmtNum(d.people.members)}</b><span>Members</span></div>
          <div class="kpi"><b>${fmtNum(d.people.first_timers)}</b><span>First timers</span></div>
          <div class="kpi"><b>${fmtNum(d.people.registered_this_month)}</b><span>New this month</span></div>
        </div>
      </div>
    </div>

    ${noData ? html`<div class="card mb-2">${raw(emptyState({
      icon: 'calendar',
      title: 'No Sunday attendance recorded yet',
      text: can('attendance:write')
        ? 'When VIP guests check in at a service, verify them under Registrations — attendance numbers appear here automatically.'
        : 'Once the first service check-ins are verified, numbers will appear here.',
      action: can('people:write') ? '<a class="btn btn--primary" href="#/people/new">Register a person</a>' : '',
    }))}</div>` : html`
    <div class="grid grid--stats mb-2">
      <div class="card stat">
        <span class="stat__label">Lifegen attendance</span>
        <span class="stat__value">${fmtNum(latest.present_count)}</span>
        <span class="stat__meta">${d.change_vs_previous === null ? 'first recorded Sunday' : raw(`<span class="delta ${d.change_vs_previous >= 0 ? 'delta--up' : 'delta--down'}">${d.change_vs_previous >= 0 ? '+' : '−'}${Math.abs(d.change_vs_previous)}</span> vs previous Sunday`)}</span>
      </div>
      <div class="card stat">
        <span class="stat__label">First timers</span>
        <span class="stat__value">${fmtNum(latest.first_timer_count)}</span>
        <span class="stat__meta">${fmtNum(d.quarter.first_timers)} this quarter</span>
      </div>
      <div class="card stat">
        <span class="stat__label">Returning</span>
        <span class="stat__value">${fmtNum(latest.returning_count)}</span>
        <span class="stat__meta">${fmtNum(d.people.active)} registered people</span>
      </div>
      <div class="card stat">
        <span class="stat__label">Average attendance</span>
        <span class="stat__value">${fmtNum(d.average_attendance)}</span>
        <span class="stat__meta">${d.year.services ? `${d.year.services} Sunday${d.year.services === 1 ? '' : 's'} in ${d.year.label}` : 'last 8 Sundays'}</span>
      </div>
    </div>

    <div class="card mb-2">
      <div class="card__header"><h2>Attendance trend</h2><span class="hint">Last ${d.weekly.length} Sunday${d.weekly.length === 1 ? '' : 's'}</span></div>
      <div class="card__body">${raw(lineChart(d.weekly.map((w) => ({ label: shortSunday(w.service_date), value: w.present_count, title: fmtDate(w.service_date) })), { aria: 'Attendance trend', width: 900, height: 230, cls: 'chart--trend' }))}</div>
    </div>

    <div class="card">
      <div class="card__header"><h2>Recent Sundays</h2></div>
      <div class="table-wrap"><table class="table table--compact">
        <thead><tr><th>Sunday</th><th class="num">Present</th><th class="num">First timers</th><th class="num">Returning</th></tr></thead>
        <tbody>${d.recent.map((s) => html`<tr>
          <td>${fmtDate(s.service_date, { short: true })}</td>
          <td class="num"><b>${fmtNum(s.present_count)}</b></td>
          <td class="num">${fmtNum(s.first_timer_count)}</td>
          <td class="num">${fmtNum(s.returning_count)}</td>
        </tr>`)}</tbody>
      </table></div>
    </div>`}
  `;
}
