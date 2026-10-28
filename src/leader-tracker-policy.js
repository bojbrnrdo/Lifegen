import {httpError} from './domain.js';
import {resolveLeaderScope,assertLeaderScope} from './leader-scope.js';

// Linked leaders may only access a single, explicitly identified Network or
// Cell. Missing, malformed, or collection-style requests fail closed rather
// than falling through to broad detail reads.
function requiredScopedId(value) {
 if (typeof value !== 'number' && typeof value !== 'string') throw httpError(403,'A specific assigned Network or Cell is required.');
 const raw=String(value);
 if (!/^[1-9][0-9]*$/.test(raw)) throw httpError(403,'A specific assigned Network or Cell is required.');
 const id=Number(raw);
 if (!Number.isSafeInteger(id)) throw httpError(403,'A specific assigned Network or Cell is required.');
 return id;
}

// All other tracker operations are denied for linked leaders until scoped
// collection reads and write ownership checks are implemented end to end.
export async function authorizeLinkedLeaderTrackerMethod(client,actor,method,args=[]) {
 if (actor?.role_id==='admin') return;
 const scope=await resolveLeaderScope(client,actor);
 // Unlinked accounts retain the existing Admin/Staff/Viewer permission model.
 if (!scope.linked) return;
 if (method==='people' && scope.kind!=='unassigned') return {allowedCellIds:scope.cellIds};
 if (method==='person') {
  const personId=requiredScopedId(args[0]);
  if (scope.kind==='unassigned' || !scope.cellIds.length) throw httpError(403,'This Person is outside your assigned Cells.');
  const {rows}=await client.query('SELECT 1 FROM lifegroup_memberships lm JOIN lifegroups g ON g.id=lm.lifegroup_id JOIN people p ON p.id=lm.person_id WHERE lm.person_id=$1 AND p.archived_at IS NULL AND lm.left_at IS NULL AND g.is_active=true AND g.id=ANY($2::bigint[]) LIMIT 1',[personId,scope.cellIds]);
  if (!rows.length) throw httpError(403,'This Person is outside your assigned Cells.');
  return;
 }
 if (method==='setTier' || method==='leaveLifegroup' || method==='assignLifegroup') {
  const cellId=requiredScopedId(args[0]);
  requiredScopedId(args[1]);
  return assertLeaderScope(scope,{cellId});
 }
 if (method==='network') return assertLeaderScope(scope,{networkId:requiredScopedId(args[0])});
 if (method==='lifegroup') return assertLeaderScope(scope,{cellId:requiredScopedId(args[0])});
 throw httpError(403,'This action requires a scope-aware leader implementation.');
}
