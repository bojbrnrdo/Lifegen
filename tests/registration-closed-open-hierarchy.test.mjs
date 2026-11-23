import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/admin/js/views/unifiedAddNew.js',import.meta.url),'utf8');

// The internal terms "Closed cell" / "Open cell" are gone from the form; the
// same two choices are offered in the words a volunteer actually uses.
test('Member registration offers Settled and New, and New is the default',()=>{
 assert.match(source,/name="member_tier" value="new" checked/);
 assert.match(source,/name="member_tier" value="solid"/);
 assert.match(source,/<b>Settled<\/b>/);
 assert.match(source,/<b>New<\/b>/);
 assert.doesNotMatch(source,/Closed cell|Open cell|Closed Cell|Open Cell/i);
});

test('no developer note about unsupported database relationships is shown',()=>{
 assert.doesNotMatch(source,/not yet supported|awaiting its database|parent relationship/i);
});

test('choosing New is saved, not rejected',()=>{
 // Both tiers are accepted by the membership API, so nothing may block New.
 assert.ok(!source.includes("memberTier==='new')return error"));
 assert.match(source,/api\.assignLifegroup\(cellId,created\.id,\{role:'member',tier:memberTier/);
});
