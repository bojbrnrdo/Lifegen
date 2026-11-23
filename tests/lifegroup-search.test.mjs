import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  matchesQuery, filterPeople, rankPeople, relationshipLine, buildPeopleIndex, needsRows,
} from '../public/admin/js/views/lifegroupSearch.js';

const maria = {
  id: 7, first_name: 'Maria', last_name: 'Santos', person_code: 'P-0007',
  cell_name: 'James Cell', cell_leader_name: 'James Leader', network_name: 'Network Alpha', role: 'member',
};
const james = {
  id: 3, first_name: 'James', last_name: 'Leader', person_code: 'P-0003',
  cell_name: 'James Cell', network_name: 'Network Alpha', role: 'cell_leader',
};

test('an empty query matches everyone', () => {
  assert.equal(matchesQuery(maria, ''), true);
  assert.equal(filterPeople([maria, james], '   ').length, 2);
});

test('every typed word must match, so "james maria" finds Maria in James Cell', () => {
  assert.equal(matchesQuery(maria, 'maria'), true);
  assert.equal(matchesQuery(maria, 'james'), true);
  assert.equal(matchesQuery(maria, 'james maria'), true);
  assert.equal(matchesQuery(maria, 'james esther'), false);
  assert.equal(filterPeople([maria, james], 'james').length, 2);
});

test('search covers Person ID, Cell, Cell Leader and Network, not just the name', () => {
  assert.equal(matchesQuery(maria, 'p-0007'), true);
  assert.equal(matchesQuery(maria, 'james cell'), true);
  assert.equal(matchesQuery(maria, 'alpha'), true);
  assert.equal(filterPeople([maria, james], 'beta').length, 0);
});

test('matching ignores case and extra spacing', () => {
  assert.equal(matchesQuery(maria, '  MARIA   santos '), true);
});

test('ranking puts an exact name or Person ID first, then alphabetical', () => {
  const anna = { first_name: 'Anna', last_name: 'Reyes', person_code: 'P-0009' };
  const mariana = { first_name: 'Mariana', last_name: 'Cruz', person_code: 'P-0010' };
  const ranked = rankPeople([mariana, anna, maria], 'maria');
  assert.equal(ranked[0].first_name, 'Maria');
  assert.deepEqual(rankPeople([maria, anna], '').map((p) => p.first_name), ['Anna', 'Maria']);
  assert.equal(rankPeople([maria, anna], 'p-0007')[0].first_name, 'Maria');
});

test('a row says where the person sits in plain words', () => {
  assert.equal(relationshipLine(maria), 'Member · James Cell · Network Alpha');
  assert.equal(relationshipLine(james), 'Cell Leader · James Cell · Network Alpha');
  assert.equal(relationshipLine({ first_name: 'New' }), 'Not in a Cell yet');
  assert.equal(relationshipLine({ ...maria, role: 'network_leader' }), 'Network Leader · James Cell · Network Alpha');
});

test('the People index is built from the Cells the page already loaded', () => {
  const index = buildPeopleIndex({
    networks: [{ id: 1, name: 'Alpha' }],
    groups: [
      { id: 10, name: 'James Cell', leader_name: 'James Leader', leader_person_id: 3, network_id: 1, member_count: 6 },
      { id: 11, name: 'Alpha Leaders', leader_name: 'Aaron Alpha', leader_person_id: 26, network_id: 1, member_count: 2, leads_network: true },
      { id: 12, name: 'No Leader Cell', leader_name: '', leader_person_id: null, network_id: 1, member_count: 0 },
    ],
  });
  assert.equal(index.length, 2, 'a Cell with no leader is not a person row');
  assert.deepEqual(index[0], {
    id: 3, first_name: 'James Leader', cell_id: 10, cell_name: 'James Cell',
    network_id: 1, network_name: 'Alpha', role: 'cell_leader', member_count: 6,
  });
  assert.equal(index[1].role, 'network_leader');
  assert.equal(relationshipLine(index[1]), 'Network Leader · Alpha Leaders · Network Alpha');
  const beta = buildPeopleIndex({ networks: [{ id: 2, name: 'Network Beta' }], groups: [{ id: 20, name: 'Ruth Cell', leader_name: 'Ruth Leader', network_id: 2 }] });
  assert.equal(relationshipLine(beta[0]), 'Cell Leader · Ruth Cell · Network Beta', 'never prints "Network" twice');
});

