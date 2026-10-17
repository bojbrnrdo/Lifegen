import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/admin/js/views/unifiedAddNew.js',import.meta.url),'utf8');
test('Member registration offers Closed Cell and Open Cell',()=>{
 assert.match(source,/name="member_tier" value="solid" checked/);
 assert.match(source,/name="member_tier" value="new"/);
});
test('Open Cell requires explicitly selected Closed Cell parent',()=>{
 assert.match(source,/loadClosedCellParents/);
 assert.match(source,/Choose a Closed Cell parent before registering/);
 assert.match(source,/parent_membership_id:parentMembershipId/);
});
test('member registration sends selected classification to assignment API',()=>{
 assert.match(source,/api.assignLifegroup\(cellId,created.id,\{role:'member',tier:memberTier/);
});
