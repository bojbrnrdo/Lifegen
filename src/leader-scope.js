import {httpError} from './domain.js';

// This module deliberately makes no authorization decision based on a supplied
// network ID. Scope must be computed from the authenticated account's linked
// person and current, active database leadership relationships.
export async function resolveLeaderScope(client,actor) {
 if (!actor || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id)<1)
  throw httpError(401,'Please sign in to the tracker.');
 if (actor.role_id==='admin') return {kind:'admin',networkIds:[],cellIds:[]};
 const {rows:accounts}=await client.query('SELECT person_id FROM staff_users WHERE id=$1 AND is_active=true',[actor.id]);
 const personId=accounts[0]?.person_id;
 if (!personId) return {kind:'unassigned',networkIds:[],cellIds:[]};
 const {rows:networks}=await client.query('SELECT id FROM networks WHERE leader_person_id=$1 AND is_active=true ORDER BY id',[personId]);
 const {rows:cells}=await client.query('SELECT g.id,g.network_id FROM lifegroups g LEFT JOIN networks n ON n.id=g.network_id WHERE g.leader_person_id=$1 AND g.is_active=true AND (g.network_id IS NULL OR n.is_active=true) ORDER BY g.id',[personId]);
 const networkIds=networks.map(row=>Number(row.id));
 const ownCellIds=cells.map(row=>Number(row.id));
 const {rows:networkCells}=networkIds.length
  ?await client.query('SELECT id FROM lifegroups WHERE network_id=ANY($1::bigint[]) AND is_active=true ORDER BY id',[networkIds])
  :{rows:[]};
 const cellIds=[...new Set([...ownCellIds,...networkCells.map(row=>Number(row.id))])];
 return {kind:networkIds.length?'network_leader':ownCellIds.length?'cell_leader':'unassigned',networkIds,cellIds};
}

export function assertLeaderScope(scope,{networkId,cellId}={}) {
 if (scope?.kind==='admin') return;
 if (!scope || !['network_leader','cell_leader'].includes(scope.kind))
  throw httpError(403,'No active Network or Cell leadership is linked to this account.');
 if (networkId!==undefined && !scope.networkIds.includes(Number(networkId)))
  throw httpError(403,'This Network is outside your assigned scope.');
 if (cellId!==undefined && !scope.cellIds.includes(Number(cellId)))
  throw httpError(403,'This Cell is outside your assigned scope.');
}
