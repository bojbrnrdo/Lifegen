// VIP Design Library — administrator-uploaded announcement designs and the
// database-backed per-Sunday selection.
//
// Storage: Supabase Storage when it is configured, otherwise the bytes live in
// PostgreSQL (vip_designs.data). A server filesystem is deliberately NOT used:
// Vercel's filesystem is ephemeral, so files written there would vanish on the
// next deployment. Service-role credentials are read here, on the server, and
// are never returned to a browser.

import crypto from 'node:crypto';
import { query, transaction, allocateId, logAction } from './db.js';
import { httpError, isSunday } from './domain.js';
import { isSundayKey, attributeServiceDate } from './service-cycle.js';

export const ALLOWED_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
});

export const DISPLAY_MODES = Object.freeze(['background', 'template']);

const MB = 1024 * 1024;
export const MAX_BYTES = Math.min(
  25 * MB,
  Math.max(1 * MB, Number(process.env.VIP_DESIGN_MAX_BYTES) || 8 * MB),
);
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'vip-designs';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// A Buffer, or null. A request body can arrive as an array or a string when a
// parameter is repeated, and neither of those is image bytes, so both shapes are
// refused up front — before any byte is read. Accepts a Buffer or any typed-array
// view of one and refuses everything else, so a value that arrived from an HTTP
// body can never be read as a string or an array by the header parsers below.
function asBuffer(input) {
  if (Array.isArray(input)) return null;
  if (typeof input === 'string') return null;
  if (Buffer.isBuffer(input)) return input;
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return null;
}

// ---- Object storage ---------------------------------------------------------
export function storageConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function storageKind() {
  return storageConfigured() ? 'supabase' : 'database';
}

async function supabaseFetch(path, init = {}) {
  const base = String(process.env.SUPABASE_URL).replace(/\/$/, '');
  const res = await fetch(`${base}/storage/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch { /* no body */ }
    throw httpError(502, `Design storage rejected the request (${res.status}). ${detail}`.trim());
  }
  return res;
}

async function putBytes(storagePath, mime, buffer) {
  await supabaseFetch(`object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { 'Content-Type': mime, 'x-upsert': 'true' },
    body: new Uint8Array(buffer),
  });
}

async function readBytes(storagePath) {
  const res = await supabaseFetch(`object/${BUCKET}/${storagePath}`);
  return Buffer.from(await res.arrayBuffer());
}

