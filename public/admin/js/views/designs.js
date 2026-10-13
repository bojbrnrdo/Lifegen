/**
 * VIP Design Library — administrator management of the uploaded announcement
 * designs and the per-Sunday design selection.
 *
 * This is a management screen only. The public site is unchanged apart from the
 * existing /vip-announce projector, which reads the selected design from the API.
 *
 * API shapes this file depends on (see src/app.js and src/vip-designs.js):
 *   GET /api/vip-designs ->
 *     { storage, storage_bucket, max_bytes, allowed_types: ['image/png', ...],
 *       today, today_sunday, timezone, sundays: ['YYYY-MM-DD', ...],
 *       counts: { total, enabled }, designs: [...] }
 * `sundays` is a plain list of date strings (src/vip-designs.js selectableSundays)
 * and design ids arrive as strings, so every lookup here compares text to text.
 *   GET /api/vip-designs/selection/:date ->
 *     { design, selection: { service_date, mode, design_id, selected_at,
 *       design_enabled }, available: { total, enabled } }
 * `sunday` below is always a YYYY-MM-DD string, never one of those objects.
 */
import { api } from '../api.js';
import { esc, html, icon, toast, confirmDialog, errorState, fmtDateTime, emptyState } from '../ui.js';

let main = null;             // element this view owns
let library = null;          // GET /api/vip-designs
let selection = null;        // GET /api/vip-designs/selection/:date
let sunday = null;           // YYYY-MM-DD currently inspected
let previewPick = null;      // dry-run random pick, not yet pinned
const thumbs = new Map();    // design id -> object URL
let aborted = false;

const mb = (n) => `${(Number(n) / (1024 * 1024)).toFixed(1)} MB`;
const fmtSunday = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};
const findDesign = (id) => library.designs.find((d) => String(d.id) === String(id));
// 'image/png' -> 'PNG', so the storage note reads cleanly.
const typeLabel = (t) => String(t).split('/')[1]?.toUpperCase() || String(t);

// The Sunday the projector is on right now, falling back to the first listed.
function defaultSunday() {
  const list = library?.sundays ?? [];
  if (list.includes(library.today_sunday)) return library.today_sunday;
  return list.find((s) => s >= library.today) || list[0] || null;
}

// Thumbnails are fetched through the API (not a bare <img src>) so the request
// carries the admin session header in sandboxed previews where cookies are dropped.
async function thumbUrl(design) {
  const key = String(design.id);
  if (thumbs.has(key)) return thumbs.get(key);
  try {
    const blob = await api.blob(`/api/vip-designs/${encodeURIComponent(design.id)}/file`);
    const url = URL.createObjectURL(blob);
    thumbs.set(key, url);
    return url;
  } catch {
    return null;
  }
}

function uploadRow(file, status, detail) {
  return html`<li class="dl-upload__row" data-file="${esc(file.name)}">
    <span class="dl-upload__name" title="${esc(file.name)}">${esc(file.name)}</span>
    <span class="dl-upload__bar"><i style="width:${status === 'error' ? 100 : 0}%" data-bar></i></span>
    <span class="dl-upload__status" data-status>${esc(detail)}</span>
  </li>`;
}

