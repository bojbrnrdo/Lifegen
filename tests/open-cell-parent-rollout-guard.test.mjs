import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../src/lifegroups.js',import.meta.url),'utf8');
test('parent assignment requires approved column',()=>{
 assert.match(s,/column_name='parent_membership_id'/);
 assert.match(s,/Parent assignments require the approved database migration/);
});
test('Open Cell parent is validated before membership writes',()=>{
 const guard=s.indexOf('if(requestedParent){');
 const validate=s.indexOf('validateOpenCellParent(',guard);
 const mutation=s.indexOf("await client.query('UPDATE lifegroup_memberships",guard);
 assert.ok(guard>=0&&validate>guard&&mutation>validate);
});
test('new parent-linked memberships persist parent ID transactionally',()=>{
 assert.match(s,/INSERT INTO lifegroup_memberships\(id,person_id,lifegroup_id,role,tier,joined_at,notes,assigned_by,parent_membership_id\)/);
});
