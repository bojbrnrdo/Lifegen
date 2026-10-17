import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOpenCellParent} from '../src/lifegroups.js';

const child={id:10,person_id:100,lifegroup_id:8,tier:'new',left_at:null};
const parent={id:11,person_id:101,lifegroup_id:8,tier:'solid',left_at:null};

test('Open Cell member may belong beneath active Closed Cell member in same group',()=>{
 assert.equal(validateOpenCellParent(child,parent),true);
});
for(const [title,c,p] of [
 ['reject non-Open Cell child',{...child,tier:'solid'},parent],
 ['reject non-Closed Cell parent',child,{...parent,tier:'new'}],
 ['reject same membership',child,{...parent,id:child.id}],
 ['reject same person',child,{...parent,person_id:child.person_id}],
 ['reject another Cell',child,{...parent,lifegroup_id:9}],
 ['reject ended Open Cell membership',{...child,left_at:'2026-01-01'},parent],
 ['reject ended Closed Cell parent',child,{...parent,left_at:'2026-01-01'}],
 ['reject missing parent',child,null],
])test(title,()=>assert.throws(()=>validateOpenCellParent(c,p)));