test('the Needs a Cell queue uses the same row shape', () => {
  const rows = needsRows([{ id: 5, first_name: 'Spare', last_name: 'Boy', person_code: 'P-0005' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, '');
  assert.equal(relationshipLine(rows[0]), 'Not in a Cell yet');
  assert.equal(needsRows(undefined).length, 0);
});

test('a linked Cell Leader never sees the administrator find box', () => {
  const view = readFileSync(new URL('../public/admin/js/views/lifegroups.js', import.meta.url), 'utf8');
  const start = view.indexOf('export async function renderLifegroups(');
  const leaderView = view.indexOf('<h1>My Lifegroups</h1>', start);
  const leaderReturn = view.indexOf('  return;', leaderView);
  const findPanel = view.indexOf('id="findPersonPanel"', start);
  assert.ok(leaderView > start, 'the leader-scoped branch exists');
  assert.ok(leaderReturn > leaderView, 'the leader-scoped branch returns early');
  assert.ok(findPanel > leaderReturn, 'the find box is only reachable after that early return');
});

test('the find box uses one read-only index endpoint', () => {
  const view = readFileSync(new URL('../public/admin/js/views/lifegroups.js', import.meta.url), 'utf8');
  assert.match(view, /api\.lifegroupPeopleIndex\(4000\)/);
  assert.match(view, /loadPeopleIndex/);
});

// ---------------------------------------------------------------------------
// The numbers at the top of the page: what is true, and what needs fixing.
// ---------------------------------------------------------------------------
import { lifegroupHeadline } from '../public/admin/js/views/hierarchy.js';

const fixture = () => ({
  networks: [
    { id: 1, name: 'Pastor Boys', leader_name: 'Arsie', parent_network_id: null, gender: 'boys', is_active: true },
    { id: 2, name: 'Roxxane Network', leader_name: 'Roxxane', parent_network_id: 1, gender: 'boys', is_active: true },
    { id: 3, name: 'Nobody Network', leader_name: '', parent_network_id: 1, gender: 'boys', is_active: true },
  ],
  groups: [
    { id: 10, name: 'Kai Cell', leader_name: 'Kai', network_id: 2, gender: 'boys', member_count: 6, is_active: true },
    { id: 11, name: 'Empty Cell', leader_name: 'Lea', network_id: 3, gender: 'boys', member_count: 0, is_active: true },
    { id: 12, name: 'Orphan Cell', leader_name: 'Sol', network_id: 99, gender: 'boys', member_count: 2, is_active: true },
    { id: 13, name: 'Gone Cell', leader_name: 'Old', network_id: 2, gender: 'boys', member_count: 4, is_active: false },
  ],
});

test('the headline counts what the page actually shows', () => {
  const { networks, groups } = fixture();
  const active = lifegroupHeadline(networks, groups, { status: 'active' });
  assert.equal(active.pastors, 1, 'one pastor at the root');
  assert.equal(active.networks, 3);
  assert.equal(active.cells, 3, 'the removed Cell is not counted as active');
  assert.equal(active.cellLeaders, 3, 'no leader-team Cells in this fixture');
  assert.equal(active.members, 8, '6 + 0 + 2 — a Cell with no Network still has people');
  assert.equal(active.looseNetworks, 0, 'nothing sits outside a pastor here');
});

test('a Network with no leader and a Cell with no Network both need attention', () => {
  const { networks, groups } = fixture();
  const active = lifegroupHeadline(networks, groups, { status: 'active' });
  assert.equal(active.withoutLeader, 1, 'Nobody Network has no Network Leader');
  assert.equal(active.unconnected, 1, 'Orphan Cell has no Network');
  assert.equal(active.attention, 2);
});

test('once everything is connected the page says so instead of shouting', () => {
  const { networks } = fixture();
  const tidy = [
    { id: 10, name: 'Kai Cell', leader_name: 'Kai', network_id: 2, gender: 'boys', member_count: 6, is_active: true },
  ];
  const clean = lifegroupHeadline(networks.map((n) => (n.id === 3 ? { ...n, leader_name: 'Zeff' } : n)), tidy, { status: 'active' });
  assert.equal(clean.attention, 0);
  assert.equal(clean.unconnected, 0);
  assert.equal(clean.withoutLeader, 0);
});

test('the gender filter changes the numbers, not just the list', () => {
  const networks = [
    { id: 1, name: 'Boys', leader_name: 'A', parent_network_id: null, gender: 'boys', is_active: true },
    { id: 2, name: 'Girls', leader_name: 'B', parent_network_id: null, gender: 'girls', is_active: true },
  ];
  const groups = [
    { id: 10, name: 'B1', leader_name: 'x', network_id: 1, gender: 'boys', member_count: 3, is_active: true },
    { id: 20, name: 'G1', leader_name: 'y', network_id: 2, gender: 'girls', member_count: 5, is_active: true },
  ];
  assert.equal(lifegroupHeadline(networks, groups, { gender: 'girls' }).members, 5);
  assert.equal(lifegroupHeadline(networks, groups, { gender: 'boys' }).members, 3);
  assert.equal(lifegroupHeadline(networks, groups, {}).members, 8);
});

test('leaders counted in their leader-team Cell are still people in Cells', () => {
  const networks = [
    { id: 1, name: 'Pastor', leader_name: 'Arsie', parent_network_id: null, gender: 'boys', is_active: true },
    { id: 2, name: 'Roxxane Network', leader_name: 'Roxxane', parent_network_id: 1, gender: 'boys', is_active: true },
  ];
  const groups = [
    // The pastor's own Cell holds the Network Leaders; the Network's Cell holds the Cell Leaders.
    { id: 10, name: 'Arsie Leaders', leader_name: 'Arsie', network_id: 1, gender: 'boys', member_count: 3, leads_network: true, is_active: true },
    { id: 11, name: 'Roxxane Leaders', leader_name: 'Roxxane', network_id: 2, gender: 'boys', member_count: 3, leads_network: true, is_active: true },
    { id: 12, name: 'Kai Cell', leader_name: 'Kai', network_id: 2, gender: 'boys', member_count: 6, is_active: true },
  ];
  const h = lifegroupHeadline(networks, groups, { status: 'active' });
  assert.equal(h.members, 12, '3 + 3 leaders + 6 members, nobody is double-counted or dropped');
  assert.equal(h.cells, 3, 'every Cell, including the two leader-team Cells');
  assert.equal(h.cellLeaders, 1, 'only Kai Cell is a Cell Leader\'s Cell; the other two are leader-team Cells');
});
