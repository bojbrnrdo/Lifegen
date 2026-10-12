import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSupabaseDatabaseUrls } from '../src/deployment.js';

const direct = 'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';

test('publisher accepts matching direct Supabase URLs', () => {
  assert.equal(validateSupabaseDatabaseUrls(direct, direct), true);
});

test('publisher accepts transaction-pooler app URLs with direct or session-pooler maintenance URLs', () => {
  const pooled = 'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
  const session = 'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
  assert.equal(validateSupabaseDatabaseUrls(pooled, direct), true);
  assert.equal(validateSupabaseDatabaseUrls(pooled, session), true);
  assert.equal(validateSupabaseDatabaseUrls(direct, session), true);
});

test('publisher rejects missing, non-Supabase, or cross-project database URLs', () => {
  assert.throws(() => validateSupabaseDatabaseUrls('', direct), /both private Supabase/);
  assert.throws(() => validateSupabaseDatabaseUrls('postgres://u:p@db.example.neon.tech/postgres', direct), /DATABASE_URL must use a Supabase/);
  const otherProject = 'postgresql://postgres:secret@db.zyxwvutsrqponmlkjihgfed.supabase.co:5432/postgres';
  assert.throws(() => validateSupabaseDatabaseUrls(otherProject, direct), /same Supabase project/);
  const transactionPooler = 'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
  assert.throws(() => validateSupabaseDatabaseUrls(direct, transactionPooler), /session pooler on port 5432/);
});
