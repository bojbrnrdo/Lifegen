import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationPoolOptions} from '../src/db.js';

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
