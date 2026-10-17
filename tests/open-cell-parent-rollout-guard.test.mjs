import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../src/lifegroups.js',import.meta.url),'utf8');
test('parent assignment is gated on schema availability',()=>{
 assert.match(s,/column_name='parent_membership_id'/);
 assert.match(s,/awaiting the approved database migration/);
});
test('parent-linked requests cannot falsely succeed before persistence',()=>{
 const start=s.indexOf('if (extra.parent_membership_id !== undefined');
 const end=s.indexOf('const networkLeadership',start);
 assert.ok(start>0&&end>start);
 assert.match(s.slice(start,end),/validateOpenCellParent/);
 assert.match(s.slice(start,end),/Parent assignment persistence is not enabled yet/);
});
