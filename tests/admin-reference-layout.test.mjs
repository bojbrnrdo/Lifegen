import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const shell=readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
const profile=readFileSync(new URL('../public/admin/js/views/person.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin/reference-layout.css',import.meta.url),'utf8');
const page=readFileSync(new URL('../public/admin/index.html',import.meta.url),'utf8');

test('Reference visual system is loaded last without replacing existing Admin routes',()=>{
 assert.match(page,/reference-layout\.css/);
 for(const route of ['#/people','#/lifegroups','#/registrations','#/calendar','#/community','#/settings'])assert.ok(shell.includes(route),route);
 assert.doesNotMatch(shell,/#\/dev\/(?:ide|git|packaging)/);
 assert.match(css,/\.app>\.topbar\{/);
 assert.match(css,/\.header-search\{/);
 assert.match(css,/\.app \.sidebar \.nav a\.active/);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
test('Header has no global search and retains shortcuts and account access',()=>{
 assert.match(shell,/class="header-context">Church administration/);
 assert.doesNotMatch(shell,/workspaceCommandSearch|workspaceCommandInput|mountWorkspaceCommandSearch|headerPeopleSearch/);
 assert.match(shell,/class="header-tools"/);
 assert.match(shell,/href="#\/settings" title="Account settings"/);
 assert.match(css,/\.app \.header-context\{/);
});
test('Person profile preserves privacy and actions in reference-like grouped cards',()=>{
 assert.match(profile,/Personal information/);
 assert.match(profile,/Address & notes/);
 assert.match(profile,/id="personDetails"/);
 assert.match(profile,/row\('Contact number'/);
 assert.match(profile,/row\('Address', p\.address, \(v\) => v, true\)/);
 assert.match(profile,/id="statusBtn"/);
 assert.match(profile,/id="archiveBtn"/);
 assert.match(profile,/can\('people:write'\) && !archived/);
});

test('Sidebar uses the uploaded LIFEGEN wordmark without duplicating its text',()=>{
 assert.match(shell,/<a class="brand sidebar-brand"/);
 assert.match(shell,/class="sidebar-brand__logo" src="\/admin\/assets\/lifegen-sidebar-logo\.webp"/);
 assert.match(shell,/alt="LIFEGEN"/);
 assert.match(shell,/class="brand brand--compact"/);
 assert.match(css,/\.sidebar \.sidebar-brand__logo/);
 assert.match(css,/object-fit:contain/);
});
