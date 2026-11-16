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
