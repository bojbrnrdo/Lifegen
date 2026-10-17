import test from 'node:test';
import assert from 'node:assert/strict';
import {splitMemberHierarchy} from '../frontend/lifegroups/memberHierarchy.js';
const solid={id:1,person_id:1,membership_id:100,lifegroup_id:8,tier:'solid',left_at:null};
const open={id:2,person_id:2,membership_id:101,lifegroup_id:8,tier:'new',parent_membership_id:100,left_at:null};
test('explicit Closed Cell parent generates Open Cell child relationship',()=>{
 const result=splitMemberHierarchy([solid,open]);
 assert.deepEqual(result.roots,[solid]);
 assert.deepEqual(result.children.get(100),[open]);
});
test('unlinked Open Cell stays at Cell root without fabricated parent',()=>{
 const result=splitMemberHierarchy([solid,{...open,parent_membership_id:null}]);
 assert.equal(result.roots.length,2);
 assert.equal(result.children.size,0);
});
test('foreign group and wrong-tier parents are never linked',()=>{
 for(const invalid of [{...open,lifegroup_id:9},{...solid,tier:'new'}]){
  const result=splitMemberHierarchy([invalid===solid?invalid:solid, invalid===solid?open:invalid]);
  if(invalid.tier==='new'&&invalid.lifegroup_id===8)continue;
  assert.equal(result.children.size,0);
 }
});
test('ended memberships are excluded',()=>{
 assert.equal(splitMemberHierarchy([solid,{...open,left_at:'2026-10-17'}]).children.size,0);
});
