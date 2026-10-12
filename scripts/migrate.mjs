import 'dotenv/config';import fs from 'node:fs/promises';import {directClient,connectionHint,supabaseRootCertificate} from '../src/db.js';
const client=directClient();
try{
// Never prints the certificate itself, only whether this host trusts it.
console.log(supabaseRootCertificate()?'TLS: certificate verification is enabled with the Supabase project CA from DATABASE_SSL_ROOT_CERT plus the system root certificates.':'TLS: certificate verification is enabled with the system root certificates (no DATABASE_SSL_ROOT_CERT set).');
await client.connect();for(const file of (await fs.readdir(new URL('../database/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
const version=file.replace(/\.sql$/,'');const exists=(await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists")).rows[0].exists;
if(exists&&(await client.query('SELECT version FROM schema_migrations WHERE version=$1',[version])).rows.length){console.log(`Already applied: ${version}`);continue;}
await client.query(await fs.readFile(new URL('../database/'+file,import.meta.url),'utf8'));console.log(`Applied ${file} (existing business data was not deleted).`);}}catch(e){console.error('Migration failed:',e.message);const hint=connectionHint(e);if(hint)console.error(hint);process.exitCode=1;}finally{await client.end().catch(()=>{});}
