/**
 * LIFEGEN Admin front-end bootstrap: auth gate, layout, router, global search.
 */
import { api, startLiveUpdates } from './api.js';
import { brandMark } from './brand.js';
import { mountWorkspaceCommandSearch } from './workspaceCommands.js';
import { esc, html, icon, toast, errorState, ROLE_LABELS, closeModal } from './ui.js';
import { renderLogin, renderSetup } from './views/auth.js';
import { renderPrivacy, renderPublicPrivacy } from './views/privacy.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPeople } from './views/people.js';
import { renderPersonForm } from './views/personForm.js';
import { renderPerson } from './views/person.js';
import { renderLifegroups, renderLifegroup, renderNetwork } from './views/lifegroups.js';
import { renderSettings } from './views/settings.js';
import {renderDeployment} from './views/deployment.js';
import { renderCalendar } from './views/calendar.js';
import { renderRegistrations, renderQrPoster, renderServiceQr, refreshPendingBadge } from './views/registrations.js';
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
const isYouthWelfareRole = role => ['youth_welfare_admin','youth_welfare_staff','youth_welfare_viewer'].includes(role);
const shouldOpenYouthWelfare = user => Boolean(user && (
  isYouthWelfareRole(user.role_id) ||
  // Shared LIFEGEN accounts may receive an active Youth Welfare assignment
  // without changing their primary staff role. Keep primary admins in Admin.
  (user.role_id !== 'admin' && isYouthWelfareRole(user.youth_welfare_role) &&
   user.permissions?.includes('youth_welfare:view'))
));
const youthWelfareUrl = preview => {
  const token = preview ? api.getPreviewSessionToken() : null;
  return '/youth-welfare' + (token ? `#preview-session=${encodeURIComponent(token)}` : '');
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const routes = [
  { path: /^\/dashboard$/, view: renderDashboard, nav: 'dashboard', perm: 'dashboard:view' },
  { path: /^\/people$/, view: renderPeople, nav: 'people', perm: 'people:view' },
  { path: /^\/people\/new$/, view: (c) => renderPersonForm(c, null), nav: 'people', perm: 'people:write' },
  { path: /^\/people\/(\d+)$/, view: (c, m) => renderPerson(c, m[1]), nav: 'people', perm: 'people:view' },
  { path: /^\/people\/(\d+)\/edit$/, view: (c, m) => renderPersonForm(c, m[1]), nav: 'people', perm: 'people:write' },
  { path: /^\/lifegroups$/, view: renderLifegroups, nav: 'lifegroups', perm: 'lifegroups:view' },
  { path: /^\/lifegroups\/(\d+)$/, view: (c, m) => renderLifegroup(c, m[1]), nav: 'lifegroups', perm: 'lifegroups:view' },
  { path: /^\/networks\/(\d+)$/, view: (c, m) => renderNetwork(c, m[1]), nav: 'lifegroups', perm: 'lifegroups:view' },
  { path: /^\/calendar$/, view: renderCalendar, nav: 'calendar', perm: 'dashboard:view' },
  { path: /^\/registrations$/, view: renderRegistrations, nav: 'registrations', perm: 'registrations:manage' },
  { path: /^\/qr-poster$/, view: renderQrPoster, nav: 'settings', perm: 'registrations:manage' },
  { path: /^\/checkin-qr$/, view: renderServiceQr, nav: 'registrations', perm: 'registrations:manage' },
  { path: /^\/designs$/, view: renderDesigns, nav: 'designs', perm: 'settings:manage' },
  { path: /^\/community$/, view: renderCommunity, nav: 'community', perm: 'settings:manage' },
  { path: /^\/settings$/, view: renderSettings, nav: 'settings' },
  { path: /^\/deploy$/, view: renderDeployment, nav: 'deploy', perm: 'settings:manage' },
  { path: /^\/privacy$/, view: renderPrivacy, nav: 'settings' },
];

let currentCleanup = null;
let activeRouteHash = '';
let routeSequence = 0;

async function route(options = {}) {
  const live = options?.live === true; const oldY = window.scrollY;
  const hashPath = (location.hash.replace(/^#/, '') || '/dashboard').split('?')[0];
  const query = Object.fromEntries(new URLSearchParams((location.hash.split('?')[1] || '')));
  const main = document.getElementById('main');

  if (!state.user) { // auth screens handle themselves — except the public Privacy & Terms page
    const app = document.getElementById('app');
    if (hashPath === '/privacy') { app.className = ''; renderPublicPrivacy(app); }
    else if (app.querySelector('.privacy')) boot();
    return;
  }

  // A live data update must never tear down an in-progress registration modal.
  // The page-level listener normally defers these already; keep the guard here too
  // so any future background route refresh preserves the form and its entered data.
  if (live && document.querySelector('#modalRoot .modal')) {
    const updateNotice=document.getElementById('applyLiveUpdate');
    if(updateNotice)updateNotice.hidden=false;
    return;
  }

  if (!live && activeRouteHash && location.hash !== activeRouteHash &&
      typeof window.__lifegenCanLeaveEditor === 'function' && !window.__lifegenCanLeaveEditor()) {
    location.replace(activeRouteHash);
    return;
  }
  activeRouteHash = location.hash;
  const routeTicket = ++routeSequence;
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
  // A route gets its own DOM surface. Slow responses from a departed page
  // can update only their detached surface, never the newly selected page.
  const routeHost = document.createElement('div');
  routeHost.className = 'route-host';
  routeHost.innerHTML = '<div class="loading">Loading…</div>';
  main.replaceChildren(routeHost);
  if (!live) window.scrollTo({ top: 0 });
  try {
    const cleanup = await r.view({ main: routeHost, query, params: m }, m);
    if (routeTicket !== routeSequence) { if (typeof cleanup === 'function') cleanup(); return; }
    main.__liveReload = routeHost.__liveReload || null;
    if (typeof cleanup === 'function') currentCleanup = cleanup;
    if (live) window.scrollTo({top: oldY});
  } catch (err) {
    if (routeTicket !== routeSequence) return;
    console.error(err);
    routeHost.innerHTML = errorState(err);
  }
}

function setActiveNav(key) {
  document.querySelectorAll('#nav a[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  document.querySelectorAll('#nav a[data-nav]').forEach(a => {
    if (a.dataset.nav === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function navLink(href, key, label, ic, sub = false) {
  const badge = key === 'registrations' ? '<span class="nav__badge" id="navPendingBadge" hidden aria-label="pending registrations"></span>' : '';
  return `<a href="${href}" data-nav="${key}" class="${sub ? 'sub' : ''}">${ic ? icon(ic, 19).value : ''}${esc(label)}${badge}</a>`;
}

let cleanupCommandSearch = null;
function renderShell() {
  cleanupCommandSearch?.();
  cleanupCommandSearch = null;
  const u = state.user;
  const app = document.getElementById('app');
  app.className = 'app';
  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="menuToggle" aria-label="Open menu">${icon('menu', 22).value}</button>
      <a class="brand brand--compact" href="#/dashboard"><span class="brand__mark">${brandMark}</span><span class="brand__text"><strong>LIFEGEN</strong><small>Admin portal</small></span></a>
      <form class="header-search" id="workspaceCommandSearch" role="search" aria-label="Jump to LIFEGEN section or action">
        <input id="workspaceCommandInput" type="search" placeholder="Jump to a section or action…" autocomplete="off" aria-label="Jump to LIFEGEN sections and actions" />
        <kbd class="workspace-command-shortcut" aria-hidden="true">⌘ K</kbd>
        <button type="submit" aria-label="Go to selected section" title="Go to selected section">${icon('search',19).value}</button>
      </form>
      <div class="header-tools">
        <span class="header-date" aria-label="Today's date">${new Intl.DateTimeFormat('en-PH',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Manila'}).format(new Date())}</span>
        <a class="header-icon" href="/" title="Open public website" aria-label="Open public website">${icon('link',19).value}</a>
        <a class="header-profile" href="#/settings" title="Account settings" aria-label="Account settings">${esc(u.display_name.split(' ').map(x=>x[0]||'').join('').slice(0,2).toUpperCase())}</a>
      </div>
    </header>

    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <a class="brand" href="#/dashboard">
        <span class="brand__mark">${brandMark}</span>
        <span class="brand__text"><strong>LIFEGEN</strong><small>Admin portal</small></span>
      </a>
      <nav class="nav" id="nav">
        <div class="nav__group">Workspace</div>
        ${navLink('#/dashboard', 'dashboard', 'Dashboard', 'chart')}
        ${can('people:view') ? navLink('#/people', 'people', 'People', 'people') : ''}
        ${can('lifegroups:view') ? navLink('#/lifegroups', 'lifegroups', 'Lifegroups', 'group') : ''}
        ${can('registrations:manage') && !state.standalone ? navLink('#/registrations', 'registrations', 'Registration', 'qr') : ''}
        ${navLink('#/calendar', 'calendar', 'Calendar', 'calendar')}
        ${can('settings:manage') ? navLink('#/community', 'community', 'Community board', 'inbox') : ''}
        ${can('settings:manage') ? navLink('#/designs', 'designs', 'VIP Designs', 'camera') : ''}
        <div class="nav__group nav__group--system">System</div>
        ${navLink('#/settings', 'settings', 'Settings', 'settings')}
        ${state.deployHelper&&can('settings:manage')?navLink('#/deploy','deploy','Publish website','upload'):''}
        <a class="nav__foot portal-public-link" href="/">← Public website</a>
        <a class="nav__foot" href="#/privacy">Privacy &amp; Terms</a>
      </nav>
      <div class="sidebar__user">
        <span class="avatar avatar--sm">${esc(u.display_name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase())}</span>
        <div style="min-width:0"><strong class="truncate">${esc(u.display_name)}</strong><small>${esc(ROLE_LABELS[u.role_id] || u.role_id)}</small></div>
        ${state.authDisabled ? '' : `<button class="icon-btn" id="logoutBtn" title="Sign out" aria-label="Sign out">${icon('logout', 19).value}</button>`}
      </div>
    </aside>
    <div class="backdrop" id="backdrop"></div>
    <main class="main" id="main" tabindex="-1"><div class="loading">Loading…</div></main>`;

  // Global workspace command search navigates only to permission-allowed modules.
  cleanupCommandSearch = mountWorkspaceCommandSearch({
    form:document.getElementById('workspaceCommandSearch'), can,
    standalone:state.standalone, deployHelper:state.deployHelper,
    navigate:destination=>{location.hash=destination;},
  });

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
    renderLogin(app, async (loginUser) => {
      try {
        const verified=await api.status(); if(!verified.user) return false;
        const signedInUser=verified.user||loginUser;
        if(shouldOpenYouthWelfare(signedInUser)){
          // In production the HttpOnly cookie carries the session across this redirect.
          // Hosted previews hand off their in-memory bearer in a fragment, consumed immediately.
          location.replace(youthWelfareUrl(verified.preview)); return true;
        }
        if(!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`);
        await boot(); return true;
      } catch { return false; }
    });
    return;
  }
  if(shouldOpenYouthWelfare(status.user)){
    location.replace(youthWelfareUrl(status.preview));
    return;
  }
  state.user = status.user;
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
window.addEventListener('sync:state',e=>{const bar=document.getElementById('connectionBar'),label=document.getElementById('connectionText');if(!bar||!label)return;bar.dataset.state=e.detail.state==='offline'?'offline':'live';label.textContent=e.detail.state==='live'?'Live updates':e.detail.state==='refresh'?'Automatic refresh':'Connection interrupted — reconnecting';});
let liveRefreshTimer;
window.addEventListener('db:change',()=>{clearTimeout(liveRefreshTimer);liveRefreshTimer=setTimeout(()=>{
 if(!state.user)return;refreshPendingBadge();const path=location.hash.split('?')[0],main=document.getElementById('main');
 const editing=/\/new$|\/edit$/.test(path)||path==='#/settings'||path==='#/deploy'||document.querySelector('#modalRoot .modal');
 if(!editing&&typeof main?.__liveReload==='function'){Promise.resolve(main.__liveReload()).catch(e=>toast(e.message,'error'));return;}
 if(editing||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){const link=document.getElementById('applyLiveUpdate');if(link){link.hidden=false;link.onclick=e=>{e.preventDefault();if(confirm('Refresh this view? Unsaved edits will be lost.'))route({live:true});};}return;}
 route({live:true});
},350);});
