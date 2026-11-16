import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/db.js',import.meta.url),'utf8');

test('shared PostgreSQL Pool handles errors emitted by idle clients',()=>{
 const getPool=source.slice(source.indexOf('export function getPool()'),source.indexOf('export function directClient()'));
 assert.match(getPool,/new Pool\(/);
 assert.match(getPool,/instance\.on\('error',/);
 assert.match(getPool,/pool=instance/);
 assert.match(getPool,/return pool/);
});

test('idle pool error logging never prints raw connection strings or error messages',()=>{
 const getPool=source.slice(source.indexOf('export function getPool()'),source.indexOf('export function directClient()'));
 assert.match(getPool,/String\(error\?\.code\|\|'UNKNOWN'\)/);
 assert.doesNotMatch(getPool,/console\.error\([^\n]*(?:error\.message|connectionString|DATABASE_URL)/);
});