function designCard(d) {
  const badge = d.is_enabled
    ? html`<span class="badge badge--present">Available</span>`
    : html`<span class="badge badge--absent">Disabled</span>`;
  const modeBadge = d.display_mode === 'template'
    ? html`<span class="badge badge--returning">Background template</span>`
    : html`<span class="badge">Full background</span>`;
  const dims = d.width && d.height ? `${d.width} × ${d.height}` : 'dimensions unknown';
  const uploaded = d.uploaded_at || d.created_at;
  return html`<article class="card dl-card${d.is_enabled ? '' : ' dl-card--off'}" data-id="${esc(d.id)}">
    <div class="dl-thumb" data-thumb="${esc(d.id)}">
      <div class="loading">Loading preview…</div>
      ${d.orientation === 'portrait' ? html`<span class="dl-thumb__warn" title="Portrait artwork — it will be letterboxed on a widescreen projector">${icon('warn', 13)} Portrait</span>` : ''}
    </div>
    <div class="card__body dl-card__body">
      <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
        <h3 class="dl-card__title" data-title>${esc(d.title)}</h3>
        ${badge}
      </div>
      <p class="small muted dl-card__meta">
        ${esc(d.filename)} · ${esc(mb(d.byte_size))}<br />
        ${esc(dims)}${d.orientation ? ` · ${esc(d.orientation)}` : ''}<br />
        Uploaded ${esc(fmtDateTime(uploaded))}${d.uploaded_by ? ` · ${esc(d.uploaded_by)}` : ''}
      </p>
      <div class="row" style="gap:6px;margin-top:8px">${modeBadge}</div>
      <label class="field" style="margin-top:10px">
        <span class="small">Display mode</span>
        <select data-mode>
          <option value="background"${d.display_mode === 'background' ? ' selected' : ''}>Full background — show the image as provided</option>
          <option value="template"${d.display_mode === 'template' ? ' selected' : ''}>Background template — overlay live VIP data</option>
        </select>
      </label>
      <div class="row dl-card__actions">
        <button class="btn btn--sm" data-act="rename">${icon('edit', 15)} Rename</button>
        <button class="btn btn--sm" data-act="preview">${icon('camera', 15)} Preview</button>
        <button class="btn btn--sm" data-act="toggle">${d.is_enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn btn--sm btn--danger" data-act="delete">${icon('trash', 15)} Delete</button>
      </div>
    </div>
  </article>`;
}

function selectionPanel() {
  const current = selection?.design;
  const mode = selection?.selection?.mode;
  const available = selection?.available ?? library?.counts ?? { total: 0, enabled: 0 };
  const staticWarning = current && current.display_mode === 'background'
    ? html`<p class="callout callout--warn"><b>${icon('info', 15)} Heads up.</b> “${esc(current.title)}” is set to <b>full background</b>, so the projector shows it exactly as uploaded. If the artwork contains sample names, a date or a count, those stay fixed. Switch it to <b>background template</b> to overlay the live VIP list instead.</p>`
    : '';
  const sundayLabel = sunday ? fmtSunday(sunday) : 'no Sunday available';
  return html`<div class="card">
    <div class="card__head"><h2>${icon('pin', 18)} Sunday selection</h2>
      <span class="small muted" data-sel-count>${available.enabled} available for selection · ${available.total} designs in the library</span></div>
    <div class="card__body">
      <div class="row" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
        <label class="field" style="min-width:260px">
          <span class="small">Service date</span>
          <select data-sunday>
            ${(library.sundays || []).map((iso) => html`<option value="${esc(iso)}"${iso === sunday ? ' selected' : ''}>${esc(fmtSunday(iso))}${iso === library.today_sunday ? ' — this Sunday' : ''}</option>`)}
          </select>
        </label>
        <button class="btn" data-act="roll" data-pick>${icon('chart', 16)} Randomly select</button>
        <button class="btn btn--primary" data-act="pin" data-apply${previewPick ? '' : ' disabled'}>${icon('check', 16)} Use this design for this Sunday</button>
        <button class="btn" data-act="reset" data-reset${mode === 'manual' ? '' : ' disabled'}>${icon('undo', 16)} Reset to automatic</button>
      </div>

      <div class="dl-sel">
        <div class="dl-sel__thumb" data-sel-thumb>${current ? html`<div class="loading">Loading preview…</div>` : ''}</div>
        <div class="dl-sel__info">
          <p class="small muted" data-sel-when>Selection for ${esc(sundayLabel)}</p>
          ${current
            ? html`<h3 data-sel-title>${esc(current.title)}</h3>
                <p class="small muted">${esc(current.filename)} · ${esc(current.width || '?')} × ${esc(current.height || '?')} · ${esc(current.display_mode === 'template' ? 'background template' : 'full background')}</p>
                <p class="small" data-sel-mode>${mode === 'manual'
                  ? html`<b>Manually chosen</b> — this stays put until you reset it. A refresh or a background update will not change it.`
                  : html`<b>Automatic</b> — chosen once for this Sunday and reused by every device.`}</p>
                ${selection.selection?.design_enabled === false ? html`<p class="callout callout--warn"><b>${icon('warn', 15)}</b> This design is now disabled. It stays for this Sunday so the projector is not interrupted mid-service; reset to automatic or pick another to change it.</p>` : ''}`
            : available.enabled === 0
              ? html`<h3 data-sel-title>No designs available</h3><p class="small muted">Upload and enable at least one design. Until then the projector shows the built-in branded LIFEGEN layout — no design is invented.</p>`
              : html`<h3 data-sel-title>Not selected yet</h3><p class="small muted">Choose “Randomly select” to preview a pick, or leave it — the projector picks automatically the first time it loads this Sunday.</p>`}
          ${previewPick ? html`<p class="small" style="margin-top:8px" data-preview-pick>${icon('info', 14)} Previewing <b>${esc(previewPick.title)}</b> — not saved yet.</p>` : ''}
        </div>
      </div>
      ${staticWarning}
    </div>
  </div>`;
}

