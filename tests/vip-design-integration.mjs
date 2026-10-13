// VIP Design Library — live integration test.
//
// Uploads, selection, rotation and the projector all need a real PostgreSQL, so
// this runs against an isolated local database the same way
// tests/lifegroup-integration.mjs does. It is NOT part of `npm test`.
//
//   LIFEGEN_INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5433/lifegen \
//   LIFEGEN_INTEGRATION_ADMIN_USERNAME=demo@lifegen.local \
//   LIFEGEN_INTEGRATION_ADMIN_PASSWORD=LifegenDemo2026! \
//   npm run test:vip-design-integration
//
// It removes every row it creates, so it can be run repeatedly.
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

async function call(path, { method = 'GET', body, raw, contentType, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(session ? { 'X-Lifegen-Preview-Session': session } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      Origin: base,
      ...(raw ? { 'Content-Type': contentType } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (data?.csrf_token) csrf = data.csrf_token;
  if (data?.preview_session_token) session = data.preview_session_token;
  return { status: res.status, data };
}

// ---- Image bytes, generated here so the test needs no fixtures --------------
const u32be = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16be = (n) => Buffer.from([(n >>> 8) & 255, n & 255]);
const u24le = (n) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);
// Every design has a distinct payload, so the UNIQUE checksum index accepts them.
const salt = (n) => crypto.createHash('sha256').update(`lifegen-design-${n}`).digest();
const png = (w, h, tag) => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  u32be(13), Buffer.from('IHDR'), u32be(w), u32be(h),
  Buffer.from([8, 2, 0, 0, 0]), u32be(0), salt(tag), Buffer.from('IEND'), u32be(0),
]);
// APP0 declares length 16, so its payload is 14 bytes: 'JFIF\0' + version(2)
// + units(1) + Xdensity(2) + Ydensity(2) + thumbnail(2).
const jpeg = (w, h, tag) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]), u16be(16),
  Buffer.from('JFIF\0'), Buffer.from([1, 1, 0]), u16be(1), u16be(1), Buffer.from([0, 0]),
  Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(h), u16be(w),
  Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), salt(tag),
]);
const webp = (w, h, tag) => Buffer.concat([
  Buffer.from('RIFF'), u32be(30), Buffer.from('WEBP'), Buffer.from('VP8X'),
  u32be(10), Buffer.from([0, 0, 0, 0]), u24le(w - 1), u24le(h - 1), salt(tag),
]);

const unique = crypto.randomBytes(6).toString('hex');
const testName = `Design Test VIP ${unique}`;
const client = new pg.Client(databaseUrl);
await client.connect();

async function cleanup() {
  await client.query('DELETE FROM vip_service_designs');
  await client.query('DELETE FROM vip_designs');
  await client.query(`DELETE FROM vip_registrations WHERE full_name = $1`, [testName]);
  await client.query(`DELETE FROM people WHERE full_name = $1`, [testName]);
}
await cleanup();

