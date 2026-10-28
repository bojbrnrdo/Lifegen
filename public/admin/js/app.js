/**
 * LIFEGEN Admin front-end bootstrap: auth gate, layout, router, global search.
 */
import { api, startLiveUpdates } from './api.js';
import { brandMark } from './brand.js';
import { esc, html, icon, toast, errorState, ROLE_LABELS, closeModal } from './ui.js';
import { renderLogin, renderSetup } from './views/auth.js';
import { renderPrivacy, renderPublicPrivacy } from './views/privacy.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAttendance } from './views/attendance.js';
import { renderHistory, renderServiceDetail } from './views/history.js';
import { renderReports } from './views/reports.js';
import { renderPeople } from './views/people.js';
import { renderPersonForm } from './views/personForm.js';
import { renderPerson } from './views/person.js';
import { renderLifegroups, renderLifegroup, renderNetwork } from './views/lifegroups.js';
import { renderSettings } from './views/settings.js';
import {renderDeployment} from './views/deployment.js';
import {renderDeveloper} from './views/developer.js';
import {renderDevIDE,renderDevGit,renderDevPackaging} from './views/devWorkspace.js';
import { renderCalendar } from './views/calendar.js';
import { renderRegistrations, renderQrPoster, refreshPendingBadge } from './views/registrations.js';
import { renderDesigns } from './views/designs.js';
import { renderCommunity } from './views/community.js';

export const state = {
  user: null,
  settings: { church_name: 'Lifegiver Church of Faith', service_name: 'Lifegen / 3rd Service' },
  demoLoaded: false,
  authDisabled: false,
  standalone: false,
  preview: false,
  hostedPreview: false,
  deployHelper: false,
  serverToday: null,
};
export const can = (perm) => Boolean(state.user?.permissions?.includes(perm)) && !(state.user?.person_id && state.user.role_id!=='admin' && ['people:write','people:delete','lifegroups:manage'].includes(perm));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const routes = [
  { path: /^\/dashboard$/, view: renderDashboard, nav: 'dashboard', perm: 'dashboard:view' },
  { path: /^\/people$/, view: () => { location.replace('#/lifegroups?tab=people'); }, nav: 'lifegroups', perm: 'people:view' },
  { path: /^\/people\/new$/, view: (c) => renderPersonForm(c, null), nav: 'lifegroups', perm: 'people:write' },
  { path: /^\/people\/(\d+)$/, view: (c, m) => renderPerson(c, m[1]), nav: 'people', perm: 'people:view' },
  { path: /^\/people\/(\d+)\/edit$/, view: (c, m) => renderPersonForm(c, m[1]), nav: 'people', perm: 'people:write' },
  { path: /^\/attendance$/, view: renderAttendance, nav: 'attendance', perm: 'attendance:view' },
  { path: /^\/attendance\/history$/, view: renderHistory, nav: 'attendance', perm: 'attendance:view' },
  { path: /^\/attendance\/history\/(\d+)$/, view: (c, m) => renderServiceDetail(c, m[1]), nav: 'attendance', perm: 'attendance:view' },
  { path: /^\/reports$/, view: renderReports, nav: 'reports', perm: 'reports:view' },
  { path: /^\/lifegroups$/, view: renderLifegroups, nav: 'lifegroups', perm: 'lifegroups:view' },
  { path: /^\/lifegroups\/(\d+)$/, view: (c, m) => renderLifegroup(c, m[1]), nav: 'lifegroups', perm: 'lifegroups:view' },
  { path: /^\/networks\/(\d+)$/, view: (c, m) => renderNetwork(c, m[1]), nav: 'lifegroups', perm: 'lifegroups:view' },
  { path: /^\/calendar$/, view: renderCalendar, nav: 'calendar', perm: 'dashboard:view' },
  { path: /^\/registrations$/, view: renderRegistrations, nav: 'registrations', perm: 'registrations:manage' },
  { path: /^\/qr-poster$/, view: renderQrPoster, nav: 'settings', perm: 'registrations:manage' },
  { path: /^\/designs$/, view: renderDesigns, nav: 'designs', perm: 'settings:manage' },
  { path: /^\/community$/, view: renderCommunity, nav: 'community', perm: 'settings:manage' },
  { path: /^\/settings$/, view: renderSettings, nav: 'settings' },
  { path: /^\/deploy$/, view: renderDeployment, nav: 'deploy', perm: 'settings:manage' },
  { path: /^\/developer$/, view: renderDeveloper, nav: 'developer', perm: 'settings:manage' },
  { path: /^\/dev\/ide$/, view: renderDevIDE, nav: 'dev-ide', perm: 'settings:manage' },
  { path: /^\/dev\/git$/, view: renderDevGit, nav: 'dev-git', perm: 'settings:manage' },
  { path: /^\/dev\/packaging$/, view: renderDevPackaging, nav: 'dev-packaging', perm: 'settings:manage' },
  { path: /^\/privacy$/, view: renderPrivacy, nav: 'settings' },
];

