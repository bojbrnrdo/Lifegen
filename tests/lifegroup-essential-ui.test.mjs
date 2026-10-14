import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('../public/admin/js/views/lifegroups.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/lifegroups.js', import.meta.url), 'utf8');
const part = (from, to) => {
  const start = view.indexOf(from);
  const stop = view.indexOf(to, start + from.length);
  assert.ok(start >= 0 && stop > start, 'UI section missing: ' + from);
  return view.slice(start, stop);
};
const group = part('async function groupForm(', 'export async function findLifegroup(');
const member = part('export function addMemberDialog(', '/** Per-person edit menu');
const network = part('async function networkForm(', 'export async function renderNetwork(');
const groupPage = part('export async function renderLifegroup(', '// Networks:');
const networkPage = view.slice(view.indexOf('export async function renderNetwork('));

test('New/Edit Lifegroup only requests identity, category, Network, leader and active status', () => {
  for (const name of ['name', 'gender', 'network_id', 'leader_person_id']) {
    assert.match(group, new RegExp('name="' + name + '"'));
  }
  for (const optional of ['category', 'schedule_day', 'schedule_time', 'venue', 'notes']) {
    assert.doesNotMatch(group, new RegExp('name="' + optional + '"'));
  }
  assert.match(group, /api\.updateLifegroup\(g\.id, d\)/);
  assert.match(group, /api\.createLifegroup\(d\)/);
});

test('Network editor retains registered-leader linking and no longer asks for notes', () => {
  assert.match(network, /id="netLeaderId"/);
  assert.match(network, /networkLeaderRegistrationHtml\(\)/);
  assert.match(network, /name="gender"/);
  assert.doesNotMatch(network, /name="notes"/);
  assert.match(network, /api\.updateNetwork\(n\.id, data\)/);
});

test('Member assignment has only person and role; server supplies joined date automatically', () => {
  assert.match(member, /id="memberPick"/);
  assert.match(member, /id="memberRole"/);
  assert.doesNotMatch(member, /id="joinedAt"/);
  assert.doesNotMatch(member, /joined_at:/);
  assert.match(member, /api\.assignLifegroup\(g\.id, pid/);
  assert.match(server, /const joined = clean\(extra\.joined_at\) \|\| today\(\)/);
});

test('Group overview focuses on people and leadership, without optional logistics', () => {
  assert.match(groupPage, /<h2>Leadership<\/h2>/);
  assert.doesNotMatch(groupPage, /<span class="stat__label">Schedule<\/span>/);
  for (const key of ['Day','Time','Venue','Notes']) {
    assert.doesNotMatch(groupPage, new RegExp('<dt>' + key + '</dt>'));
  }
  assert.match(groupPage, /Former members/);
  assert.match(groupPage, /<details class="card mt-2">/);
  assert.match(groupPage, /renderProgressCard\(/);
});

test('Existing schedule, venue and notes are preserved by server-side update semantics', () => {
  assert.match(server, /const src = existing \? \{ \.\.\.existing, \.\.\.body \} : body;/);
  assert.match(server, /schedule_day: clean\(src\.schedule_day\)/);
  assert.match(server, /schedule_time: clean\(src\.schedule_time\)/);
  assert.match(server, /venue: stringField\(src\.venue/);
  assert.match(server, /notes: stringField\(src\.notes/);
  assert.match(networkPage, /renderNetworkCalendar\(/);
  assert.doesNotMatch(networkPage, /\$\{n\.notes \? html/);
});
