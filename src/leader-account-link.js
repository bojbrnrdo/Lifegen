import {httpError} from './domain.js';

// The account-to-person link is an identity association, not an authorization grant.
// Network and Cell access must be independently validated against active memberships.
export function normalizeLinkedPersonId(value) {
 if (value === undefined) return undefined;
 if (value === null || value === '') return null;
 const id = Number(value);
 if (!Number.isSafeInteger(id) || id < 1 || String(value).trim() !== String(id)) {
  throw httpError(400, 'Select a valid People record.');
 }
 return id;
}

export async function assertLinkablePerson(client,personId,accountId=null) {
 if (personId == null) return;
 const {rows} = await client.query('SELECT id,archived_at FROM people WHERE id=$1', [personId]);
 if (!rows[0] || rows[0].archived_at) throw httpError(409, 'Choose an unarchived People record.');
 const linked = await client.query('SELECT id FROM staff_users WHERE person_id=$1 AND ($2::bigint IS NULL OR id<>$2::bigint) LIMIT 1', [personId,accountId]);
 if (linked.rows.length) throw httpError(409, 'This People record is already linked to a staff account.');
}