async function removeBytes(storagePath) {
  await supabaseFetch(`object/${BUCKET}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [storagePath] }),
  });
}

// ---- Image validation -------------------------------------------------------
// Dimensions are read from the file header, so no imaging dependency is needed
// and a mislabelled file cannot claim to be something it is not.
export function sniffImage(input) {
  // Narrowed to real bytes up front. The body reaches this module as req.body,
  // which Express types loosely, so the shape is checked here rather than
  // trusted: an array or a string is never image bytes, and every read below
  // then runs on a known Buffer.
  if (Array.isArray(input)) return null;
  if (typeof input === 'string') return null;
  const b = asBuffer(input);
  if (!b || b.length < 32) return null;

  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    if (b.toString('latin1', 12, 16) !== 'IHDR') return { mime: 'image/png', ext: 'png' };
    return { mime: 'image/png', ext: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      // SOFn carries the dimensions; C4/C8/CC are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', ext: 'jpg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const fourcc = b.toString('latin1', 12, 16);
    if (fourcc === 'VP8X') {
      const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { mime: 'image/webp', ext: 'webp', width, height };
    }
    if (fourcc === 'VP8L' && b[21] === 0x2f) {
      const bits = b.readUInt32LE(22);
      return { mime: 'image/webp', ext: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { mime: 'image/webp', ext: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

export function validateImage(input, declaredName = '') {
  // Same shape check as sniffImage: a repeated parameter can turn the body into
  // an array or a string, and neither is an upload.
  if (Array.isArray(input)) throw httpError(400, 'The upload was empty.');
  if (typeof input === 'string') throw httpError(400, 'The upload was empty.');
  const buffer = asBuffer(input);
  if (!buffer || !buffer.length) throw httpError(400, 'The upload was empty.');
  if (buffer.length > MAX_BYTES) {
    throw httpError(413, `That design is ${(buffer.length / MB).toFixed(1)} MB. The limit is ${(MAX_BYTES / MB).toFixed(0)} MB.`);
  }
  const sniffed = sniffImage(buffer);
  if (!sniffed) throw httpError(415, 'Upload a PNG, JPG or WebP image. The file contents were not a recognized image.');
  const name = String(declaredName || '').replace(/[^\w.\- ]+/g, '').slice(-160) || `design.${sniffed.ext}`;
  if (sniffed.width && sniffed.height && sniffed.width < sniffed.height) {
    // Not fatal — some designs are portrait — but the projector is widescreen.
    sniffed.orientation = 'portrait';
  } else if (sniffed.width && sniffed.height) {
    sniffed.orientation = 'landscape';
  }
  return { ...sniffed, filename: name, byte_size: buffer.length };
}

// ---- Layout configuration (template mode) -----------------------------------
const clampNum = (v, fallback, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const cleanColor = (v, fallback) => {
  const s = String(v ?? '').trim();
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(s) ? s : fallback;
};

export function normalizeLayout(input = {}) {
  const src = input || {};
  const area = src.area || {};
  const title = src.title || {};
  const date = src.date || {};
  const count = src.count || {};
  const names = src.names || {};
  return {
    area: {
      top: clampNum(area.top, 16, 0, 90),
      left: clampNum(area.left, 7, 0, 90),
      width: clampNum(area.width, 86, 5, 100),
      height: clampNum(area.height, 62, 5, 100),
    },
    align: ['left', 'center', 'right'].includes(src.align) ? src.align : 'left',
    columns: clampNum(src.columns, 2, 1, 4),
    title: { show: title.show !== false, text: String(title.text ?? 'Welcome our VIPs').slice(0, 120), size: clampNum(title.size, 5.2, 1, 20), color: cleanColor(title.color, '#F6F1E6') },
    date: { show: date.show !== false, size: clampNum(date.size, 2.2, 0.6, 12), color: cleanColor(date.color, '#D9B44A') },
    count: { show: count.show !== false, size: clampNum(count.size, 2.6, 0.6, 14), color: cleanColor(count.color, '#D4AF37') },
    names: {
      show: names.show !== false,
      showInviter: names.showInviter !== false,
      size: clampNum(names.size, 1.9, 0.6, 12),
      inviterSize: clampNum(names.inviterSize, 1.1, 0.5, 8),
      color: cleanColor(names.color, '#F6F1E6'),
      inviterColor: cleanColor(names.inviterColor, 'rgba(246,241,230,.72)'),
      gap: clampNum(names.gap, 1.4, 0.2, 12),
    },
  };
}

// ---- Shape ------------------------------------------------------------------
// Never includes the image bytes or the storage path: browsers only ever receive
// metadata plus a URL to the public image route.
export function shapeDesign(row) {
  return {
    id: String(row.id),
    title: row.title,
    filename: row.filename,
    mime_type: row.mime_type,
    byte_size: Number(row.byte_size),
    width: row.width ? Number(row.width) : null,
    height: row.height ? Number(row.height) : null,
    orientation: row.width && row.height ? (row.width >= row.height ? 'landscape' : 'portrait') : null,
    checksum: row.checksum,
    storage_kind: row.storage_kind,
    is_enabled: row.is_enabled,
    display_mode: row.display_mode,
    layout: normalizeLayout(row.layout),
    uploaded_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
    url: `/api/public/vip-design-image/${row.id}/${row.checksum.slice(0, 12)}.${ALLOWED_TYPES[row.mime_type] || 'png'}`,
  };
}

const DESIGN_COLUMNS = 'id,title,filename,mime_type,byte_size,width,height,checksum,storage_kind,is_enabled,display_mode,layout,created_at,updated_at';

// ---- Queries ----------------------------------------------------------------
export async function listDesigns({ includeDisabled = true } = {}, client = { query }) {
  const sql = includeDisabled
    ? `SELECT ${DESIGN_COLUMNS} FROM vip_designs ORDER BY created_at DESC, id DESC`
    : `SELECT ${DESIGN_COLUMNS} FROM vip_designs WHERE is_enabled ORDER BY created_at DESC, id DESC`;
  const { rows } = await client.query(sql);
  return rows.map(shapeDesign);
}

export async function countDesigns(client = { query }) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_enabled)::int AS enabled FROM vip_designs`,
  );
  return { total: rows[0]?.total || 0, enabled: rows[0]?.enabled || 0 };
}

