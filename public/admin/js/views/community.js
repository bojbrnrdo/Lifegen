/**
 * Community board moderation — every prayer request, testimony and praise post
 * on the public prayer wall. Admins can rewrite a message (fixing typos or
 * removing private details), hide a post from the wall without losing it, or
 * delete it permanently — which also removes its prayer reactions. Every
 * change is written to the audit log by the server.
 */
import { api } from '../api.js';
import { html, raw, icon, esc, toast, openModal, closeModal, confirmDialog, formData, withLoading, fmtDateTime, debounce } from '../ui.js';

const TYPES = {
  prayer: { label: 'Prayer request', badge: 'badge--request' },
  testimony: { label: 'Testimony', badge: 'badge--testimony' },
  praise: { label: 'Praise', badge: 'badge--praise' },
};
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'prayer', label: 'Requests' },
  { key: 'testimony', label: 'Testimonies' },
  { key: 'praise', label: 'Praise' },
];
const STATUS_TABS = [
  { key: 'all', label: 'Any status' },
  { key: 'public', label: 'On the wall' },
  { key: 'hidden', label: 'Hidden' },
];
const authorLabel = (p) => (p.is_anonymous || !p.author ? 'Anonymous' : p.author);
const typeOf = (p) => TYPES[p.type] || TYPES.prayer;

