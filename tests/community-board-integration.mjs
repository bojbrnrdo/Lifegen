// Community board moderation — live integration test.
//
// Edit / hide / delete must survive real SQL (including the anonymous author
// constraint and the reaction cascade), so this runs against an isolated local
// database the same way tests/vip-gift-integration.mjs does. It is NOT part of
// `npm test`.
//
//   LIFEGEN_INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5433/lifegen \
//   LIFEGEN_INTEGRATION_ADMIN_USERNAME=demo@lifegen.local \
//   LIFEGEN_INTEGRATION_ADMIN_PASSWORD=LifegenDemo2026! \
//   npm run test:community-integration
//
// Everything it creates is marked TEST-BOARD- and it removes exactly those rows
// again, so it can be run repeatedly. It never deletes, updates or truncates a
// row it did not create itself.
import pg from 'pg';
import crypto from 'node:crypto';

const databaseUrl = process.env.LIFEGEN_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  console.error('Set LIFEGEN_INTEGRATION_DATABASE_URL to an isolated local PostgreSQL test database.');
  process.exit(2);
}
const parsed = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
  console.error('Refusing integration writes: LIFEGEN_INTEGRATION_DATABASE_URL must be local.');
  process.exit(2);
}
const adminUsername = process.env.LIFEGEN_INTEGRATION_ADMIN_USERNAME || 'demo@lifegen.local';
if (!process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD) {
  console.error('Set LIFEGEN_INTEGRATION_ADMIN_PASSWORD for an existing test admin account.');
  process.exit(2);
}