export async function getDesign(id, client = { query }) {
  const { rows } = await client.query(`SELECT ${DESIGN_COLUMNS} FROM vip_designs WHERE id=$1`, [Number(id)]);
  return rows[0] ? shapeDesign(rows[0]) : null;
}

// Upload one design. Duplicate files (same bytes) are rejected rather than
// stored twice, which keeps the rotation pool honest.
export async function createDesign({ buffer, title, displayMode, layout, actorId }, client = { query }) {
  const info = validateImage(buffer);
  const checksum = sha256(buffer);
  const existing = await client.query('SELECT id FROM vip_designs WHERE checksum=$1', [checksum]);
  if (existing.rows[0]) throw httpError(409, 'That exact file is already in the library. Rename or edit the existing design instead of uploading it again.');

  const kind = storageKind();
  const id = await allocateId(client, 'vip_designs');
  const storagePath = kind === 'supabase' ? `${id}/${checksum}.${info.ext}` : null;
  if (kind === 'supabase') await putBytes(storagePath, info.mime, buffer);

  try {
    const mode = DISPLAY_MODES.includes(displayMode) ? displayMode : 'background';
    await client.query(
      `INSERT INTO vip_designs
         (id,title,filename,mime_type,byte_size,width,height,checksum,storage_kind,storage_path,data,display_mode,layout,uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        String(title || '').trim().slice(0, 160) || info.filename.replace(/\.[^.]+$/, '').slice(0, 160) || 'Untitled design',
        info.filename,
        info.mime,
        info.byte_size,
        info.width || null,
        info.height || null,
        checksum,
        kind,
        storagePath,
        kind === 'database' ? buffer : null,
        mode,
        JSON.stringify(normalizeLayout(layout)),
        actorId || null,
      ],
    );
    await logAction(client, actorId || null, 'vip_designs', id, 'design_uploaded', { filename: info.filename, byte_size: info.byte_size, storage_kind: kind });
  } catch (e) {
    // Do not leave an orphaned object behind if the row could not be written.
    if (kind === 'supabase') await removeBytes(storagePath).catch(() => {});
    throw e;
  }
  return getDesign(id, client);
}

export async function updateDesign(id, body = {}, client = { query }) {
  const current = await client.query(`SELECT ${DESIGN_COLUMNS} FROM vip_designs WHERE id=$1`, [Number(id)]);
  if (!current.rows[0]) throw httpError(404, 'That design is not in the library.');
  const row = current.rows[0];
  const title = body.title === undefined ? row.title : String(body.title).trim().slice(0, 160);
  if (!title) throw httpError(400, 'A design needs a display title.');
  const is_enabled = body.is_enabled === undefined ? row.is_enabled : body.is_enabled === true;
  const display_mode = body.display_mode === undefined ? row.display_mode
    : (DISPLAY_MODES.includes(body.display_mode) ? body.display_mode : row.display_mode);
  const layout = body.layout === undefined ? row.layout : JSON.stringify(normalizeLayout(body.layout));
  await client.query(
    'UPDATE vip_designs SET title=$2,is_enabled=$3,display_mode=$4,layout=$5,updated_at=now() WHERE id=$1',
    [Number(id), title, is_enabled, display_mode, layout],
  );
  return getDesign(id, client);
}

export async function deleteDesign(id, actorId, client = { query }) {
  const current = await client.query('SELECT storage_kind,storage_path FROM vip_designs WHERE id=$1', [Number(id)]);
  if (!current.rows[0]) throw httpError(404, 'That design is not in the library.');
  await client.query('DELETE FROM vip_designs WHERE id=$1', [Number(id)]);
  await logAction(client, actorId || null, 'vip_designs', Number(id), 'design_deleted', {});
  if (current.rows[0].storage_kind === 'supabase' && current.rows[0].storage_path) {
    await removeBytes(current.rows[0].storage_path).catch(() => {});
  }
  return { deleted: true };
}

// Bytes for the public image route.
export async function readDesignBytes(id, client = { query }) {
  const { rows } = await client.query('SELECT mime_type,storage_kind,storage_path,data,checksum FROM vip_designs WHERE id=$1', [Number(id)]);
  const row = rows[0];
  if (!row) throw httpError(404, 'That design is no longer available.');
  const bytes = row.storage_kind === 'database' ? row.data : await readBytes(row.storage_path);
  return { mime_type: row.mime_type, bytes, checksum: row.checksum };
}

// ---- Selection --------------------------------------------------------------
function previousSunday(dateKey) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// How far back the "different design every Sunday" rule looks. A library of N
// designs is walked through N different ones before any artwork repeats.
const RECENT_LOOKBACK_LIMIT = 8;

// The design used on the Sunday before this one, if that Sunday was picked.
async function lastPickedDesignId(client, serviceDate) {
  const { rows } = await client.query(
    'SELECT design_id FROM vip_service_designs WHERE service_date=$1 AND design_id IS NOT NULL',
    [previousSunday(serviceDate)],
  );
  return rows[0]?.design_id ?? null;
}

// The designs used on the most recent Sundays before this one, newest first,
// one entry per design. Designs that have since been deleted (design_id NULL)
// or disabled are left out: they can never be picked, so counting them would
// only shrink the pool and force an early repeat.
async function recentDesignIds(client, serviceDate, limit) {
  if (limit < 1) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT ON (s.design_id) s.design_id, s.service_date
       FROM vip_service_designs s JOIN vip_designs d ON d.id = s.design_id
      WHERE s.service_date < $1 AND s.design_id IS NOT NULL AND d.is_enabled
      ORDER BY s.design_id, s.service_date DESC`,
    [serviceDate],
  );
  return rows
    .sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)))
    .slice(0, limit)
    .map((r) => String(r.design_id));
}

