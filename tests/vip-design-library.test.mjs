// VIP Design Library.
//
// The image sniffer, layout normaliser and response shaper are pure, so they are
// asserted directly. The migration, the admin management screen, the public image
// route and the projector are checked the way this repository already checks
// public assets and migrations: by asserting on the shipped source.
//
// The live upload / selection / rotation behaviour needs a real PostgreSQL and is
// covered by tests/vip-design-integration.mjs (npm run test:vip-design-integration).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ALLOWED_TYPES,
  DISPLAY_MODES,
  MAX_BYTES,
  sniffImage,
  validateImage,
  normalizeLayout,
  shapeDesign,
  selectableSundays,
  storageKind,
  sha256,
} from '../src/vip-designs.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFile(path.join(root, p), 'utf8');

// ---- Real image headers, built byte by byte ---------------------------------
const u32be = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16be = (n) => Buffer.from([(n >>> 8) & 255, n & 255]);
const u24le = (n) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);

function png(w, h) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13), Buffer.from('IHDR'), u32be(w), u32be(h),
    Buffer.from([8, 2, 0, 0, 0]), u32be(0), u32be(0), Buffer.from('IEND'), u32be(0),
  ]);
}

// APP0 declares length 16, so its payload is 14 bytes: 'JFIF\0' + version(2)
// + units(1) + Xdensity(2) + Ydensity(2) + thumbnail(2). Getting that padding
// wrong makes the marker scan run past SOF0 and report no dimensions.
function jpeg(w, h) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]), u16be(16),
    Buffer.from('JFIF\0'), Buffer.from([1, 1, 0]), u16be(1), u16be(1), Buffer.from([0, 0]),
    Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(h), u16be(w),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  ]);
}

// VP8X: chunk size (10) at 16, flags at 20, three reserved bytes, then
// canvas width-1 at 24 and height-1 at 27 — each little-endian 24-bit.
function webp(w, h) {
  return Buffer.concat([
    Buffer.from('RIFF'), u32be(30), Buffer.from('WEBP'), Buffer.from('VP8X'),
    u32be(10), Buffer.from([0, 0, 0, 0]), u24le(w - 1), u24le(h - 1),
    Buffer.from([0, 0]), // the sniffer needs a full 32-byte header
  ]);
}

test('the sniffer reads dimensions out of PNG, JPEG and WebP headers', () => {
  assert.deepEqual({ ...sniffImage(png(1920, 1080)) }, { mime: 'image/png', ext: 'png', width: 1920, height: 1080 });
  assert.deepEqual({ ...sniffImage(jpeg(1920, 1080)) }, { mime: 'image/jpeg', ext: 'jpg', width: 1920, height: 1080 });
  assert.deepEqual({ ...sniffImage(webp(1920, 1080)) }, { mime: 'image/webp', ext: 'webp', width: 1920, height: 1080 });
});

test('the sniffer rejects anything that is not one of those three images', () => {
  assert.equal(sniffImage(Buffer.from('definitely not an image, just text padded out to be long enough')), null);
  assert.equal(sniffImage(Buffer.alloc(8)), null, 'shorter than any real header');
  assert.equal(sniffImage(null), null);
});

