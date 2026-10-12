import test from 'node:test';
import assert from 'node:assert/strict';
import { digits } from '../src/read-model.js';

// The Admin People search matches phone numbers with
//   regexp_replace(contact_number,'[^0-9]','','g') LIKE '%' || digits(q) || '%'
// so `digits` must strip every non-digit character. A regression here (for example
// an escaped `/\\D/` matching a literal backslash+D) makes searches by formatted
// contact numbers return zero rows.
test('digits strips spaces, dashes and every other non-digit character', () => {
  assert.equal(digits('0917 555 1234'), '09175551234');
  assert.equal(digits('555-1234'), '5551234');
  assert.equal(digits('(02) 8123-4567'), '0281234567');
  assert.equal(digits('09175551234'), '09175551234');
  assert.equal(digits('abc12def34'), '1234');
  assert.equal(digits(''), '');
  assert.equal(digits(null), '');
  assert.equal(digits(undefined), '');
});