// The designs a pick must avoid, most restrictive first. The last entry is
// always empty, so an exhausted pool still resolves instead of leaving the
// Sunday blank.
async function exclusionPlan(client, serviceDate) {
  const { enabled } = await countDesigns(client);
  const recent = enabled > 1
    ? await recentDesignIds(client, serviceDate, Math.min(enabled - 1, RECENT_LOOKBACK_LIMIT))
    : [];
  const previous = await lastPickedDesignId(client, serviceDate);
  const plan = [];
  const seen = new Set();
  for (const ids of [recent, previous === null ? [] : [String(previous)], []]) {
    const key = ids.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    plan.push(ids);
  }
  return plan;
}

// The design for one Sunday. Selection happens in the database, so every device
// and every refresh sees the same choice; the primary key on service_date makes
// concurrent callers race-free.
export async function designForSunday(serviceDate, client = { query }) {
  if (!isSundayKey(serviceDate)) throw httpError(400, 'A Sunday service date is required.');

  const current = async () => (await client.query(
    `SELECT s.design_id, s.selection_mode, s.selected_at, ${DESIGN_COLUMNS.replace(/(^|,)/g, '$1d.')}
       FROM vip_service_designs s LEFT JOIN vip_designs d ON d.id = s.design_id
      WHERE s.service_date=$1`,
    [serviceDate],
  )).rows[0];

  let row = await current();

  // A deleted design leaves design_id NULL (ON DELETE SET NULL). Clear that stale
  // row so the insert below can run — otherwise ON CONFLICT would keep skipping
  // it and the Sunday would stay empty forever. Callers that need this to be
  // race-safe go through ensureDesignSelection(), which serialises the write.
  if (row && !row.id) {
    await client.query('DELETE FROM vip_service_designs WHERE service_date=$1', [serviceDate]);
    row = null;
  }

  if (!row) {
    // "Different design every Sunday": skip the artwork used on the recent
    // Sundays, so a library of N designs plays through N different ones before
    // anything comes round again. Each later attempt relaxes the rule — first to
    // just the previous Sunday, then to no rule at all — so a library of exactly
    // one design (or a pool worn down by disabling) still resolves.
    for (const exclude of await exclusionPlan(client, serviceDate)) {
      await client.query(
        `INSERT INTO vip_service_designs (service_date, design_id, selection_mode)
         SELECT $1, pick.id, 'automatic' FROM (
           SELECT id FROM vip_designs
            WHERE is_enabled AND NOT (id = ANY($2::bigint[]))
            ORDER BY random() LIMIT 1
         ) pick
         ON CONFLICT (service_date) DO NOTHING`,
        [serviceDate, exclude],
      );
      row = await current();
      if (row && row.id) break;
    }
  }

  if (!row || !row.id) {
    // Empty library (or every design disabled). The projector falls back to its
    // branded layout; no design is invented.
    return { design: null, selection: row ? { mode: row.selection_mode, service_date: serviceDate } : null, available: await countDesigns(client) };
  }

  return {
    design: shapeDesign(row),
    selection: {
      service_date: serviceDate,
      mode: row.selection_mode,
      design_id: String(row.id),
      selected_at: row.selected_at instanceof Date ? row.selected_at.toISOString() : String(row.selected_at || ''),
      design_enabled: row.is_enabled,
    },
    available: await countDesigns(client),
  };
}

