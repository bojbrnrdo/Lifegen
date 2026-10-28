import {httpError} from './domain.js';
import {resolveLeaderScope,assertLeaderScope} from './leader-scope.js';

// Until query filtering and write ownership are implemented for the other
// operations, linked non-admin accounts may only use scoped detail reads.
// This explicit allowlist prevents a new tracker RPC from silently bypassing
// the authorization boundary.
export async function authorizeLinkedLeaderTrackerMethod(client,actor,method,args=[]) {
 if (actor?.role_id==='admin') return;
 const scope=await resolveLeaderScope(client,actor);
 // Preserve the existing staff and viewer model for accounts not opted into
 // leader-specific access; no production account is linked by this PR.
 if (scope.kind==='unassigned') {
  const {rows}=await client.query('SELECT person_id FROM staff_users WHERE id=$1 AND is_active=true',[actor.id]);
  if (!rows[0]?.person_id) return;
 }
 if (method==='network') return assertLeaderScope(scope,{networkId:args[0]});
 if (method==='lifegroup') return assertLeaderScope(scope,{cellId:args[0]});
 throw httpError(403,'This action requires a scope-aware leader implementation.');
}
