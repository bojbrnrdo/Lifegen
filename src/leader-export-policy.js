import {httpError} from './domain.js';
import {resolveLeaderScope} from './leader-scope.js';

// Global data exports are not yet scoped. Fail closed for linked non-admin
// accounts, even if their legacy staff role includes report privileges.
export async function assertGlobalExportAccess(client,actor){
 if(actor?.role_id==='admin')return;
 const scope=await resolveLeaderScope(client,actor);
 if(scope.linked)throw httpError(403,'Global exports are unavailable for linked leader accounts.');
}
