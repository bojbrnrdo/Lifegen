import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const shell=readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../public/admin/js/views/dashboard.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin/styles.css',import.meta.url),'utf8');
test('Admin shell has contextual header, grouped navigation and permission-gated quick actions',()=>{
 assert.match(shell,/id="workspacePageTitle"/);
 assert.match(shell,/currentPage\.textContent=/);
 assert.match(shell,/class="nav__group">Workspace/);
 assert.match(shell,/nav__group--system/);
 assert.match(shell,/can\('registrations:manage'\)&&!state\.standalone/);
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
 assert.match(dashboard,/<h1>Church overview<\/h1>/);
 assert.match(dashboard,/d\.people\.total/);
 assert.match(dashboard,/d\.vip\?\.pending/);
 assert.match(dashboard,/can\('registrations:manage'\)/);
 assert.match(dashboard,/#\/calendar/);
});
