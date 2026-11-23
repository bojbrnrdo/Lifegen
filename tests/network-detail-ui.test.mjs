
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleCode = readFileSync(new URL('../public/admin/js/views/networkDetailUI.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../public/admin/js/views/lifegroups.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/admin/styles.css', import.meta.url), 'utf8');

test('Network detail uses a separate compact workspace instead of removing real groups', () => {
  assert.match(view, /simplifyNetworkDetail\(main, \{ cells, cal, manage, leaderRegistered: Boolean\(n\.leader_person_id\) \}\)/);
  assert.match(moduleCode, /workspace\.append\(structure\)/);
  assert.match(moduleCode, /structure\.querySelector\('\.tree__node--root'\)/);
  assert.match(moduleCode, /network-detail__stats/);
  assert.match(css, /network-detail__workspace/);
});

test('the attendance history and meeting report are gone from the Network page', () => {
  // Removed on request: the "Attendance & meeting history" disclosure, its
  // eight-week grid, the "Report meeting" action and the "Meetings this week"
  // figure. The calendar data is still fetched because the structure and the
  // leader team depend on it, so the element must be removed, not left orphaned.
  // Assert on the markup, not on the words: the file explains the removal in a
  // comment, and a bare phrase check would match that instead.
  assert.doesNotMatch(moduleCode, /history\.id = 'netAttendanceHistory'/);
  assert.doesNotMatch(moduleCode, /'<summary><span><strong>Attendance/);
  assert.doesNotMatch(moduleCode, /textContent = 'Meetings this week'/);
  assert.doesNotMatch(moduleCode, /textContent = 'Report meeting'/);
  assert.doesNotMatch(moduleCode, /history\.append\(calendar\)/);
  assert.match(moduleCode, /calendar\.remove\(\)/, 'the calendar element is removed from the page');
  // The button is no longer built at all, so nothing has to remove it either.
  assert.doesNotMatch(view, /id="netReport"/, 'no report button is rendered');
  assert.doesNotMatch(view, /#netReport'\).onclick/, 'no handler is bound to the removed button');
  // No on-demand loader may be registered for a disclosure that no longer exists.
  assert.doesNotMatch(view, /compact\.history\.addEventListener/);
  assert.doesNotMatch(view, /netAttendanceHistory/);
});

test('Creating a Lifegroup from its Network defaults to the correct Network and category', () => {
  assert.match(view, /groupForm\(null, \(\) => renderNetwork\(\{ main \}, id\), \{ networkId: n\.id, gender: n\.gender \}\)/);
  assert.match(view, /const selectedNetworkId = g\?\.network_id \?\? networkId/);
  assert.match(view, /const selectedGender = g\?\.gender \?\? gender/);
});

test('Network editing, membership, cell-leader actions and history are retained', () => {
  assert.match(view, /main\.querySelector\('#editNet'\)/);
  assert.match(view, /main\.querySelector\('#addCellLeader'\)/);
  assert.match(view, /main\.querySelectorAll\('\[data-add-member\]'\)/);
  assert.match(view, /bindMemberActions\(main, groupsById, refresh\)/);
  assert.match(moduleCode, /main\.querySelector\('#netCalendar'\)/);
  assert.match(moduleCode, /aside\.querySelector\('#netExtras'\)/);
});