// Selection with the write serialised. transaction() takes the same global
// advisory write lock every other LIFEGEN write uses, so two projectors opening
// the same Sunday at the same instant cannot end up with different designs.
// The common case — a valid row already exists — performs no write at all.
export async function ensureDesignSelection(serviceDate) {
  if (!isSundayKey(serviceDate)) throw httpError(400, 'A Sunday service date is required.');
  return transaction(async (client) => designForSunday(serviceDate, client), { write: true });
}

// Administrator override. mode 'manual' pins a design; 'automatic' clears the
// pin so the next read re-selects. A refresh or a background poll can never
// overwrite a manual pin, because the row already exists.
export async function setSelection({ serviceDate, designId, mode, actorId }, client = { query }) {
  if (!isSundayKey(serviceDate)) throw httpError(400, 'Choose a Sunday service date.');
  if (mode === 'manual') {
    const found = await client.query('SELECT id,is_enabled FROM vip_designs WHERE id=$1', [Number(designId)]);
    if (!found.rows[0]) throw httpError(404, 'Choose a design that is in the library.');
    await client.query(
      `INSERT INTO vip_service_designs (service_date, design_id, selection_mode, selected_by)
       VALUES ($1,$2,'manual',$3)
       ON CONFLICT (service_date)
       DO UPDATE SET design_id=EXCLUDED.design_id, selection_mode='manual', selected_by=EXCLUDED.selected_by, selected_at=now()`,
      [serviceDate, Number(designId), actorId || null],
    );
    await logAction(client, actorId || null, 'vip_service_designs', serviceDate, 'design_manual_select', { design_id: Number(designId) });
  } else {
    await client.query('DELETE FROM vip_service_designs WHERE service_date=$1', [serviceDate]);
    await logAction(client, actorId || null, 'vip_service_designs', serviceDate, 'design_selection_reset', {});
  }
  return designForSunday(serviceDate, client);
}

// A dry-run random pick for the admin preview: it does not write anything.
export async function previewRandomPick(serviceDate, client = { query }) {
  if (!isSundayKey(serviceDate)) throw httpError(400, 'Choose a Sunday service date.');
  // Same exclusion plan the real pick uses, so the preview shows the sort of
  // design this Sunday would actually get.
  for (const avoid of await exclusionPlan(client, serviceDate)) {
    const { rows } = await client.query(
      `SELECT ${DESIGN_COLUMNS} FROM vip_designs
        WHERE is_enabled AND NOT (id = ANY($1::bigint[]))
        ORDER BY random() LIMIT 1`,
      [avoid],
    );
    if (rows[0]) return shapeDesign(rows[0]);
  }
  return null;
}

// The Sundays an administrator can pick from: today's cycle Sunday plus a window.
export function selectableSundays(todayKey, { before = 4, after = 8 } = {}) {
  const out = [];
  const start = new Date(`${todayKey}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() || 7)) - before * 7);
  for (let i = 0; i < before + after + 2; i += 1) {
    out.push(start.toISOString().slice(0, 10));
    start.setUTCDate(start.getUTCDate() + 7);
  }
  return out;
}

export { transaction, isSunday, attributeServiceDate };
