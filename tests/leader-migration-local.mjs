import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
const databaseUrl=process.env.LIFEGEN_INTEGRATION_DATABASE_URL;
if(!databaseUrl||!['localhost','127.0.0.1','::1'].includes(new URL(databaseUrl).hostname)){
 console.error('Refusing non-local integration database.');process.exit(2);
}
const client=new pg.Client({connectionString:databaseUrl,ssl:false});
await client.connect();
try{
 const migration=await fs.readFile(new URL('../database/011_staff_people_link.sql',import.meta.url),'utf8');
 await client.query(migration);
 await client.query(migration);
 const column=await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_users' AND column_name='person_id'");
 assert.equal(column.rows.length,1,'staff_users.person_id is available');
 const idx=await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='staff_users' AND indexname='staff_users_person_id_unique'");
 assert.equal(idx.rows.length,1,'unique person link index exists');
 assert.match(idx.rows[0].indexdef,/UNIQUE INDEX/);
 assert.match(idx.rows[0].indexdef,/person_id IS NOT NULL/);
 console.log('PASS: additive leader identity migration is repeatable and keeps unique links');
}finally{await client.end();}