try {
  section('0. SIGN IN AS ADMIN');
  const login = await call('/api/auth/login', { method: 'POST', body: { username: adminUsername, password: process.env.LIFEGEN_INTEGRATION_ADMIN_PASSWORD } });
  ok('login succeeds', login.status, 200);
  truthy('a CSRF token is issued', csrf);
  truthy('a preview session is issued', session);

  section('14. UNAUTHORIZED USERS CANNOT MANAGE DESIGNS');
  ok('anonymous listing is refused', (await fetch(base + '/api/vip-designs')).status, 401);
  ok('anonymous upload is refused', (await fetch(base + '/api/vip-designs', { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: base }, body: png(64, 64, 'anon') })).status, 401);
  const keep = [session, csrf];
  session = ''; csrf = '';
  ok('signed-out edit is refused', (await call('/api/vip-designs/1', { method: 'PATCH', body: { title: 'x' } })).status, 401);
  [session, csrf] = keep;

  section('10. EMPTY LIBRARY');
  const empty = await call('/api/vip-designs');
  ok('counts are zero', empty.data.counts, { total: 0, enabled: 0 });
  ok('storage backend is reported', empty.data.storage, 'database');
  ok('accepted formats are reported', empty.data.allowed_types, ['image/png', 'image/jpeg', 'image/webp']);
  ok('the timezone is named', empty.data.timezone, 'Asia/Manila');
  truthy('a list of Sundays is offered', Array.isArray(empty.data.sundays) && empty.data.sundays.length > 8);
  truthy('this Sunday is identified', empty.data.sundays.includes(empty.data.today_sunday));

  // Every Sunday used below comes from the API — nothing is hardcoded.
  const sundays = empty.data.sundays;
  const S0 = empty.data.today_sunday;
  const at = (offset) => sundays[sundays.indexOf(S0) + offset];
  const S1 = at(1), S2 = at(2), S3 = at(3);
  truthy('four upcoming Sundays are available', [S0, S1, S2, S3].every(Boolean));

  const emptySel = await call(`/api/vip-designs/selection/${S0}`);
  ok('an empty library selects nothing', emptySel.data.design, null);
  ok('and reports that nothing is available', emptySel.data.available, { total: 0, enabled: 0 });
  ok('the projector gets no design either', (await call('/api/public/vip-announcement')).data.design, null);

  section('1. BATCH UPLOAD (several designs at once)');
  const files = [
    ['gold.png', png(1920, 1080, 'gold'), 'image/png', 'Gold Harvest'],
    ['forest.png', png(1920, 1080, 'forest'), 'image/png', 'Forest Green'],
    ['cream.png', png(1920, 1080, 'cream'), 'image/png', 'Cream Classic'],
    ['photo.jpg', jpeg(1920, 1080, 'photo'), 'image/jpeg', 'Photo Frame'],
    ['modern.webp', webp(1920, 1080, 'modern'), 'image/webp', 'Modern WebP'],
  ];
  const uploaded = [];
  for (const [name, bytes, type, title] of files) {
    const r = await call('/api/vip-designs', { method: 'POST', raw: bytes, contentType: type, headers: { 'X-Design-Title': title } });
    ok(`upload ${name}`, r.status, 201);
    if (r.data?.id) uploaded.push(r.data);
  }
  ok('the library counts the batch', (await call('/api/vip-designs')).data.counts, { total: 5, enabled: 5 });
  const firstPng = uploaded.find((d) => d.mime_type === 'image/png');
  ok('PNG dimensions read from IHDR', { w: firstPng.width, h: firstPng.height, o: firstPng.orientation }, { w: 1920, h: 1080, o: 'landscape' });
  const jpg = uploaded.find((d) => d.mime_type === 'image/jpeg');
  ok('JPEG dimensions read from the SOF marker', { w: jpg.width, h: jpg.height }, { w: 1920, h: 1080 });
  const wp = uploaded.find((d) => d.mime_type === 'image/webp');
  ok('WebP dimensions read from VP8X', { w: wp.width, h: wp.height }, { w: 1920, h: 1080 });
  ok('the display title is stored', firstPng.title, 'Gold Harvest');
  truthy('a checksum is recorded', /^[0-9a-f]{64}$/.test(firstPng.checksum));
  ok('storage kind is recorded', firstPng.storage_kind, 'database');
  ok('image bytes never reach the browser', 'data' in firstPng, false);
  ok('the storage path never reaches the browser', 'storage_path' in firstPng, false);

  section('REJECTIONS');
  const fake = await call('/api/vip-designs', { method: 'POST', raw: Buffer.from('not an image at all, just padded text to clear the header check'), contentType: 'image/png', headers: { 'X-Design-Title': 'Fake' } });
  ok('a text file renamed .png is refused', fake.status, 415);
  truthy('the refusal explains why', /not a recognized image/i.test(fake.data?.message || ''));
  ok('an exact duplicate file is refused', (await call('/api/vip-designs', { method: 'POST', raw: png(1920, 1080, 'gold'), contentType: 'image/png', headers: { 'X-Design-Title': 'Gold again' } })).status, 409);
  const tooBig = await call('/api/vip-designs', { method: 'POST', raw: Buffer.alloc(9 * 1024 * 1024, 7), contentType: 'image/png', headers: { 'X-Design-Title': 'Huge' } });
  ok('an oversized file is refused', tooBig.status, 413);
  truthy('the size error names the limit', /limit is \d+ MB/i.test(tooBig.data?.message || ''));

  section('2. PREVIEW / RENAME / DISABLE / DISPLAY MODE');
  const target = uploaded[2];
  ok('rename', (await call(`/api/vip-designs/${target.id}`, { method: 'PATCH', body: { title: 'Renamed Design' } })).data.title, 'Renamed Design');
  ok('disable', (await call(`/api/vip-designs/${target.id}`, { method: 'PATCH', body: { is_enabled: false } })).data.is_enabled, false);
  ok('a disabled design drops out of the enabled count', (await call('/api/vip-designs')).data.counts, { total: 5, enabled: 4 });
  const mode = await call(`/api/vip-designs/${uploaded[0].id}`, { method: 'PATCH', body: { display_mode: 'template', layout: { align: 'center', columns: 3, names: { size: 2.4, showInviter: false } } } });
  ok('display mode is stored', mode.data.display_mode, 'template');
  ok('the layout is normalized and defaults filled', {
    align: mode.data.layout.align, columns: mode.data.layout.columns,
    nameSize: mode.data.layout.names.size, showInviter: mode.data.layout.names.showInviter, areaTop: mode.data.layout.area.top,
  }, { align: 'center', columns: 3, nameSize: 2.4, showInviter: false, areaTop: 16 });

  const img = await fetch(base + uploaded[0].url);
  ok('the public image route serves the bytes', img.status, 200);
  ok('with the right content type', img.headers.get('content-type'), 'image/png');
  ok('and an immutable cache header', /immutable/.test(img.headers.get('cache-control') || ''), true);
  ok('and exactly the bytes that were uploaded', (await img.arrayBuffer()).byteLength, uploaded[0].byte_size);
  ok('a wrong checksum in the URL is a 404', (await fetch(base + `/api/public/vip-design-image/${uploaded[0].id}/deadbeefdead.png`)).status, 404);

  section('3-5. THE AUTOMATIC SELECTION IS STABLE ACROSS DEVICES AND REFRESHES');
  const picks = [];
  for (let i = 0; i < 6; i += 1) picks.push((await call(`/api/vip-designs/selection/${S0}`)).data.design.id);
  ok('six reads of one Sunday return one design', new Set(picks).size, 1);
  const devices = await Promise.all([1, 2, 3, 4].map(() => fetch(base + '/api/public/vip-announcement').then((r) => r.json())));
  ok('four simultaneous devices agree', new Set(devices.map((d) => d.design.id)).size, 1);
  ok('the projector matches the admin', devices[0].design.id, picks[0]);
  ok('the selection is recorded as automatic', devices[0].design_selection.mode, 'automatic');
  ok('and keyed to the Sunday', devices[0].design_selection.service_date, S0);
  ok('a disabled design is never selected', picks.includes(target.id), false);

  section('6-7. A MANUAL OVERRIDE SURVIVES, THEN RESETS');
  const other = uploaded.find((d) => d.id !== picks[0] && d.is_enabled);
  const manual = await call(`/api/vip-designs/selection/${S0}`, { method: 'POST', body: { mode: 'manual', design_id: other.id } });
  ok('the manual choice is applied', manual.data.design.id, other.id);
  ok('and recorded as manual', manual.data.selection.mode, 'manual');
  for (let i = 0; i < 4; i += 1) {
    ok(`the manual pin survives read #${i + 1}`, (await call(`/api/vip-designs/selection/${S0}`)).data.design.id, other.id);
  }
  ok('the projector shows the manual pick', (await call('/api/public/vip-announcement')).data.design.id, other.id);
  const reset = await call(`/api/vip-designs/selection/${S0}`, { method: 'POST', body: { mode: 'automatic' } });
  ok('reset returns to automatic', reset.data.selection.mode, 'automatic');
  truthy('reset selects a design again', Boolean(reset.data.design));

  section('8. THE NEXT SUNDAY ROTATES AND AVOIDS A REPEAT');
  const s0 = (await call(`/api/vip-designs/selection/${S0}`)).data.design.id;
  const s1 = (await call(`/api/vip-designs/selection/${S1}`)).data.design.id;
  const s2 = (await call(`/api/vip-designs/selection/${S2}`)).data.design.id;
  ok(`${S1} gets its own selection`, s1 !== s0, true);
  ok(`${S2} avoids repeating ${S1}`, s2 !== s1, true);
  ok(`${S0} keeps the record it already had`, (await call(`/api/vip-designs/selection/${S0}`)).data.design.id, s0);

  section('9. A SINGLE AVAILABLE DESIGN IS REUSED');
  for (const d of uploaded) if (d.id !== s0) await call(`/api/vip-designs/${d.id}`, { method: 'PATCH', body: { is_enabled: false } });
  const only = await call(`/api/vip-designs/selection/${S3}`);
  ok('the one enabled design is used even though it was last week\'s', only.data.design.id, s0);
  ok('the counts say one is available', only.data.available, { total: 5, enabled: 1 });
  ok('re-enabling works', (await call(`/api/vip-designs/${target.id}`, { method: 'PATCH', body: { is_enabled: true } })).data.is_enabled, true);

  section('8b. A LIBRARY OF THREE ROTATES — NO ARTWORK REPEATS BACK TO BACK');
  // A controlled pool of exactly three enabled designs, so the expectation is
  // exact rather than statistical: three Sundays running must show three
  // different designs before any artwork comes round again.
  for (const [i, d] of uploaded.entries()) await call(`/api/vip-designs/${d.id}`, { method: 'PATCH', body: { is_enabled: i < 3 } });
  const pool = uploaded.slice(0, 3).map((d) => d.id);
  ok('exactly three designs are available', (await call('/api/vip-designs')).data.counts.enabled, 3);
  const WALK = [4, 5, 6, 7, 8];
  truthy('five untouched Sundays are offered', WALK.every((i) => Boolean(at(i))));
  const rotation = [];
  for (const i of WALK) rotation.push((await call(`/api/vip-designs/selection/${at(i)}`)).data.design.id);
  ok('every pick comes from the enabled pool', rotation.every((id) => pool.includes(id)), true);
  ok('no two Sundays in a row repeat', rotation.every((id, i) => i === 0 || id !== rotation[i - 1]), true);
  ok('every three Sundays use three different designs', rotation.every((id, i) => i < 2 || new Set(rotation.slice(i - 2, i + 1)).size === 3), true);
  ok('a Sunday keeps its design when read again', (await call(`/api/vip-designs/selection/${at(4)}`)).data.design.id, rotation[0]);
  for (const [i, d] of uploaded.entries()) await call(`/api/vip-designs/${d.id}`, { method: 'PATCH', body: { is_enabled: true } });
  ok('the whole library is available again', (await call('/api/vip-designs')).data.counts.enabled, 5);

  section('11. LIVE VIP CONTENT UPDATES WITHOUT CHANGING THE DESIGN');
  const before = (await call('/api/public/vip-announcement')).data;
  const reg = await fetch(base + '/api/public/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ full_name: testName, age: 24, school: 'Test University', inviter: 'Ate Mira', contact: '09170001111', privacy_consent: true, idempotency_key: `design-lib-${unique}` }),
  });
  ok('a new VIP registers', reg.status, 201);
  const after = (await call('/api/public/vip-announcement')).data;
  ok('the total increases', after.total, before.total + 1);
  ok('the new name is present', after.vips.some((v) => v.full_name === testName), true);
  ok('the new inviter is present', after.vips.some((v) => v.full_name === testName && v.inviter === 'Ate Mira'), true);
  ok('the selected design does NOT change', after.design.id, before.design.id);
  ok('the service date does NOT change', after.service_date, before.service_date);

  section('DELETE');
  const victim = uploaded.find((d) => d.id !== s0 && d.id !== target.id);
  ok('delete succeeds', (await call(`/api/vip-designs/${victim.id}`, { method: 'DELETE' })).data.deleted, true);
  ok('its file is gone', (await fetch(base + `/api/vip-designs/${victim.id}/file`, { headers: { 'X-Lifegen-Preview-Session': session } })).status, 404);
  ok('the count decreases', (await call('/api/vip-designs')).data.counts.total, 4);
  const orphan = await call(`/api/vip-designs/selection/${S1}`);
  truthy('a Sunday whose design was deleted selects again instead of going blank', Boolean(orphan.data.design));
} catch (e) {
  fail += 1;
  console.log(`  FAIL  unexpected error: ${e.stack || e.message}`);
} finally {
  await cleanup();
  await client.end();
  server.close();
  await closePool();
}

console.log(`\n${fail === 0 ? `ALL ${pass} DESIGN LIBRARY CHECKS PASSED` : `${fail} FAILED, ${pass} PASSED`}`);
process.exit(fail === 0 ? 0 : 1);