let currentCleanup = null;
let activeRouteHash = '';

async function route(options = {}) {
  const live = options?.live === true; const oldY = window.scrollY;
  const hashPath = (location.hash.replace(/^#/, '') || '/dashboard').split('?')[0];
  // Linked leaders cannot use the global dashboard endpoint.
  if(state.user?.person_id && state.user.role_id!=='admin' && hashPath==='/dashboard'){
    location.replace('#/lifegroups');return;
  }
  const query = Object.fromEntries(new URLSearchParams((location.hash.split('?')[1] || '')));
  const main = document.getElementById('main');

  if (!state.user) { // auth screens handle themselves — except the public Privacy & Terms page
    const app = document.getElementById('app');
    if (hashPath === '/privacy') { app.className = ''; renderPublicPrivacy(app); }
    else if (app.querySelector('.privacy')) boot();
    return;
  }

  if (!live && activeRouteHash && location.hash !== activeRouteHash &&
      typeof window.__lifegenCanLeaveEditor === 'function' && !window.__lifegenCanLeaveEditor()) {
    location.replace(activeRouteHash);
    return;
  }
  activeRouteHash = location.hash;
  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch {} }
  currentCleanup = null;
  main.__liveReload = null;
  const updateNotice=document.getElementById('applyLiveUpdate');if(updateNotice)updateNotice.hidden=true;
  closeModal();

  const match = routes.map((r) => ({ r, m: hashPath.match(r.path) })).find((x) => x.m);
  if (!match) { location.hash = '#/dashboard'; return; }
  const { r, m } = match;
  if (r.perm && !can(r.perm)) {
    main.innerHTML = html`<div class="card"><div class="empty"><div class="empty__icon">${icon('lock', 26)}</div><h3>Restricted</h3><p>Your role (${ROLE_LABELS[state.user.role_id]}) does not have access to this page.</p><a class="btn mt-2" href="#/dashboard">Back to dashboard</a></div></div>`;
    return;
  }
  setActiveNav(r.nav);
  closeSidebar();
  main.innerHTML = '<div class="loading">Loading…</div>';
  if (!live) window.scrollTo({ top: 0 });
  try {
    const cleanup = await r.view({ main, query, params: m }, m);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
    if (live) window.scrollTo({top: oldY});
  } catch (err) {
    console.error(err);
    main.innerHTML = errorState(err);
  }
}

function setActiveNav(key) {
  document.querySelectorAll('#nav a[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  const devMenu=document.getElementById('devMenu');
  if(devMenu && key.startsWith('dev-')){devMenu.hidden=false;document.getElementById('devMenuToggle')?.setAttribute('aria-expanded','true');}
  const peopleMenu = document.getElementById('peopleMenu');
  if (peopleMenu && ['lifegroups', 'attendance', 'registrations'].includes(key)) {
    peopleMenu.hidden = false;
    document.getElementById('peopleMenuToggle')?.setAttribute('aria-expanded', 'true');
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function navLink(href, key, label, ic, sub = false) {
  const badge = key === 'registrations' ? '<span class="nav__badge" id="navPendingBadge" hidden aria-label="pending registrations"></span>' : '';
  return `<a href="${href}" data-nav="${key}" class="${sub ? 'sub' : ''}">${ic ? icon(ic, 19).value : ''}${esc(label)}${badge}</a>`;
}

function renderShell() {
  const u = state.user;
  const app = document.getElementById('app');
  app.className = 'app';
  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="menuToggle" aria-label="Open menu">${icon('menu', 22).value}</button>
      <a class="brand brand--compact" href="#/dashboard"><span class="brand__mark">${brandMark}</span><span class="brand__text"><strong>LIFEGEN</strong><small>Admin portal</small></span></a>
      <span class="topbar__spacer"></span>
      <a class="btn btn--sm portal-home-link" href="/">Website</a>
    </header>

    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <a class="brand" href="#/dashboard">
        <span class="brand__mark">${brandMark}</span>
        <span class="brand__text"><strong>LIFEGEN</strong><small>Admin portal</small></span>
      </a>
      <nav class="nav" id="nav">
        ${navLink('#/dashboard', 'dashboard', 'Dashboard', 'chart')}
        ${(can('lifegroups:view')||can('attendance:view')||(can('registrations:manage')&&!state.standalone))?`        <div class="nav__people">
          <button type="button" class="nav__parent" id="peopleMenuToggle" aria-expanded="false" aria-controls="peopleMenu">
            ${icon('people',19).value}<span>People</span><span class="nav__chevron" aria-hidden="true">▾</span>
          </button>
          <div class="nav__children" id="peopleMenu" hidden>
             ${can('lifegroups:view') ? navLink('#/lifegroups', 'lifegroups', 'Lifegroups', 'group', true) : ''}
            ${can('attendance:view') ? navLink('#/attendance', 'attendance', 'Attendance', 'check', true) : ''}
            ${can('registrations:manage') && !state.standalone ? navLink('#/registrations', 'registrations', 'Registration', 'qr', true) : ''}
          </div>
        </div>`:''}
        ${can('reports:view') ? navLink('#/reports', 'reports', 'Reports', 'chart') : ''}
        ${navLink('#/calendar', 'calendar', 'Calendar', 'calendar')}
        ${can('settings:manage') ? navLink('#/community', 'community', 'Community board', 'inbox') : ''}
        ${can('settings:manage') ? navLink('#/designs', 'designs', 'VIP Designs', 'camera') : ''}
        ${navLink('#/settings', 'settings', 'Settings', 'settings')}
        ${u.role_id==='admin' ? `<div class="nav__people"><button type="button" class="nav__parent" id="devMenuToggle" aria-expanded="false" aria-controls="devMenu">${icon('code',19).value}<span>Dev</span><span class="nav__chevron" aria-hidden="true">▾</span></button><div class="nav__children" id="devMenu" hidden>${navLink('#/dev/ide','dev-ide','LifeIDE',null,true)}${navLink('#/dev/git','dev-git','Git',null,true)}${navLink('#/dev/packaging','dev-packaging','Packaging',null,true)}</div></div>` : ''}
        ${state.deployHelper&&can('settings:manage')?navLink('#/deploy','deploy','Publish website','upload'):''}
        <a class="nav__foot portal-public-link" href="/">← Public website</a>
        <a class="nav__foot" href="#/privacy">Privacy &amp; Terms</a>
      </nav>
      <div class="sidebar__user">
        <span class="avatar avatar--sm">${esc(u.display_name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase())}</span>
        <div style="min-width:0"><strong class="truncate">${esc(u.display_name)}</strong><small>${esc(ROLE_LABELS[u.role_id] || u.role_id)} · shared database</small></div>
        ${state.authDisabled ? '' : `<button class="icon-btn" id="logoutBtn" title="Sign out" aria-label="Sign out">${icon('logout', 19).value}</button>`}
      </div>
    </aside>
    <div class="backdrop" id="backdrop"></div>
    <main class="main" id="main" tabindex="-1"><div class="loading">Loading…</div></main>`;

  document.getElementById('menuToggle').onclick = () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('backdrop').classList.toggle('show');
  };
  document.getElementById('backdrop').onclick = closeSidebar;
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = async () => {
    await api.logout().catch(() => {});
    state.user = null;
    location.hash = '#/dashboard';
    boot();
  };
  const peopleToggle = document.getElementById('peopleMenuToggle');
  peopleToggle?.addEventListener('click', () => {
    const menu = document.getElementById('peopleMenu');
    const expanded = peopleToggle.getAttribute('aria-expanded') === 'true';
    menu.hidden = expanded;
    peopleToggle.setAttribute('aria-expanded', String(!expanded));
  });
  const devToggle=document.getElementById('devMenuToggle');
  devToggle?.addEventListener('click',()=>{const m=document.getElementById('devMenu');const open=devToggle.getAttribute('aria-expanded')==='true';m.hidden=open;devToggle.setAttribute('aria-expanded',String(!open));});
  refreshPendingBadge();
  const bar=document.createElement('div');bar.className='connection-bar';bar.id='connectionBar';bar.innerHTML=`<span class="connection-dot"></span><span id="connectionText">Connecting live updates…</span>${state.preview?'<span class="preview-tag">Demo · temporary local PostgreSQL, not Supabase</span>':state.hostedPreview?'<span class="preview-tag">Connected preview · Supabase PostgreSQL</span>':''}<a href="#" id="applyLiveUpdate" hidden>New updates — refresh view</a>`;
  document.getElementById('main').before(bar); startLiveUpdates();
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('backdrop')?.classList.remove('show');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
export async function boot() {
  const app = document.getElementById('app');
  let status;
  try {
    status = await api.status();
  } catch (err) {
    app.innerHTML = errorState(err);
    return;
  }
  state.settings = status.settings || state.settings;
  state.demoLoaded = status.demo_loaded;
  state.authDisabled = Boolean(status.auth_disabled);
  state.standalone = Boolean(status.standalone);
  state.preview = Boolean(status.preview); state.hostedPreview = Boolean(status.hosted_preview); state.deployHelper = Boolean(status.deploy_helper_enabled); state.serverToday = status.today; app.dataset.demo=state.preview?"true":"false"; app.dataset.recovery=status.setup_available?"true":"false";
  if (!location.hash) {
    const startHash = state.preview && state.hostedPreview ? '#/lifegroups?tab=needs' : '#/dashboard';
    history.replaceState(null, '', `${location.pathname}${location.search}${startHash}`);
  }
  document.title = `LIFEGEN Admin · ${state.settings.church_name}`;

  if (status.needs_setup) {
    app.className = '';
    renderSetup(app, () => { history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`); boot(); });
    return;
  }
  if (!status.user) {
    app.className = '';
    if ((location.hash.replace(/^#/, '') || '').split('?')[0] === '/privacy') { renderPublicPrivacy(app); return; }
    renderLogin(app, async () => {
      try {
        const verified=await api.status(); if(!verified.user) return false;
        if(!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`);
        await boot(); return true;
      } catch { return false; }
    });
    return;
  }
  state.user = status.user;
  if(state.user.person_id && state.user.role_id!=='admin' && (!location.hash || location.hash==='#/dashboard'))
    history.replaceState(null,'',location.pathname+location.search+'#/lifegroups');
  renderShell();
  route();
}
// Pending-registration badge: refreshed on every route change (cheap count query, admin only).
window.addEventListener('hashchange', () => refreshPendingBadge());

window.addEventListener('hashchange', route);
// "Skip to content" must not touch the hash router — just move focus into the page
document.getElementById('skipLink')?.addEventListener('click', (e) => { e.preventDefault(); const m = document.getElementById('main'); if (m) { m.setAttribute('tabindex', '-1'); m.focus({ preventScroll: false }); } });
window.addEventListener('auth:expired', () => {
  if (state.user) {
    state.user = null;
    toast('Your session has expired. Please sign in again.', 'info');
    boot();
  }
});
boot();

window.addEventListener('api:message',e=>toast(e.detail.message,e.detail.type));
window.addEventListener('sync:state',e=>{const bar=document.getElementById('connectionBar'),label=document.getElementById('connectionText');if(!bar||!label)return;bar.dataset.state=e.detail.state==='offline'?'offline':'live';label.textContent=e.detail.state==='live'?'Live updates · shared database':e.detail.state==='refresh'?'Automatic refresh · shared database':'Connection interrupted — reconnecting';});
let liveRefreshTimer;
window.addEventListener('db:change',()=>{clearTimeout(liveRefreshTimer);liveRefreshTimer=setTimeout(()=>{
 if(!state.user)return;refreshPendingBadge();const path=location.hash.split('?')[0],main=document.getElementById('main');
 const editing=/\/new$|\/edit$/.test(path)||path==='#/settings'||path==='#/deploy'||document.querySelector('#modalRoot .modal');
 if(!editing&&typeof main?.__liveReload==='function'){Promise.resolve(main.__liveReload()).catch(e=>toast(e.message,'error'));return;}
 if(editing||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){const link=document.getElementById('applyLiveUpdate');if(link){link.hidden=false;link.onclick=e=>{e.preventDefault();if(confirm('Refresh this view? Unsaved edits will be lost.'))route({live:true});};}return;}
 route({live:true});
},350);});