process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_DIRECT_URL = process.env.LIFEGEN_INTEGRATION_DIRECT_URL || databaseUrl;
process.env.LOCAL_DEMO = 'true';
process.env.TZ = 'Asia/Manila';
const { default: app } = await import('../src/app.js');
const { closePool } = await import('../src/db.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
let session = '', csrf = '';
const ok = (label, actual, expected) => {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  good ? pass++ : fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}${good ? '' : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};
const truthy = (label, v) => ok(label, Boolean(v), true);
const section = (t) => console.log(`\n=== ${t} ===`);

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(session ? { 'X-Lifegen-Preview-Session': session } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      Origin: base,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (data?.csrf_token) csrf = data.csrf_token;
  if (data?.preview_session_token) session = data.preview_session_token;
  return { status: res.status, data };
}
const tracker = async (name, ...args) => call('/api/tracker/' + name, { method: 'POST', body: { args } });

const MARK = `TEST-BOARD-${crypto.randomBytes(4).toString('hex')}`;
const client = new pg.Client(databaseUrl);
await client.connect();

async function cleanup() {
  const rows = (await client.query("SELECT id FROM community_posts WHERE content LIKE 'TEST-BOARD-%'")).rows.map((r) => r.id);
  if (rows.length) {
    await client.query('DELETE FROM prayer_reactions WHERE post_id = ANY($1::bigint[])', [rows]);
    await client.query('DELETE FROM community_posts WHERE id = ANY($1::bigint[])', [rows]);
    await client.query("DELETE FROM audit_log WHERE entity='community_posts' AND entity_id = ANY($1::text[])", [rows.map(String)]);
  }
  return rows.length;
}

const leftovers = await cleanup();
if (leftovers) console.log(`(removed ${leftovers} leftover TEST-BOARD- row(s) from an earlier run)`);

try {
  const login = await call('/api/auth/login', { method: 'POST', body: { username: adminUsername, password: process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD } });
  ok('admin login succeeds', login.status, 200);
  truthy('a CSRF token is issued', csrf);
  truthy('a preview session is issued', session);

  section('1. TEST POST (marked TEST-BOARD-, removed again at the end)');
  const created = await call('/api/public/posts', {
    method: 'POST',
    body: { type: 'prayer', author: `${MARK} Anne`, content: `${MARK} please pray for safe travels.`, is_anonymous: false },
  });
  ok('a public visitor can share a post', created.status, 201);
  const id = created.data?.id;
  truthy('the new post has an id', id);

  const listed = await tracker('postsAdmin');
  ok('the admin board lists the new post', listed.status, 200);
  const row = () => listed.data.find((p) => p.id === id);
  ok('the message arrives unchanged', row()?.content, `${MARK} please pray for safe travels.`);
  ok('the list includes prayer reaction counts', row()?.prayer_count, 0);

  section('2. EDIT POST');
  const edited = await tracker('editPost', id, {
    type: 'testimony',
    author: `${MARK} Anne`,
    content: `${MARK} God provided for our trip — thank you for praying!`,
    is_anonymous: false,
  });
  ok('editPost accepts the rewrite', edited.status, 200);
  ok('the response carries the new type', edited.data?.type, 'testimony');
  const publicList = async () => (await call('/api/public/posts')).data.find((p) => p.id === id) || null;
  ok('the public wall shows the edited message', (await publicList())?.content, `${MARK} God provided for our trip — thank you for praying!`);
  ok('the public wall shows the edited type', (await publicList())?.type, 'testimony');

  const anonymous = await tracker('editPost', id, { type: 'testimony', author: 'should-be-dropped', content: `${MARK} anonymous version of the story.`, is_anonymous: true });
  ok('editPost accepts an anonymous rewrite', anonymous.status, 200);
  ok('the author is cleared for anonymous posts (CHECK constraint)', anonymous.data?.author, null);
  ok('the public wall hides the name', (await publicList())?.author, null);

  const badType = await tracker('editPost', id, { type: 'spam', content: `${MARK} nope`, is_anonymous: true });
  ok('a bad type is rejected', badType.status, 400);
  const emptyText = await tracker('editPost', id, { type: 'prayer', content: '   ', is_anonymous: true });
  ok('an empty message is rejected', emptyText.status, 400);
  const nameless = await tracker('editPost', id, { type: 'prayer', content: `${MARK} needs a name`, author: '', is_anonymous: false });
  ok('a named post without a name is rejected', nameless.status, 400);
  const missing = await tracker('editPost', 999999999, { type: 'prayer', content: `${MARK} ghost`, is_anonymous: true });
  ok('editing a deleted post reports 404', missing.status, 404);

  section('3. HIDE / SHOW (moderation stays intact)');
  await tracker('editPost', id, { type: 'prayer', author: `${MARK} Anne`, content: `${MARK} visible again.`, is_anonymous: false });
  ok('hidden is off to start with', (await publicList()) !== null, true);
  ok('moderatePost hides the post', (await tracker('moderatePost', id, true)).status, 200);
  ok('the public wall no longer lists it', await publicList(), null);
  const adminStillSees = (await tracker('postsAdmin')).data.find((p) => p.id === id);
  ok('admin still sees hidden posts', adminStillSees?.is_hidden, true);
  ok('moderatePost brings it back', (await tracker('moderatePost', id, false)).status, 200);
  ok('the public wall lists it again', (await publicList()) !== null, true);

  section('4. PRAYER REACTIONS TRACK WITH THE POST');
  const prayed = await call(`/api/public/posts/${id}/pray`, { method: 'POST', body: {} });
  ok('a visitor can pray for the post', prayed.status, 200);
  ok('the count comes back', prayed.data?.prayer_count, 1);
  ok('the admin board shows the reaction count', (await tracker('postsAdmin')).data.find((p) => p.id === id)?.prayer_count, 1);

  section('5. DELETE POST');
  ok('deletePost removes the row', (await tracker('deletePost', id)).status, 200);
  ok('the admin board no longer lists it', (await tracker('postsAdmin')).data.find((p) => p.id === id), undefined);
  ok('the public wall no longer lists it', await publicList(), null);
  const reactions = await client.query('SELECT count(*)::int AS n FROM prayer_reactions WHERE post_id=$1', [id]);
  ok('prayer reactions cascade with the deleted post', reactions.rows[0].n, 0);
  const again = await tracker('deletePost', id);
  ok('deleting twice reports 404', again.status, 404);

  section('6. AUDIT TRAIL');
  const audit = (await client.query("SELECT action FROM audit_log WHERE entity='community_posts' AND entity_id=$1 ORDER BY id", [String(id)])).rows.map((r) => r.action);
  for (const action of ['update', 'hide', 'show', 'delete']) {
    ok(`the audit log records "${action}"`, audit.includes(action), true);
  }
} finally {
  const removed = await cleanup();
  if (removed) console.log(`\n(cleaned up ${removed} TEST-BOARD- row(s))`);
  await client.end();
  await new Promise((resolve) => server.close(resolve));
  try { await closePool?.(); } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
