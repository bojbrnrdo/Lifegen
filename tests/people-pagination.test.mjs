import test from 'node:test';
import assert from 'node:assert/strict';
import { safePeoplePageOffset } from '../src/read-model.js';

test('valid People directory page offsets remain unchanged', () => {
 for (const [value,expected] of [[0,0],[50,50],['100',100],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]])
  assert.equal(safePeoplePageOffset(value),expected);
});
test('invalid, fractional and unsafe page offsets reset to first page', () => {
 for (const value of [-1,'-50',0.5,'2.4',Infinity,-Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'not-a-number',{},[]])
  assert.equal(safePeoplePageOffset(value),0);
});