function grid() {
  if (!library.designs.length) {
    return html`<div class="card"><div class="card__body">${emptyState({
      icon: 'upload',
      title: 'No designs uploaded yet',
      text: 'Drop your own VIP announcement artwork above. PNG, JPG and WebP; landscape 1920×1080 works best on a projector. Uploading never needs a code change or a redeploy.',
    })}</div></div>`;
  }
  return html`<div class="dl-grid">${library.designs.map(designCard)}</div>`;
}

function paint() {
  if (!main || aborted) return;
  main.innerHTML = html`
    <div class="page-header">
      <div>
        <h1>VIP Design Library</h1>
        <p class="sub">Upload your own announcement designs. Each Sunday the projector picks one of the enabled designs automatically.</p>
      </div>
      <div class="row" style="gap:8px">
        <a class="btn" href="/vip-announce" target="_blank" rel="noopener">${icon('link', 16)} Open projector</a>
        <a class="btn btn--primary" href="/vip-announce?preview=1" target="_blank" rel="noopener">${icon('camera', 16)} Preview on projector</a>
      </div>
    </div>

    <div class="callout" data-summary>
      <b>${icon('info', 15)} ${esc(library.counts.total)} design${library.counts.total === 1 ? '' : 's'} in the library · ${esc(library.counts.enabled)} available for selection</b>
      (timezone ${esc(library.timezone)}, this Sunday ${esc(library.today_sunday || '—')}).<br />
      <b>Storage:</b>
      ${library.storage === 'supabase'
        ? html`designs are stored in Supabase Storage (bucket <code>${esc(library.storage_bucket || '')}</code>). Metadata lives in PostgreSQL.`
        : html`object storage is not configured, so design bytes are stored in PostgreSQL (<code>vip_designs.data</code>). Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> on the server to move them into Supabase Storage instead. Either way they survive a redeploy.`}
      <span class="muted">Limit ${esc(mb(library.max_bytes))} per file · ${esc((library.allowed_types || []).map(typeLabel).join(', '))}.</span>
    </div>

    <div class="card">
      <div class="card__head"><h2>${icon('upload', 18)} Upload designs</h2>
        <span class="small muted" data-count>${library.counts.enabled} available for rotation</span></div>
      <div class="card__body">
        <div class="dl-drop" data-drop tabindex="0" role="button" aria-label="Drop design images here to upload">
          <div class="dl-drop__icon">${icon('upload', 26)}</div>
          <p><b>Drag and drop</b> several designs here, or click to choose files.</p>
          <p class="small muted">PNG, JPG or WebP · up to ${esc(mb(library.max_bytes))} each · landscape recommended. The exact same file cannot be uploaded twice.</p>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden data-input />
        </div>
        <ul class="dl-upload" data-uploads hidden></ul>
      </div>
    </div>

    ${selectionPanel()}

    <div class="page-header" style="margin-top:8px"><div><h2 style="font-size:1.1rem">Library</h2>
      <p class="sub">${library.designs.length} design${library.designs.length === 1 ? '' : 's'} · ${library.counts.enabled} enabled</p></div></div>
    ${grid()}
  `;
  wire();
  paintThumbs();
}

