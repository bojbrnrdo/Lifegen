import {randomToken,hashToken,cookieOptions} from './auth.js';
import {query,transaction} from './db.js';
import {httpError} from './domain.js';

const enabled=()=>process.env.ATTENDEE_PASSES_ENABLED==='true';
export function attendeePassesEnabled(){return enabled();}
export async function issueNewAttendeePass(client,personId){
 if(!enabled())return null;
 if(!Number.isSafeInteger(Number(personId))||Number(personId)<1)throw httpError(400,'Invalid attendee.');
 // Only call after a genuinely NEW registration is created. Never issue a
 // bearer pass to a request merely because its email matches an existing person.
 const pass='LGAP-'+randomToken();
 await client.query('INSERT INTO attendee_passes(person_id,token_hash) VALUES($1,$2)',[personId,hashToken(pass)]);
 return pass;
}
export async function restoreAttendeePass(req,res,pass){
 if(!enabled())throw httpError(503,'Account-free attendee passes are not active.');
 if(typeof pass!=='string'||!/^LGAP-[A-Za-z0-9_-]{43}$/.test(pass))throw httpError(400,'Invalid attendee recovery pass.');
 const sessionToken=randomToken(),csrf=randomToken();
 const person=await transaction(async client=>{
  const row=(await client.query(`SELECT ap.person_id FROM attendee_passes ap JOIN people p ON p.id=ap.person_id
   WHERE ap.token_hash=$1 AND ap.revoked_at IS NULL AND ap.expires_at>now() AND p.archived_at IS NULL
   FOR UPDATE OF ap`,[hashToken(pass)])).rows[0];
  if(!row)throw httpError(404,'Attendee pass expired or revoked. Contact LIFEGEN staff for recovery.');
  await client.query("INSERT INTO attendee_sessions(token_hash,person_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '90 days')",[hashToken(sessionToken),row.person_id,csrf]);
  return Number(row.person_id);
 });
 res.cookie('lg_attendee',sessionToken,{...cookieOptions(req),maxAge:90*86400000});
 return {person_id:person,csrf_token:csrf};
}
export async function readAttendeeSession(req,client={query}){
 if(!enabled())return null;
 const token=req.cookies?.lg_attendee;
 if(typeof token!=='string'||!token)return null;
 const result=await client.query(`SELECT s.person_id,s.csrf_token,p.full_name,p.first_name,p.last_name
   FROM attendee_sessions s JOIN people p ON p.id=s.person_id
   WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND p.archived_at IS NULL`,[hashToken(token)]);
 return result.rows[0]||null;
}