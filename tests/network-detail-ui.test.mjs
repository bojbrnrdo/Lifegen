
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleCode = readFileSync(new URL('../public/admin/js/views/networkDetailUI.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../public/admin/js/views/lifegroups.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/admin/styles.css', import.meta.url), 'utf8');

test('Network detail uses a separate compact workspace instead of removing real groups', () => {
  assert.match(view, /simplifyNetworkDetail\(main, \{ cells, cal, manage \}\)/);
  assert.match(moduleCode, /workspace\.append\(structure\)/);
  assert.match(moduleCode, /structure\.querySelector\('\.tree__node--root'\)/);
  assert.match(moduleCode, /network-detail__stats/);
  assert.match(css, /network-detail__workspace/);
});

test('Detailed attendance remains available but is not shown on first load', () => {
  assert.match(moduleCode, /document\.createElement\('details'\)/);
  assert.match(moduleCode, /history\.id = 'netAttendanceHistory'/);
  assert.match(moduleCode, /history\.append\(calendar\)/);
  assert.match(view, /if \(!compact\.history\.open \|\| compact\.history\.dataset\.loaded\) return/);
  assert.match(view, /renderNetworkCalendar\(main\.querySelector\('#netCalendar'\), n\.id, cal\)/);
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
