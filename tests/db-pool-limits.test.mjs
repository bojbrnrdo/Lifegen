import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationPoolOptions,applicationDatabaseUrl} from '../src/db.js';

test('serverless Vercel instances use a single short-idle database client',()=>{
 const options=applicationPoolOptions({serverless:true});
 assert.equal(options.max,1);
 assert.equal(options.idleTimeoutMillis,1000);
 assert.equal(options.allowExitOnIdle,true);
});

test('persistent local instances retain their bounded pool',()=>{
 const options=applicationPoolOptions({serverless:false});
 assert.equal(options.max,3);
 assert.equal(options.idleTimeoutMillis,10000);
 assert.equal(options.allowExitOnIdle,true);
});

test('Vercel uses transaction pooling for verified Supabase session-pool URLs',()=>{
 const original='postgresql://postgres.projectref:placeholder@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require';
 const transformed=applicationDatabaseUrl(original,{serverless:true});
 const parsed=new URL(transformed);
 assert.equal(parsed.port,'6543');
 assert.equal(parsed.username,'postgres.projectref');
 assert.equal(parsed.password,'placeholder');
 assert.equal(parsed.searchParams.get('sslmode'),'require');
 assert.equal(parsed.pathname,'/postgres');
});

test('Never rewrite direct hosts, local runtime, arbitrary poolers, or an explicit session override',()=>{
 const supa='postgresql://postgres.projectref:p@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
 const direct='postgresql://postgres:p@db.projectref.supabase.co:5432/postgres';
 const arbitrary='postgresql://postgres.projectref:p@other-pooler.example.com:5432/postgres';
 const unqualified='postgresql://postgres:p@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
 assert.equal(applicationDatabaseUrl(supa,{serverless:false}),supa);
 assert.equal(applicationDatabaseUrl(supa,{serverless:true,mode:'session'}),supa);
 assert.equal(applicationDatabaseUrl(direct,{serverless:true}),direct);
 assert.equal(applicationDatabaseUrl(arbitrary,{serverless:true}),arbitrary);
 assert.equal(applicationDatabaseUrl(unqualified,{serverless:true}),unqualified);
});
