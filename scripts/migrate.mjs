import 'dotenv/config';import fs from 'node:fs/promises';import {directClient} from '../src/db.js';
const client=directClient();
try{await client.connect();for(const file of (await fs.readdir(new URL('../database/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
const version=file.replace(/\.sql$/,'');const exists=(await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists")).rows[0].exists;
if(exists&&(await client.query('SELECT version FROM schema_migrations WHERE version=$1',[version])).rows.length){console.log(`Already applied: ${version}`);continue;}
await client.query(await fs.readFile(new URL('../database/'+file,import.meta.url),'utf8'));console.log(`Applied ${file} (existing business data was not deleted).`);}}catch(e){console.error('Migration failed:',e.message);process.exitCode=1;}finally{await client.end().catch(()=>{});}
