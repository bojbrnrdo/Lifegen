// Applies Lifegen database migrations DIRECTLY to PGlite.
// IMPORTANT: the wire gateway (server.mjs) must be STOPPED while this runs —
// two PGlite instances on the same data directory will crash the wasm runtime.
// Usage: node apply-migrations.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PGW_DATA || path.join(here, 'data');
const MIGRATIONS_DIR = process.env.LIFEGEN_DB_DIR || '/home/user/Lifegen/database';

const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const db = new PGlite(DATA);
await db.waitReady;
for (const f of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
  await db.exec(sql);
  console.log('applied', f);
}
const { rows } = await db.query('SELECT version FROM schema_migrations ORDER BY version');
console.log('schema_migrations:', rows.map((r) => r.version).join(', '));
await db.close();
console.log('done');