async function paintThumbs() {
  if (!main) return;
  for (const d of library.designs) {
    const host = main.querySelector(`[data-thumb="${CSS.escape(String(d.id))}"]`);
    if (!host) continue;
    const url = await thumbUrl(d);
    if (aborted || !host.isConnected) continue;
    host.innerHTML = url
      ? `<img src="${url}" alt="${esc(d.title)} preview" loading="lazy" />`
      : `<div class="empty" style="padding:18px"><p class="small muted">Preview unavailable</p></div>`;
    if (d.orientation === 'portrait') host.insertAdjacentHTML('beforeend', `<span class="dl-thumb__warn">${icon('warn', 13).value} Portrait</span>`);
  }
  const current = selection?.design;
  const selHost = main.querySelector('[data-sel-thumb]');
  if (selHost && current) {
    const url = await thumbUrl(current);
    if (!aborted && selHost.isConnected) {
      selHost.innerHTML = url ? `<img src="${url}" alt="${esc(current.title)}" />` : `<p class="small muted">Preview unavailable</p>`;
    }
  }
}

async function loadSelection() {
  if (!sunday) { selection = null; return; }
  try {
    selection = await api.vipDesignSelection(sunday);
    previewPick = null;
  } catch (e) {
    selection = null;
    toast(e.message, 'error');
  }
}

