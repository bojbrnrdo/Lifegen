// VIP Gift Tracker.
//
// The tracker is a thin, read-only layer over attendance that already exists,
// plus one additive table for the gift that is handed out in person. The pure
// rule, the SQL and the wiring are therefore asserted against the shipped
// source, the way this repository already checks migrations, routes and admin
// screens.
//
// The live behaviour (counts, recording, undo, permissions) needs a real
// PostgreSQL and is covered by tests/vip-gift-integration.mjs
// (npm run test:vip-gift-integration).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  GIFT_SUNDAYS_REQUIRED,
  GIFT_ROWS_SQL,
  listGiftTracker,
  markGiftGiven,
  undoGiftGiven,
} from '../src/gift-tracker.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFile(path.join(root, p), 'utf8');

test('four Sunday attendances make a VIP eligible for the gift', () => {
  assert.equal(GIFT_SUNDAYS_REQUIRED, 4);
});

test('the tracker counts attendance that is already recorded', () => {
  assert.match(GIFT_ROWS_SQL, /count\(DISTINCT s\.service_date\)/);
  assert.match(GIFT_ROWS_SQL, /FROM records r JOIN services s/);
  assert.match(GIFT_ROWS_SQL, /r\.status = 'present'/);
  assert.match(GIFT_ROWS_SQL, /LEFT JOIN vip_gift_handouts/);
  assert.match(GIFT_ROWS_SQL, /EXISTS \(SELECT 1 FROM vip_registrations/);
  assert.match(GIFT_ROWS_SQL, /p\.archived_at IS NULL/);
  assert.match(GIFT_ROWS_SQL, /LIMIT 1000/);
});

test('the export surface is exactly the approved operations', () => {
  for (const fn of [listGiftTracker, markGiftGiven, undoGiftGiven]) {
    assert.equal(typeof fn, 'function');
  }
});

test('the two writes only ever touch the new table', async () => {
  const src = await read('src/gift-tracker.js');
  const writes = src.match(/INSERT INTO \w+|DELETE FROM \w+|UPDATE \w+ SET/g) || [];
  assert.ok(writes.length >= 2, 'expected the record and undo writes');
  for (const write of writes) assert.match(write, /vip_gift_handouts/);
});

test('the admin methods are gated on registrations:manage (admin and staff only)', async () => {
  const app = await read('src/app.js');
  assert.match(app, /giftTracker:\['registrations:manage',false\]/);
  assert.match(app, /markGiftGiven:\['registrations:manage',true\]/);
  assert.match(app, /undoGiftGiven:\['registrations:manage',true\]/);
  assert.match(app, /import \{ listGiftTracker, markGiftGiven, undoGiftGiven \} from '\.\/gift-tracker\.js'/);
  assert.match(app, /if\(name==='giftTracker'\)return listGiftTracker\(\)/);
});

test('nothing about the tracker is public', async () => {
  assert.doesNotMatch(await read('src/public-api.js'), /gift/i);
});

test('migration 009 is additive and only adds the one table', async () => {
  const sql = await read('database/009_vip_gift_tracker.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS vip_gift_handouts/);
  assert.match(sql, /person_id bigint NOT NULL UNIQUE/);
  assert.match(sql, /INSERT INTO id_counters\(entity\) VALUES \('vip_gift_handouts'\) ON CONFLICT DO NOTHING/);
  assert.match(sql, /INSERT INTO schema_migrations\(version\) VALUES\('009_vip_gift_tracker'\)/);
  assert.match(sql, /lifegen_changed/);
  for (const forbidden of [/DROP TABLE/i, /DROP COLUMN/i, /TRUNCATE/i, /DELETE FROM/i, /UPDATE\s+\w+\s+SET/i, /ALTER COLUMN/i]) {
    assert.doesNotMatch(sql, forbidden);
  }
});

test('the card lives inside the existing VIP registrations screen', async () => {
  const view = await read('public/admin/js/views/registrations.js');
  assert.match(view, /VIP Gift Tracker/);
  assert.match(view, /Track Sunday attendance and gift eligibility/);
  assert.match(view, /api\.giftTracker\(\)/);
  assert.match(view, /api\.markGiftGiven\(/);
  assert.match(view, /api\.undoGiftGiven\(/);
  assert.match(view, /data-give/);
  assert.match(view, /data-undo/);
});

test('no new screen, route or navigation entry was added', async () => {
  assert.doesNotMatch(await read('public/admin/js/app.js'), /gift/i);
});

test('the browser client can call the three operations', async () => {
  const client = await read('public/admin/js/api.js');
  for (const method of ['giftTracker', 'markGiftGiven', 'undoGiftGiven']) {
    assert.match(client, new RegExp(`'${method}'`));
  }
});

test('the integration run is wired into package.json', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.scripts['test:vip-gift-integration'], 'node tests/vip-gift-integration.mjs');
});
