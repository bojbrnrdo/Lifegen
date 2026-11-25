import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const shell=readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../public/admin/js/views/dashboard.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin/styles.css',import.meta.url),'utf8');
test('Admin shell uses one navigation and no duplicate page titles',()=>{
 assert.doesNotMatch(shell,/id="workspacePageTitle"/);
 assert.doesNotMatch(shell,/workspace-quicklink|peopleMenuToggle/);
 assert.match(shell,/aria-current/);
 assert.match(shell,/People & Lifegroups/);
 assert.match(shell,/class="nav__group">Workspace/);
 assert.match(shell,/nav__group--system/);
 assert.match(shell,/can\('registrations:manage'\)\s*&&\s*!state\.standalone/);
 assert.doesNotMatch(shell,/#\/dev\/(?:git|ide|packaging)/);
});
test('Shared design system covers components, mobile layouts and reduced motion',()=>{
 for(const token of ['--sidebar-w:264px','--topbar-h:76px','--bg:#f6f8f6'])assert.ok(css.includes(token),token);
 for(const part of ['.table tbody tr:hover','.dashboard-welcome','.workspace-context','.nav a.active',':focus-visible','@media(prefers-reduced-motion:reduce)'])assert.ok(css.includes(part),part);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(css,/@media\(min-width:1024px\)/);
 assert.match(css,/\.connection-bar\{top:var\(--topbar-h\)\}/);
});
test('Dashboard retains data-driven People and VIP metrics and accessible actions',()=>{
 assert.match(dashboard,/<h1>Dashboard<\/h1>/);
 assert.match(dashboard,/d\.people\.total/);
 assert.match(dashboard,/d\.vip\?\.pending/);
 assert.match(dashboard,/can\('registrations:manage'\)/);
 assert.match(dashboard,/#\/calendar/);
});

test('each routed page renders into an isolated host, guarding async navigation',()=>{
 assert.match(shell,/const routeHost = document\.createElement\('div'\);/);
 assert.match(shell,/main\.replaceChildren\(routeHost\)/);
 assert.match(shell,/r\.view\(\{ main: routeHost, query, params: m \}/);
 assert.match(shell,/main\.__liveReload = routeHost\.__liveReload \|\| null/);
 assert.match(css,/\.route-host\{width:100%;min-width:0\}/);
});

test('retired Developer environment and Dev tools are not Admin routes',()=>{
 assert.doesNotMatch(shell,/renderDeveloper|path: \/\^\\\/developer/);
 assert.doesNotMatch(shell,/#\/dev\/(?:ide|git|packaging)/);
});

test('Vercel redirects retired LifeIDE and Dev JS asset paths away from public static files',()=>{
 const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 for(const url of ['/lifeide','/lifeide/','/lifeide/:path*','/admin/js/views/devWorkspace.js','/admin/js/views/developer.js']) assert.ok(config.redirects.some(r=>r.source===url&&r.destination==='/admin'),url);
});
