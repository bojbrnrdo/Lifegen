import { api } from '../api.js';
import { state, can } from '../app.js';
import { html, icon, fmtDate, fmtNum } from '../ui.js';

/**
 * Compact dashboard: People and the VIP pipeline.
 *
 * Sunday attendance is no longer tracked for regular members — that decision
 * belongs to the Cell Leader — so there is no attendance trend, no weekly
 * average and no per-Sunday table. The only attendance is a VIP check-in, and
 * that lives on the Registration screen.
 */
export async function renderDashboard({ main }) {
  const d = await api.dashboard();
  state.demoLoaded = d.demo_loaded;

  main.innerHTML = html`
    <div class="page-header dashboard-welcome">
      <div>
        <span class="dashboard-welcome__label">LIFEGEN OVERVIEW</span>
        <h1>Church overview</h1>
        <p class="sub">Your church at a glance · ${fmtDate(d.today, { weekday: true })}</p>
      </div>
      <div class="page-actions">
        ${can('registrations:manage') && !state.standalone ? html`<a class="btn btn--primary" href="#/registrations">${icon('qr')} VIP registrations</a>` : ''}
        <a class="btn" href="#/calendar">${icon('calendar')} Calendar</a>
      </div>
    </div>

    ${state.authDisabled && !state.standalone ? html`<div class="alert alert--warn mb-2">${icon('lock', 18)}<span><b>Sign-in is off.</b> Anyone who can open this address is treated as Admin. Turn it on before storing real records (<span class="mono">LIFEGEN_AUTH=on</span>).</span><a class="btn btn--sm" href="#/settings">Settings</a></div>` : ''}
    ${d.pending_registrations && !state.standalone ? html`<div class="alert alert--info mb-2">${icon('inbox', 18)}<span><b>${fmtNum(d.pending_registrations)} VIP registration${d.pending_registrations === 1 ? '' : 's'}</b> waiting for review.</span><a class="btn btn--sm" href="#/registrations">Review</a></div>` : ''}
    ${d.pending_checkins ? html`<div class="alert alert--info mb-2">${icon('check', 18)}<span><b>${fmtNum(d.pending_checkins)} VIP check-in${d.pending_checkins === 1 ? '' : 's'}</b> waiting to be verified at the service.</span><a class="btn btn--sm" href="#/registrations">Verify</a></div>` : ''}


    <div class="card mb-2 dashboard-panel">
      <div class="card__header"><div><span class="dashboard-panel__eyebrow">COMMUNITY</span><h2>People</h2></div>${can('people:view') ? html`<a class="small" href="#/people">Open People ${icon('chevR', 13)}</a>` : ''}</div>
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

    <div class="card mb-2 dashboard-panel">
      <div class="card__header"><div><span class="dashboard-panel__eyebrow">FOLLOW-UP</span><h2>VIP pipeline</h2></div>${can('registrations:manage') && !state.standalone ? html`<a class="small" href="#/registrations">Open Registration ${icon('chevR', 13)}</a>` : ''}</div>
      <div class="card__body">
        <div class="kpi-row" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
          <div class="kpi"><b>${fmtNum(d.vip?.total)}</b><span>VIP registrations</span></div>
          <div class="kpi ${d.vip?.pending ? 'kpi--teal' : ''}"><b>${fmtNum(d.vip?.pending)}</b><span>Awaiting review</span></div>
          <div class="kpi ${d.vip?.pending_checkins ? 'kpi--green' : ''}"><b>${fmtNum(d.vip?.pending_checkins)}</b><span>Check-ins to verify</span></div>
          <div class="kpi"><b>${fmtNum(d.vip?.sundays_recorded)}</b><span>Sundays with check-ins</span></div>
        </div>
        <p class="small muted mt-1">Attendance is recorded for VIPs and first timers only. Members are tracked by their Cell Leader at each Cell meeting.</p>
      </div>
    </div>
  `;
}
