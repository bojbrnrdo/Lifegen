import {httpError} from './domain.js';

// Called inside the same transaction that changes a membership.
export async function assertNotLeaderMembership(client,personId,groupId) {
 const {rows}=await client.query(`SELECT EXISTS(
   SELECT 1 FROM networks WHERE leader_person_id=$1 AND is_active=true
   UNION ALL SELECT 1 FROM lifegroups WHERE leader_person_id=$1 AND is_active=true
 ) AS leads_structure`,[personId]);
 if(rows[0]?.leads_structure)throw httpError(403,'Leadership memberships require administrator review.');
 const {rows:members}=await client.query('SELECT role FROM lifegroup_memberships WHERE person_id=$1 AND lifegroup_id=$2 AND left_at IS NULL',[personId,groupId]);
 if(members.some(m=>m.role!=='member'))throw httpError(403,'Leadership memberships require administrator review.');
}
