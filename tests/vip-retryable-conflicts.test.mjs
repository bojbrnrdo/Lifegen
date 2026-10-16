import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/lifegroups.js',import.meta.url),'utf8');
const assign=source.slice(source.indexOf('async function assignMember('),source.indexOf('/** Assign an ungrouped person'));
const auto=source.slice(source.indexOf('async function autoAssignMember('),source.indexOf('async function leaveMember('));
test('only explicitly tagged cell conflicts are retried during auto-assignment',()=>{
 assert.match(auto,/error\.status !== 409 \|\| error\.retryableVipCell !== true/);
 assert.match(source,/error\.retryableVipCell = true/);
});
test('cell eligibility failures and full capacity are tagged for alternate Cell selection',()=>{
 assert.match(assign,/retryableVipCellConflict\('Cell requires an assigned leader/);
 assert.match(assign,/retryableVipCellConflict\('Cell, parent Network and Cell Leader/);
 assert.match(assign,/extra\.auto_assign \? retryableVipCellConflict\('Network has reached/);
 assert.match(assign,/extra\.auto_assign \? retryableVipCellConflict\('Cell Leader has reached/);
});
test('person-specific validation is not marked as retryable',()=>{
 assert.match(assign,/throw httpError\(409, 'Inactive People records cannot be automatically assigned\.'/);
 assert.match(assign,/throw httpError\(409, 'Active leaders require manual review before Cell assignment\.'/);
 assert.ok(assign.includes('does not match this ${group.gender} Lifegroup.'), 'Gender mismatch remains an untagged person validation error');
});

test('deactivated candidate Cell is retryable only in automatic placement',()=>{
 assert.match(assign,/if \(!group\.is_active\) throw \(extra\.auto_assign \? retryableVipCellConflict\(/);
 assert.match(assign,/ : httpError\(409, 'This Lifegroup is inactive\./);
});