test('only PNG, JPEG and WebP are accepted, with the extension used for cache URLs', () => {
  assert.deepEqual(ALLOWED_TYPES, { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
  assert.deepEqual(DISPLAY_MODES, ['background', 'template']);
});

test('validation flags the size limit before it sniffs the contents', () => {
  const tooBig = Buffer.concat([png(1920, 1080), Buffer.alloc(MAX_BYTES)]);
  assert.throws(() => validateImage(tooBig, 'big.png'), (e) => {
    assert.equal(e.status, 413);
    assert.match(e.message, /The limit is \d+ MB/);
    return true;
  });
  assert.throws(() => validateImage(Buffer.alloc(0)), (e) => e.status === 400);
});

test('validation refuses an unsupported file even when it is renamed .png', () => {
  assert.throws(() => validateImage(Buffer.from('GIF89a' + 'x'.repeat(64)), 'sneaky.png'), (e) => {
    assert.equal(e.status, 415);
    assert.match(e.message, /not a recognized image/);
    return true;
  });
});

test('validation records orientation, because the projector is widescreen', () => {
  assert.equal(validateImage(png(1920, 1080), 'a.png').orientation, 'landscape');
  assert.equal(validateImage(png(800, 1200), 'b.png').orientation, 'portrait');
  assert.equal(validateImage(jpeg(1920, 1080), 'c.jpg').byte_size > 0, true);
});

test('layout configuration defaults to a readable widescreen overlay', () => {
  const l = normalizeLayout();
  assert.deepEqual(l.area, { top: 16, left: 7, width: 86, height: 62 });
  assert.equal(l.align, 'left');
  assert.equal(l.columns, 2);
  assert.equal(l.title.text, 'Welcome our VIPs');
  assert.equal(l.names.showInviter, true);
  assert.equal(l.title.show, true);
});

test('layout configuration clamps nonsense and refuses unsafe colours', () => {
  const l = normalizeLayout({
    area: { top: -50, left: 900, width: 'abc', height: 40 },
    align: 'sideways',
    columns: 99,
    title: { text: 'x'.repeat(500), size: 999, color: 'red; } body { display: none' },
    names: { size: -3, inviterColor: 'url(javascript:x)' },
  });
  assert.deepEqual(l.area, { top: 0, left: 90, width: 86, height: 40 }, 'out-of-range numbers clamp, non-numbers fall back');
  assert.equal(l.align, 'left', 'unknown alignment falls back');
  assert.equal(l.columns, 4, 'columns clamp to the 1-4 range');
  assert.equal(l.title.text.length, 120, 'the title is length-limited');
  assert.equal(l.title.size, 20, 'font size clamps');
  assert.equal(l.title.color, '#F6F1E6', 'a colour carrying CSS is rejected');
  assert.equal(l.names.size, 0.6);
  assert.equal(l.names.inviterColor, 'rgba(246,241,230,.72)');
});

test('a layout the administrator did configure is preserved', () => {
  const l = normalizeLayout({
    area: { top: 20, left: 10, width: 80, height: 55 },
    align: 'center',
    columns: 3,
    title: { show: false, text: 'VIPs', size: 5, color: '#123456' },
    names: { showInviter: false, size: 1.8, gap: 1.2 },
  });
  assert.deepEqual(l.area, { top: 20, left: 10, width: 80, height: 55 });
  assert.equal(l.align, 'center');
  assert.equal(l.columns, 3);
  assert.equal(l.title.show, false);
  assert.equal(l.title.color, '#123456');
  assert.equal(l.names.showInviter, false);
  assert.equal(l.names.gap, 1.2);
});

test('the API shape never carries image bytes or a storage path', () => {
  const row = {
    id: 42, title: 'Golden Pulpit', filename: 'gold.png', mime_type: 'image/png',
    byte_size: 1024, width: 1920, height: 1080, checksum: sha256(png(1920, 1080)),
    storage_kind: 'database', storage_path: 'vip-designs/secret.png', data: Buffer.alloc(64),
    is_enabled: true, display_mode: 'background', layout: {},
    created_at: new Date('2026-10-15T02:00:00Z'), updated_at: new Date('2026-10-15T02:00:00Z'),
  };
  const shaped = shapeDesign(row);
  assert.equal('data' in shaped, false, 'no image bytes reach the browser');
  assert.equal('storage_path' in shaped, false, 'no storage path reaches the browser');
  assert.equal(shaped.id, '42', 'ids are text so JavaScript never rounds a bigint');
  assert.equal(shaped.orientation, 'landscape');
  assert.equal(shaped.uploaded_at, '2026-10-15T02:00:00.000Z');
  assert.equal(shaped.url, `/api/public/vip-design-image/42/${shaped.checksum.slice(0, 12)}.png`);
});

test('the service-date list is plain Sunday date strings', () => {
  const sundays = selectableSundays('2026-10-13');
  assert.ok(sundays.length >= 12, 'offers past and future Sundays');
  for (const s of sundays) {
    assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${s}T12:00:00Z`).getUTCDay(), 0, `${s} is a Sunday`);
  }
  assert.ok(sundays.includes('2026-10-18'), 'includes this Sunday');
  assert.deepEqual(sundays, [...sundays].sort(), 'in date order');
});

test('each Sunday gets a different design instead of the same one repeating', async () => {
  const src = await read('src/vip-designs.js');
  assert.match(src, /const RECENT_LOOKBACK_LIMIT = \d+/, 'the no-repeat rule has a bounded look-back');
  assert.match(src, /async function recentDesignIds\(/, 'the designs used on recent Sundays are read back');
  assert.match(src, /d\.is_enabled\s*\n?/, 'disabled artwork is not counted as a recent pick');
  assert.match(src, /Math\.min\(enabled - 1, RECENT_LOOKBACK_LIMIT\)/, 'a library of N designs skips its N-1 most recent picks');
  assert.match(src, /NOT \(id = ANY\(\$2::bigint\[\]\)\)/, 'the pick excludes those designs');
  assert.match(src, /ORDER BY random\(\) LIMIT 1/, 'and stays random within what is left');
  const plan = src.slice(src.indexOf('async function exclusionPlan'), src.indexOf('export async function designForSunday'));
  assert.match(plan, /\[recent, previous === null \? \[\] : \[String\(previous\)\], \[\]\]/, 'the plan relaxes to the previous Sunday, then to no rule at all');
  assert.match(plan, /plan\.push\(ids\)/, 'so an exhausted pool still resolves instead of leaving the Sunday blank');
});

test('without object storage configured the bytes stay in PostgreSQL', () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(storageKind(), 'database');
  assert.equal(storageKind() === 'supabase' && !process.env.SUPABASE_SERVICE_ROLE_KEY, false);
});

test('migration 008 stores the library and one selection per Sunday', async () => {
  const sql = await read('database/008_vip_design_library.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS vip_designs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS vip_service_designs/);
  assert.match(sql, /service_date date PRIMARY KEY CHECK \(EXTRACT\(DOW FROM service_date\) = 0\)/, 'one row per Sunday, and only on a Sunday');
  assert.match(sql, /checksum text NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS vip_designs_checksum_uniq ON vip_designs \(checksum\)/, 'the same artwork cannot be stored twice');
  assert.match(sql, /mime_type text NOT NULL CHECK/, 'the database refuses other formats too');
  assert.match(sql, /storage_kind text NOT NULL CHECK \(storage_kind IN \('supabase','database'\)\)/);
  assert.match(sql, /storage_kind = 'supabase' AND storage_path IS NOT NULL AND data IS NULL/, 'bytes live in exactly one place');
  assert.match(sql, /design_id bigint REFERENCES vip_designs\(id\) ON DELETE SET NULL/, 'deleting a design never deletes a service record');
  assert.match(sql, /pg_advisory_xact_lock\(72114026\)/, 'same write lock the rest of the tracker uses');
});

test('design management is administrator-only, and only the image is public', async () => {
  const app = await read('src/app.js');
  assert.match(app, /vipDesigns\.use\(requireStaff/, 'every design route needs a signed-in staff member');
  assert.match(app, /requirePermission\(req\.actor,'settings:manage'\)/, 'and the settings permission');
  assert.match(app, /const designWrite=\(req,res,next\)=>\{try\{checkOrigin\(req\);checkCsrf\(req\);/, 'writes are origin- and CSRF-checked');
  assert.doesNotMatch(app, /designWrite[^;]*vipDesigns\.get\(/, 'the CSRF guard is never applied to a GET');

  const publicApi = await read('src/public-api.js');
  assert.match(publicApi, /publicRouter\.get\('\/vip-design-image\/:id\/:file'/);
  assert.match(publicApi, /checksum\.slice\(0,12\)!==hash/, 'a mismatched checksum in the URL is a 404');
  assert.match(publicApi, /max-age=31536000, immutable/, 'artwork is cached so the projector does not re-download it');
  assert.doesNotMatch(publicApi, /storage_path/, 'the public route never exposes a storage path');
});

test('no service-role key or storage secret ships to the browser', async () => {
  const files = [
    'public/admin/js/api.js',
    'public/admin/js/views/designs.js',
    'public/admin/js/app.js',
    'public/vip-announce/app.js',
    'public/vip-announce/index.html',
  ];
  for (const f of files) {
    const src = await read(f);
    assert.doesNotMatch(src, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/, `${f} must not read the service-role key`);
    assert.doesNotMatch(src, /eyJhbGciOi/, `${f} must not contain a JWT`);
  }
});

test('the admin screen manages designs and never invents one', async () => {
  const view = await read('public/admin/js/views/designs.js');
  assert.match(view, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(view, /\smultiple\s/, 'the picker takes several files at once');
  assert.match(view, /data-drop/, 'drag and drop');
  assert.match(view, /api\.uploadDesign\(/, 'uploads go through the API, not a code change');
  assert.match(view, /onProgress/, 'upload progress is reported');
  assert.match(view, /data-act="rename"/);
  assert.match(view, /data-act="toggle"/, 'enable or disable');
  assert.match(view, /confirmDialog\(\{\s*\n?\s*title: 'Delete this design\?'/, 'deletion asks first');
  assert.match(view, /href="\/vip-announce\?preview=1"/, 'one click previews the design on the projector');
  assert.match(view, /data-act="roll"/, 'randomly select');
  assert.match(view, /data-act="pin"/, 'use this design for this Sunday');
  assert.match(view, /data-act="reset"/, 'reset to automatic');
  assert.match(view, /those stay fixed/, 'warns about sample data baked into a full-background image');
  assert.match(view, /no design is invented/, 'an empty library points at the branded fallback');
  // selectableSundays() returns date strings, so the picker must use them as-is.
  assert.match(view, /list\.includes\(library\.today_sunday\)/);
  assert.doesNotMatch(view, /\.service_date\b/, 'sundays are date strings here, not objects');
  assert.doesNotMatch(view, /innerHTML\s*=\s*[`'"][^`'"]*\$\{(?!esc\(|icon\(|html`|url|esc)/, 'interpolations are escaped');

  const app = await read('public/admin/js/app.js');
  assert.match(app, /path:\s*\/\^\\\/designs\$\//, 'the screen is a route in the existing admin portal');
  assert.match(app, /perm:\s*'settings:manage'/, 'and it is permission-gated');
});

test('the projector shows the selected design only during the announcement', async () => {
  const js = await read('public/vip-announce/app.js');
  const html = await read('public/vip-announce/index.html');
  const css = await read('public/vip-announce/styles.css');

  assert.match(html, /id="designLayer"/);
  assert.match(html, /id="designImg"/);
  assert.match(html, /id="designOverlay"/);
  assert.match(html, /id="designError"/);
  assert.match(js, /previewMode = new URLSearchParams\(location\.search\)\.get\('preview'\) === '1'/, '?preview=1 lets the tech team check a design before Sunday');
  assert.match(js, /previewMode \|\| payload\.state === 'VIP_ANNOUNCEMENT'/, 'preview is presentational — it never changes the server cycle state');
  assert.doesNotMatch(js, /payload\.state\s*=[^=]/, 'preview mode must not write to the payload');
  assert.match(js, /renderDesign\(payload\)/, 'the payload drives the design');
  assert.match(js, /payload\.state === 'VIP_ANNOUNCEMENT'/, 'the design covers the screen only in announcement mode');
  assert.match(js, /el\.designImg\.dataset\.src !== design\.url/, 'a background refresh does not re-download the artwork');
  assert.match(js, /payload\.service_date_display/, 'the date comes from the database');
  assert.match(js, /for \(const vip of payload\.vips\)/, 'the names come from the database');
  assert.match(js, /Invited by \$\{vip\.inviter\}/, 'the inviters come from the database');
  assert.match(js, /countParts\(payload\.total\)/, 'the count comes from the database');
  assert.match(js, /No VIP registrations recorded for this Sunday yet\./, 'an empty Sunday says so instead of inventing names');
  assert.match(js, /el\.designError\.hidden = false/, 'a design that will not load falls back to the branded layout');
  assert.match(css, /object-fit:\s*contain/, 'the artwork keeps its aspect ratio');
  assert.match(css, /\.stage\.has-design \.frame,[\s\S]*?\.stage\.has-design \.stage-grain\{display:none\}/, 'the branded board steps aside for the design');
  assert.doesNotMatch(js, /innerHTML\s*=/, 'live VIP data is inserted as text, never as HTML');
});

test('the announcement payload carries the design alongside the live VIP data', async () => {
  const src = await read('src/vip-announcement.js');
  assert.match(src, /ensureDesignSelection/, 'the selection is made in the database, not per browser');
  assert.match(src, /design: design \|\| null,/, 'the payload exposes the chosen design');
  assert.match(src, /design_selection: selection \|\| null,/, 'and how it was chosen');
  assert.match(src, /designs_available: available \|\| null,/, 'and what was available to choose from');
  assert.match(src, /\.catch\(\(e\) => \(\{ design: null/, 'a storage failure degrades to the branded layout');
});