export async function renderCommunity({ main }) {
  let posts = [];
  let filters = { type: 'all', status: 'all', q: '' };

  const load = async () => { posts = await api.postsAdmin(); };

  const matches = (p) => {
    if (filters.type !== 'all' && p.type !== filters.type) return false;
    if (filters.status === 'public' && p.is_hidden) return false;
    if (filters.status === 'hidden' && !p.is_hidden) return false;
    if (filters.q) {
      const hay = `${p.content} ${p.author || ''} ${p.is_anonymous ? 'anonymous' : ''} ${typeOf(p).label}`.toLowerCase();
      if (!hay.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  };
  const typeCount = (key) => (key === 'all' ? posts.length : posts.filter((p) => p.type === key).length);
  const statusCount = (key) => posts.filter((p) => (key === 'all' || (key === 'hidden') === Boolean(p.is_hidden))).length;

  function renderTabs() {
    const typeBox = main.querySelector('#cboardTypes');
    const statusBox = main.querySelector('#cboardStatus');
    typeBox.innerHTML = TABS.map((t) =>
      html`<button type="button" data-type="${t.key}" class="${filters.type === t.key ? 'active' : ''}" aria-pressed="${String(filters.type === t.key)}">${t.label}<span class="count">${typeCount(t.key)}</span></button>`).join('');
    statusBox.innerHTML = STATUS_TABS.map((t) =>
      html`<button type="button" data-status="${t.key}" class="${filters.status === t.key ? 'active' : ''}" aria-pressed="${String(filters.status === t.key)}">${t.label}<span class="count">${statusCount(t.key)}</span></button>`).join('');
    typeBox.querySelectorAll('button').forEach((b) => { b.onclick = () => { filters.type = b.dataset.type; renderTabs(); renderBody(); }; });
    statusBox.querySelectorAll('button').forEach((b) => { b.onclick = () => { filters.status = b.dataset.status; renderTabs(); renderBody(); }; });
  }

  function renderBody() {
    const box = main.querySelector('#cboardBody');
    const rows = posts.filter(matches);
    main.querySelector('#cboardShown').textContent = rows.length === posts.length
      ? `${posts.length} post${posts.length === 1 ? '' : 's'}`
      : `${rows.length} of ${posts.length} posts`;
    if (!posts.length) {
      box.innerHTML = html`<div class="empty"><div class="empty__icon">${icon('inbox', 26)}</div><h3>No posts yet</h3><p>Prayer requests, testimonies and praise shared on the website will appear here.</p></div>`;
      return;
    }
    if (!rows.length) {
      box.innerHTML = html`<div class="empty"><div class="empty__icon">${icon('search', 26)}</div><h3>Nothing matches</h3><p>Try a different filter or search term.</p></div>`;
      return;
    }
    box.innerHTML = html`<div class="table-wrap"><table class="table table--compact cboard">
      <thead><tr><th>Message</th><th>Type</th><th>Author</th><th>Posted</th><th>Status</th><th class="nowrap">Prayers</th><th></th></tr></thead>
      <tbody>${rows.map((p) => html`<tr${raw(p.is_hidden ? ' class="cboard--hidden"' : '')}>
        <td class="cboard__post"><p title="${p.content}">${raw(esc(p.content).replace(/\n/g, '<br>'))}</p></td>
        <td class="nowrap"><span class="badge badge--nodot ${typeOf(p).badge}">${typeOf(p).label}</span></td>
        <td class="nowrap">${p.is_anonymous ? html`<span class="muted">${icon('lock', 13)} Anonymous</span>` : (p.author || 'Anonymous')}</td>
        <td class="nowrap small muted">${fmtDateTime(p.created_at)}</td>
        <td class="nowrap">${p.is_hidden ? raw('<span class="badge badge--inactive">Hidden</span>') : raw('<span class="badge badge--present">On the wall</span>')}</td>
        <td class="nowrap">${p.prayer_count ?? 0}</td>
        <td class="nowrap row-actions">
          <button class="icon-btn" data-edit="${p.id}" aria-label="Edit post by ${authorLabel(p)}">${icon('edit', 15)}</button>
          <button class="icon-btn" data-hide="${p.id}" aria-label="${p.is_hidden ? 'Show' : 'Hide'} post by ${authorLabel(p)}">${icon(p.is_hidden ? 'check' : 'lock', 15)}</button>
          <button class="icon-btn" data-del="${p.id}" aria-label="Delete post by ${authorLabel(p)}">${icon('trash', 15)}</button>
        </td>
      </tr>`)}</tbody>
    </table></div>`;
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openForm(posts.find((p) => String(p.id) === b.dataset.edit)); });
    box.querySelectorAll('[data-hide]').forEach((b) => { b.onclick = () => toggleHidden(posts.find((p) => String(p.id) === b.dataset.hide)); });
    box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => removePost(posts.find((p) => String(p.id) === b.dataset.del)); });
  }

  function draw() {
    main.innerHTML = html`
      <div class="page-header">
        <div><h1>Community board</h1><p class="sub">Prayer requests, testimonies and praise on the public prayer wall. Edit a message, hide a post from the wall, or delete it for good.</p></div>
        <div class="page-actions"><span class="small muted" id="cboardShown"></span></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="filter-tabs" id="cboardTypes" role="group" aria-label="Filter by post type"></div>
          <div class="filter-tabs" id="cboardStatus" role="group" aria-label="Filter by visibility"></div>
          <div class="gsearch grow">${icon('search', 17)}<input type="search" id="cboardQ" placeholder="Search messages or names…" aria-label="Search community posts" autocomplete="off" /></div>
        </div>
        <div id="cboardBody"></div>
      </div>`;
    renderTabs();
    renderBody();
    main.querySelector('#cboardQ').value = filters.q;
    main.querySelector('#cboardQ').addEventListener('input', debounce((e) => {
      filters.q = e.target.value.trim();
      renderBody();
    }, 200));
  }

  function openForm(p) {
    if (!p) return;
    const modal = openModal({
      title: 'Edit post',
      subtitle: 'Saved changes appear on the public prayer wall immediately.',
      body: html`<form id="cboardForm" class="form-grid">
        <div class="field"><label for="cbfType">Type</label>
          <select id="cbfType" name="type">${Object.entries(TYPES).map(([k, t]) => html`<option value="${k}"${raw(k === p.type ? ' selected' : '')}>${t.label}</option>`)}</select>
        </div>
        <div class="field" style="grid-column:1/-1"><label for="cbfText">Message *</label>
          <textarea id="cbfText" name="content" rows="6" maxlength="1000" required placeholder="What was shared with the community?">${p.content || ''}</textarea>
          <span class="help"><span id="cbfCount">${(p.content || '').length} / 1000</span> · what the church sees is what the wall shows</span>
        </div>
        <label class="acal__check" style="grid-column:1/-1"><input id="cbfAnon" name="is_anonymous" type="checkbox"${raw(p.is_anonymous ? ' checked' : '')}/> Anonymous — hide the author's name on the wall</label>
        <div class="field" style="grid-column:1/-1"><label for="cbfAuthor">Author name</label>
          <input id="cbfAuthor" name="author" maxlength="60" value="${p.author || ''}" placeholder="Name shown on the post" />
          <span class="help">Kept privately even for anonymous posts (legacy imports).</span>
        </div>
      </form>`,
      footer: `<button class="btn" data-cancel>Cancel</button><button class="btn btn--primary" data-save>Save changes</button>`,
    });
    const form = modal.querySelector('#cboardForm');
    const anon = modal.querySelector('#cbfAnon');
    const author = modal.querySelector('#cbfAuthor');
    const text = modal.querySelector('#cbfText');
    const syncAnon = () => {
      author.disabled = anon.checked;
      if (anon.checked) author.value = '';
    };
    anon.onchange = syncAnon;
    syncAnon();
    text.addEventListener('input', () => { modal.querySelector('#cbfCount').textContent = `${text.value.length} / 1000`; });
    modal.querySelector('[data-cancel]').onclick = closeModal;
    modal.querySelector('[data-save]').onclick = () => withLoading(modal.querySelector('[data-save]'), async () => {
      const v = formData(form);
      const content = (v.content || '').trim();
      if (!content) { toast('The message cannot be empty.', 'error'); return; }
      if (!anon.checked && !(v.author || '').trim()) { toast("Add the author's name, or tick Anonymous.", 'error'); return; }
      try {
        await api.editPost(p.id, {
          type: v.type,
          content,
          author: anon.checked ? null : (v.author || '').trim(),
          is_anonymous: anon.checked,
        });
        closeModal();
        toast('Post updated — the wall shows the new version.', 'success');
        await load();
        renderTabs();
        renderBody();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    setTimeout(() => text.focus(), 30);
  }

  async function toggleHidden(p) {
    if (!p) return;
    try {
      await api.moderatePost(p.id, !p.is_hidden);
      toast(p.is_hidden ? 'Post is back on the wall.' : 'Post hidden from the wall.', 'success');
      await load();
      renderTabs();
      renderBody();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function removePost(p) {
    if (!p) return;
    const ok = await confirmDialog({
      title: 'Delete post',
      message: `Permanently delete this ${typeOf(p).label.toLowerCase()} from ${esc(authorLabel(p))}? It disappears from the public wall and its prayer reactions are removed with it. This cannot be undone — hiding is safer if you may want it back.`,
      confirmText: 'Delete post',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePost(p.id);
      toast('Post deleted.', 'success');
      closeModal();
      await load();
      renderTabs();
      renderBody();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  await load();
  draw();
  main.__liveReload = async () => {
    const hadFocus = document.activeElement === main.querySelector('#cboardQ');
    await load();
    renderTabs();
    renderBody();
    if (hadFocus) main.querySelector('#cboardQ').focus();
  };
  return () => { main.__liveReload = null; };
}
