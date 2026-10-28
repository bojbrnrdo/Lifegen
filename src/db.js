import 'dotenv/config';
import fs from 'node:fs';
import tls from 'node:tls';
import pg from 'pg';
import { domain, domainContext, DEFAULT_SETTINGS, httpError } from './domain.js';
const { Pool, Client, types } = pg;
types.setTypeParser(20, v => { const n=Number(v); if(!Number.isSafeInteger(n)) throw new Error('ID outside safe range'); return n; });
types.setTypeParser(1082, v => v);
types.setTypeParser(1184, v => new Date(v).toISOString());
export const WRITE_LOCK = 72114026;
const TABLES=['people','services','records','audit'];
const DELETE_ORDER=['records','audit','services','people'];
let pool;
const columnCache=new Map();
// Supabase database endpoints can present a project-minted CA chain that a hosting build
// machine (Vercel) does not carry in its root store, which surfaces as the PostgreSQL
// error "self-signed certificate in certificate chain". The optional private
// DATABASE_SSL_ROOT_CERT holds that Supabase project CA as PEM on the server only.
// Certificate verification is never turned off: Node's bundled Mozilla root certificates
// stay in the trust store and the project CA is added to them.
const CERTIFICATE_HEADER='-----BEGIN CERTIFICATE-----', CERTIFICATE_FOOTER='-----END CERTIFICATE-----';
export function supabaseRootCertificate(value=process.env.DATABASE_SSL_ROOT_CERT) {
 if(value===undefined||value===null) return null;
 const text=String(value).trim();
 if(!text) return null;
 // Values pasted into a hosting dashboard or CLI often arrive as one line with escaped \n.
 const pem=text.replace(/\\r\\n|\\n/g,'\n').replace(/\r\n?/g,'\n');
 if(!pem.includes(CERTIFICATE_HEADER)||!pem.includes(CERTIFICATE_FOOTER)) throw httpError(503,'DATABASE_SSL_ROOT_CERT must be the PEM-encoded Supabase project CA certificate (BEGIN/END CERTIFICATE lines). Set it as a private server variable only.');
 return pem;
}
let extraRootsWarned=false;
// An explicit `ca` list replaces Node's default trust store, which is where Node would have
// added NODE_EXTRA_CA_CERTS. Read that file here as well so an existing workaround for a
// private CA keeps working.
export function extraRootCertificates(file=process.env.NODE_EXTRA_CA_CERTS) {
 if(!file) return [];
 try{return [fs.readFileSync(file,'utf8')];}
 catch(e){if(!extraRootsWarned){extraRootsWarned=true;process.emitWarning(`Ignoring NODE_EXTRA_CA_CERTS: ${e.message}`);}return [];}
}
export function databaseTrustStore({rootCert,systemRoots=tls.rootCertificates,extraRoots}={}) {
 const projectCa=supabaseRootCertificate(rootCert===undefined?process.env.DATABASE_SSL_ROOT_CERT:rootCert);
 return [projectCa,...systemRoots,...(extraRoots===undefined?extraRootCertificates():extraRoots)].filter(Boolean);
}
export function databaseSslOptions({local=false,rootCert,systemRoots=tls.rootCertificates,extraRoots}={}) {
 if(local) return false;
 return {rejectUnauthorized:true,ca:databaseTrustStore({rootCert,systemRoots,extraRoots})};
}
export function connectionOptions(connectionString,{rootCert,extraRoots}={}) {
 if(!connectionString) throw httpError(503,'Supabase PostgreSQL is not configured. Set the private DATABASE_URL on the server and apply the database SQL migrations.');
 const u=new URL(connectionString); const host=u.hostname.replace(/^\[(.*)\]$/,'$1').toLowerCase(); const local=['localhost','127.0.0.1','::1'].includes(host);
 if(!['postgres:','postgresql:'].includes(u.protocol)) throw new Error('DATABASE_URL must be PostgreSQL.');
 // TLS is decided here, not by the connection string: only an explicit sslmode=disable (or
 // ssl=false) asks for plaintext. Every other value, including sslmode=require, keeps
 // verification of the server certificate chain.
 const plaintext=['disable','false','0'].includes(String(u.searchParams.get('sslmode')||u.searchParams.get('ssl')||'').trim().toLowerCase());
 u.searchParams.delete('sslmode'); u.searchParams.delete('ssl'); u.searchParams.delete('channel_binding');
 return {connectionString:u.toString(),ssl:local||plaintext?false:databaseSslOptions({rootCert,extraRoots}),connectionTimeoutMillis:15000,enableChannelBinding:!local&&!plaintext};
}
// Actionable, credential-free hints for the two failures that hide behind a generic
// PostgreSQL error: an untrusted certificate chain and an unreachable IPv6-only host.
export function connectionHint(error) {
 const text=`${error?.code||''} ${error?.message||''}`.toLowerCase();
 if(/self[-_ ]?signed|unable_to_verify_leaf|certificate_verify_failed|unable to verify the first certificate/.test(text)) return 'TLS trust: set the private DATABASE_SSL_ROOT_CERT variable to the Supabase project CA certificate (Supabase dashboard → Project Settings → Database → SSL configuration) and redeploy. Certificate verification must stay enabled.';
 if(/enetunreach|ehostunreach|eai_again|getaddrinfo/.test(text)) return 'Network: this runtime cannot reach the database host, which is often the IPv6-only direct Supabase host. Use the Supabase Session Pooler URL on port 5432 for DATABASE_DIRECT_URL and the pooler URL for DATABASE_URL.';
 return null;
}
export function getPool() { return pool ||= new Pool({...connectionOptions(process.env.DATABASE_URL),max:3,idleTimeoutMillis:10000,allowExitOnIdle:true}); }
export function directClient() {
 const url=process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
 if(url){const u=new URL(url);if(u.hostname.toLowerCase().includes('pooler')&&!['','5432'].includes(u.port))throw httpError(503,'Push updates and schema setup need a direct Supabase URL or the session pooler on port 5432. Automatic refresh will continue instead.');}
 return new Client(connectionOptions(url));
}
export const query=(text,params=[])=>getPool().query(text,params);
export async function transaction(fn,{write=true,dryRun=false}={}) {
 const client=await getPool().connect();
 try {
  await client.query(write?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  // Simple-protocol literal: the advisory lock returns no rows, and some embedded
  // PostgreSQL gateways desync their result stream on parameterised void queries.
  if(write) await client.query(`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`);
  const result=await fn(client);
  if(write) await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query(dryRun?'ROLLBACK':'COMMIT');
  return result;
 } catch(e) {await client.query('ROLLBACK').catch(()=>{}); throw e;} finally {client.release();}
}
async function columns(client,table) {
 if(!columnCache.has(table)) {
  const {rows}=await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1 ORDER BY ordinal_position',[table]);
  if(!rows.length) throw httpError(503,'Database schema is missing. Run npm run db:migrate first.');
  columnCache.set(table,rows.map(r=>r.column_name));
 }
 return columnCache.get(table);
}
function inflate(row) {
 const r={...(row.extras||{}),...row}; delete r.extras;
 for(const k of ['is_demo','is_active']) if(k in r) r[k]=r[k]?1:0;
 return r;
}
export async function loadState(client,{includeAudit=false,includeVipRegistrations=false,tables=TABLES}={}) {
 const data={version:2,settings:{...DEFAULT_SETTINGS},seq:{}};const selected=new Set(tables);
 // One consistent transaction snapshot. Hot read paths can request just their
 // dependencies; writes and backups explicitly request the complete state.
 for(const t of TABLES) data[t]=!selected.has(t)||(t==='audit'&&!includeAudit)?[]:(await client.query(`SELECT * FROM "${t}" ORDER BY id`)).rows.map(inflate);
 const settings=(await client.query('SELECT key,value FROM settings')).rows;
 for(const r of settings) data.settings[r.key]=r.value;
 const counters=(await client.query('SELECT entity,last_id FROM id_counters')).rows;
 for(const r of counters) data.seq[r.entity]=r.last_id;
 for(const t of TABLES) data.seq[t]=Math.max(data.seq[t]||0,...data[t].map(r=>r.id),0);
 data.vip_registrations=includeVipRegistrations?(await client.query('SELECT id,person_id,review_status,created_at FROM vip_registrations ORDER BY id')).rows:[];
 return data;
}
const defaults={people:{last_name:'',status:'first_timer',registration_source:'staff'},services:{service_type:'lifegen'},records:{source:'staff'}};
function packRow(row,cols,table) {
 const out={}; const known=new Set(cols); const extras={...(row.extras||{})};
 for(const [k,v] of Object.entries(row)) if(!known.has(k)) extras[k]=v;
 for(const c of cols) {
  if(c==='extras') {out[c]=extras;continue;}
  let v=row[c];
  if(v===undefined) {
   if(c==='is_active') v=true; else if(c==='is_demo') v=false;
   else if(['created_at','updated_at','recorded_at'].includes(c)) v=new Date().toISOString();
   else v=defaults[table]?.[c]??null;
  }
  if(['is_demo','is_active'].includes(c)) v=Boolean(v);
  if(['created_at','updated_at','recorded_at','archived_at'].includes(c) && v && /^\d{4}-\d{2}-\d{2} \d{2}:/.test(v)) v=v.replace(' ','T')+'Z';
  out[c]=v;
 }
 return out;
}
export async function upsertRows(client,table,rows) {
 if(!rows.length) return;
 const cols=await columns(client,table); const names=cols.map(c=>`"${c}"`).join(',');
 const updates=cols.filter(c=>c!=='id').map(c=>`"${c}"=EXCLUDED."${c}"`).join(',');
 for(let i=0;i<rows.length;i+=200) {
  const batch=rows.slice(i,i+200).map(r=>packRow(r,cols,table));
  await client.query(`INSERT INTO "${table}" (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::"${table}",$1::jsonb) ON CONFLICT(id) DO UPDATE SET ${updates}`,[JSON.stringify(batch)]);
 }
}
export async function logAction(client,actor,entity,id,action,details={}) {
 await client.query('INSERT INTO audit_log(actor_id,actor_name,entity,entity_id,action,details) VALUES($1,$2,$3,$4,$5,$6)',[actor?.id||null,actor?.display_name||'Migration / system',entity,id==null?null:String(id),action,JSON.stringify(details)]);
}
export async function flushState(client,before,after,actor) {
 const retainedPeople=new Set(after.people.map(p=>p.id));
 if(before.people.some(p=>!retainedPeople.has(p.id)))
  throw httpError(409,'People records cannot be permanently deleted by state synchronization. Archive them instead.');
 for(const t of DELETE_ORDER) {
  const ids=new Set(after[t].map(r=>r.id)); const removed=before[t].filter(r=>!ids.has(r.id));
  if(removed.length) {
   await client.query(`DELETE FROM "${t}" WHERE id=ANY($1::bigint[])`,[removed.map(r=>r.id)]);
   for(const r of removed) await logAction(client,actor,t,r.id,'delete');
  }
 }
 const logs=[];
 for(const t of TABLES) {
  const old=new Map(before[t].map(r=>[r.id,r])); const changed=after[t].filter(r=>JSON.stringify(r)!==JSON.stringify(old.get(r.id)));
  await upsertRows(client,t,changed);
  if(t!=='audit') for(const r of changed) logs.push({actor_id:actor?.id||null,actor_name:actor?.display_name||'Migration / system',entity:t,entity_id:String(r.id),action:old.has(r.id)?'update':'create',details:{fields:Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(old.get(r.id)?.[k]))}});
 }
 if(logs.length) await client.query('INSERT INTO audit_log(actor_id,actor_name,entity,entity_id,action,details) SELECT actor_id,actor_name,entity,entity_id,action,details FROM jsonb_to_recordset($1::jsonb) AS r(actor_id bigint,actor_name text,entity text,entity_id text,action text,details jsonb)',[JSON.stringify(logs)]);
 for(const [k,v] of Object.entries(after.settings)) if(JSON.stringify(v)!==JSON.stringify(before.settings[k])) {
  await client.query('INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[k,JSON.stringify(v)]);
  await logAction(client,actor,'settings',k,'update');
 }
 for(const [entity,n] of Object.entries(after.seq)) if(n!==(before.seq[entity]||0)) await client.query('INSERT INTO id_counters(entity,last_id) VALUES($1,$2) ON CONFLICT(entity) DO UPDATE SET last_id=GREATEST(id_counters.last_id,EXCLUDED.last_id)',[entity,n]);
}
export async function withState(fn,{actor=null,write=false,dryRun=false,tables=TABLES}={}) {
 return transaction(async client=>{
  const data=await loadState(client,{includeAudit:write,includeVipRegistrations:write,tables:write?TABLES:tables}); const before=structuredClone(data);
  const context={data,client,actor,dirty:false};
  const result=await domainContext.run(context,()=>fn({data,client,context}));
  if(write) await flushState(client,before,data,actor);
  else if(context.dirty) throw new Error('A read operation attempted to change data.');
  return result;
 },{write,dryRun});
}
const READ_TABLES={
 person:['people','services','records'],
};
export const runDomain=(method,args=[],actor=null,write=false)=>withState(async({data,client})=>{
 const result=await domain[method](...args);
 // Attendance is one shared source of truth, including staff corrections/undo.
 if(write&&['mark','undoMark'].includes(method)){
  const service=data.services.find(s=>s.id===Number(args[0]));
  if(service){const status=method==='mark'&&args[2]==='present'?'valid':'invalid';
   const updated=await client.query('UPDATE vip_checkins c SET status=$1,validated_by=$2,validated_at=now() FROM vip_registrations v WHERE c.registration_id=v.id AND v.person_id=$3 AND c.date_key=$4 AND c.status<>$1 RETURNING c.id',[status,actor?.id||null,Number(args[1]),service.service_date]);
   for(const c of updated.rows)await logAction(client,actor,'vip_checkins',c.id,'attendance_'+status);
  }
 }
 return result;
},{actor,write,tables:READ_TABLES[method]||TABLES});
export function stateId(data,table) {data.seq[table]=(data.seq[table]||0)+1;return data.seq[table];}
export async function allocateId(client,entity) {const {rows}=await client.query('UPDATE id_counters SET last_id=last_id+1 WHERE entity=$1 RETURNING last_id',[entity]);if(!rows[0]) throw new Error('Unknown entity counter');return rows[0].last_id;}
export async function databaseBackup(client) {
 const state=await loadState(client,{includeAudit:true,includeVipRegistrations:true});
 for(const t of ['vip_registrations','vip_checkins','community_posts','monthly_prizes','prayer_reactions','audit_log']) state[t]=(await client.query(`SELECT * FROM "${t}"`)).rows;
 // VIP design library: the per-Sunday selections are tiny and must survive a
 // restore, but the artwork bytes are megabytes each, so the JSON export carries
 // their metadata only. The bytes stay in Supabase Storage, or in the
 // vip_designs.data column, and are restored with the database itself.
 const designRows=(await client.query('SELECT id,title,filename,mime_type,byte_size,width,height,checksum,storage_kind,storage_path,display_mode,layout,is_enabled,uploaded_by,created_at,updated_at FROM vip_designs ORDER BY id')).rows;
 state.vip_designs=designRows;
 state.vip_designs_bytes_excluded=designRows.length>0?'Image bytes are not part of this JSON export; they live in Supabase Storage or the vip_designs.data column.':null;
 state.vip_service_designs=(await client.query('SELECT * FROM vip_service_designs ORDER BY service_date')).rows;
 return {app:'LifegenTracker',source:'supabase-postgresql',database_instance:state.settings.__database_instance,exported_at:new Date().toISOString(),...state};
}
export const closePool=async()=>{if(pool){await pool.end();pool=null;}};