function wire() {
  if (!main) return;
  const drop = main.querySelector('[data-drop]');
  const input = main.querySelector('[data-input]');
  const list = main.querySelector('[data-uploads]');

  const pick = (files) => uploadFiles([...files], list);
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { pick(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => pick(e.dataTransfer?.files || []));

  const sundaySelect = main.querySelector('[data-sunday]');
  if (sundaySelect) {
    sundaySelect.addEventListener('change', async (e) => {
      sunday = e.target.value;
      await loadSelection();
      paint();
    });
  }

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const design = card ? findDesign(card.dataset.id) : null;
    const act = btn.dataset.act;
    try {
      if (act === 'roll') {
        const r = await api.vipDesignPreviewPick(sunday);
        previewPick = r.design;
        if (!previewPick) { toast('No enabled designs are available to pick from.', 'error'); return; }
        toast(`Previewing “${previewPick.title}”. Nothing is saved yet.`, 'info');
        paint();
        return;
      }
      if (act === 'pin') {
        if (!previewPick) return;
        selection = await api.vipDesignSelect(sunday, { mode: 'manual', design_id: previewPick.id });
        previewPick = null;
        toast(`“${selection.design?.title}” is now pinned to ${fmtSunday(sunday)}.`, 'success');
        paint();
        return;
      }
      if (act === 'reset') {
        const yes = await confirmDialog({ title: 'Reset to automatic selection?', message: `The projector will pick a random enabled design for ${fmtSunday(sunday)} again. Any manual choice for that Sunday is cleared.` });
        if (!yes) return;
        selection = await api.vipDesignSelect(sunday, { mode: 'automatic' });
        toast('Reset to automatic selection.', 'success');
        paint();
        return;
      }
      if (!design) return;
      if (act === 'toggle') {
        const d = await api.vipDesignUpdate(design.id, { is_enabled: !design.is_enabled });
        toast(d.is_enabled ? `“${d.title}” is available for rotation.` : `“${d.title}” is disabled and will not be picked.`, 'success');
        await refresh();
        return;
      }
      if (act === 'rename') {
        const next = window.prompt('Display title for this design', design.title);
        if (next === null) return;
        if (!next.trim()) { toast('A design needs a title.', 'error'); return; }
        await api.vipDesignUpdate(design.id, { title: next.trim() });
        await refresh();
        return;
      }
      if (act === 'preview') {
        sunday = sunday || library.today_sunday;
        previewPick = design;
        toast(`Previewing “${design.title}”. Choose “Use this design for this Sunday” to pin it to ${fmtSunday(sunday)}.`, 'info');
        paint();
        main.querySelector('[data-sel-thumb]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (act === 'delete') {
        const yes = await confirmDialog({
          title: 'Delete this design?',
          message: `“${design.title}” will be removed from the library and from storage. Sundays that already used it keep their record but will pick again. This cannot be undone.`,
          confirmText: 'Delete design',
          danger: true,
        });
        if (!yes) return;
        await api.vipDesignDelete(design.id);
        const key = String(design.id);
        if (thumbs.has(key)) { URL.revokeObjectURL(thumbs.get(key)); thumbs.delete(key); }
        toast('Design deleted.', 'success');
        await refresh();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  main.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-mode]');
    if (!sel) return;
    const design = findDesign(sel.closest('[data-id]')?.dataset.id);
    if (!design) return;
    try {
      await api.vipDesignUpdate(design.id, { display_mode: sel.value });
      toast(sel.value === 'template' ? 'Live VIP data will be overlaid on this design.' : 'This design will be shown exactly as uploaded.', 'success');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
      sel.value = design.display_mode;
    }
  });
}

function appendUploadRow(list, file, status, detail) {
  const frag = document.createRange().createContextualFragment(uploadRow(file, status, detail).value);
  const row = frag.firstElementChild;
  list.append(frag);
  return row;
}

async function uploadFiles(files, list) {
  if (!files.length) return;
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  list.hidden = false;
  list.innerHTML = '';
  const accepted = [];
  for (const f of files) {
    if (!allowed.includes(f.type)) {
      appendUploadRow(list, f, 'error', `Rejected — ${f.type || 'unknown type'} is not supported`);
      toast(`${f.name}: only PNG, JPG and WebP are supported.`, 'error');
      continue;
    }
    if (f.size > library.max_bytes) {
      appendUploadRow(list, f, 'error', `Rejected — ${mb(f.size)} is over the ${mb(library.max_bytes)} limit`);
      toast(`${f.name} is too large.`, 'error');
      continue;
    }
    accepted.push(f);
  }
  // Upload one at a time so progress rows stay readable and the server is not
  // asked to buffer several multi-megabyte images at once.
  for (const f of accepted) {
    const row = appendUploadRow(list, f, 'pending', 'Uploading…');
    const bar = row?.querySelector('[data-bar]');
    const status = row?.querySelector('[data-status]');
    try {
      await api.uploadDesign(f, {
        title: f.name.replace(/\.[^.]+$/, '').slice(0, 160),
        onProgress: (p) => { if (bar) bar.style.width = `${p}%`; if (status) status.textContent = `${p}%`; },
      });
      if (bar) { bar.style.width = '100%'; bar.classList.add('is-done'); }
      if (status) status.textContent = 'Uploaded';
    } catch (err) {
      if (bar) bar.classList.add('is-error');
      if (status) status.textContent = err.message;
      toast(`${f.name}: ${err.message}`, 'error');
    }
  }
  await refresh();
}

async function refresh() {
  try {
    library = await api.vipDesigns();
    const stillThere = (library.sundays || []).includes(sunday);
    if (!stillThere) sunday = defaultSunday();
    await loadSelection();
    paint();
  } catch (e) {
    if (main && !aborted) main.innerHTML = errorState(e, '#/designs');
  }
}

export async function renderDesigns({ main: host }) {
  aborted = false;
  main = host;
  main.innerHTML = `<div class="loading">Loading the design library…</div>`;
  try {
    library = await api.vipDesigns();
    sunday = defaultSunday();
    await loadSelection();
    paint();
  } catch (e) {
    if (!aborted) main.innerHTML = errorState(e, '#/designs');
  }
  return () => {
    aborted = true;
    main = null;
    for (const url of thumbs.values()) URL.revokeObjectURL(url);
    thumbs.clear();
  };
}
