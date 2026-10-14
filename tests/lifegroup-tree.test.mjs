import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifegroupTree, findUnassignedGroups, arrangeLifegroupTree } from '../public/admin/js/views/hierarchy.js';

const network = { id: 1, name: 'Network A', leader_name: 'Network Leader', leader_person_id: null, gender: 'boys', is_active: true };
const group = { id: 10, name: 'Cell A', leader_name: 'Cell Leader', leader_person_id: null, network_id: null, gender: 'boys', member_count: 0, is_active: true };
const build = (nets, groups, expanded = new Set(), members = new Map(), filters = { status: 'active' }) =>
  buildLifegroupTree(nets, groups, filters, expanded, members, new Set());

test('unassigned Lifegroups are flagged instead of rendered as fake network roots', () => {
  const roots = build([network], [group]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].kind, 'network');
  assert.equal(roots[0].count, 0);
  assert.equal(roots[0].children.length, 0);
  assert.equal(findUnassignedGroups([network], [group]).length, 1);
});

test('assigning a Lifegroup to a Network makes the cell leader visible on expansion', () => {
  const connected = { ...group, network_id: network.id };
  const roots = build([network], [connected], new Set(['network:1']));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].children.length, 1);
  assert.equal(roots[0].children[0].name, 'Cell Leader');
  assert.equal(findUnassignedGroups([network], [connected]).length, 0);
});

test('network leader own Lifegroup is not duplicated as a cell leader', () => {
  const n = { ...network, leader_person_id: 7 };
  const own = { ...group, id: 11, leader_person_id: 7, network_id: n.id };
  const other = { ...group, id: 12, leader_person_id: 8, network_id: n.id };
  const roots = build([n], [own, other], new Set(['network:1']));
  assert.equal(roots[0].children.length, 1);
  assert.equal(roots[0].children[0].key, 'group:12');
});

test('member statuses and assistant leadership display correctly after expansion', () => {
  const connected = { ...group, network_id: network.id, member_count: 2 };
  const expanded = new Set(['network:1', 'group:10']);
  const members = new Map([['group:10', [
    { id: 51, first_name: 'Sample', last_name: 'One', role: 'member', status: 'regular' },
    { id: 52, first_name: 'Sample', last_name: 'Two', role: 'assistant', status: 'member' },
  ]]]);
  const roots = build([network], [connected], expanded, members);
  const cellMembers = roots[0].children[0].children;
  assert.equal(cellMembers.length, 2);
  assert.equal(cellMembers[0].subtitle, 'regular');
  assert.equal(cellMembers[1].subtitle, 'Assistant leader');
  const layout = arrangeLifegroupTree(roots);
  assert.equal(layout.nodes.length, 4);
  assert.equal(layout.lines.length, 3);
});

test('activity and gender filters preserve the correct groups', () => {
  const inactive = { ...group, is_active: false };
  const girl = { ...group, id: 90, gender: 'girls' };
  assert.equal(findUnassignedGroups([network], [inactive], { status: 'active' }).length, 0);
  assert.equal(findUnassignedGroups([network], [inactive], { status: 'inactive' }).length, 1);
  assert.equal(findUnassignedGroups([network], [girl], { gender: 'boys' }).length, 0);
  assert.equal(build([{ ...network, is_active: false }], [], new Set(), new Map(), { status: 'active' }).length, 0);
});

test('missing network IDs remain explicitly unassigned', () => {
  const dangling = { ...group, network_id: 888 };
  assert.equal(findUnassignedGroups([network], [dangling]).length, 1);
  assert.equal(build([network], [dangling]).length, 1);
});
