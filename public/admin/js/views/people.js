import { api, downloadBlob } from '../api.js';
import { can } from '../app.js';
import { html, raw, icon, avatar, fullName, statusBadge, fmtDate, emptyState, debounce, withLoading, toast } from '../ui.js';

/**
 * People list: a searchable table with only the essentials.
 * Click a row to open the full profile.
 */
export async function renderPeople({ main, query }) {
  const filters = { q: query.q || '', status: query.status || 'active' };

  const statuses = [['active','Active'],['first_timer','First timers'],['inactive','Inactive'],['all','Everyone'],['archived','Archived']];
  let sort = 'name';

  main.innerHTML = html`
    <div class="page-header">
      <div><h1>People</h1><p class="sub">Everyone registered for Lifegen</p></div>
      <div class="page-actions">
        ${can('people:write') ? html`<button class="btn" id="exportPeople" title="Download as CSV">${icon('download')} Export CSV</button>` : ''}
        ${can('people:write') ? html`<a class="btn btn--primary" href="#/people/new">${icon('plus')} Add person</a>` : ''}
      </div>
    </div>
    <section class="people-directory" aria-label="People directory">
      <div class="people-directory__intro"><div><span class="people-directory__eyebrow">Directory</span><h2>Find and manage people</h2><p>Search records, check attendance, and open profiles.</p></div><div class="people-directory__result"><strong id="peopleResultCount">—</strong><span>matching people</span></div></div>
      <div class="people-directory__controls">
        <label class="people-directory__search">${icon('search', 18)}<span class="sr-only">Search people</span><input type="search" id="q" placeholder="Search names, IDs, or phone numbers" value="${filters.q}" autocomplete="off" aria-label="Search people" /><button type="button" class="people-directory__clear" id="clearPeopleSearch" aria-label="Clear search" title="Clear search">×</button></label>
        <label class="people-directory__sort">Sort by <select id="peopleSort"><option value="name">Name A–Z</option><option value="recent">Recently attended</option><option value="registered">Recently registered</option></select></label>
      </div>
      <div class="people-directory__tabs" role="group" aria-label="Filter people by status">
        ${statuses.map(([value,label])=>html`<button type="button" class="people-directory__tab ${filters.status===value?'is-active':''}" data-status="${value}" aria-pressed="${filters.status===value}">${label}</button>`)}
      </div>
      <div class="people-directory__summary"><span id="peopleRange" aria-live="polite">Loading people…</span><span class="people-directory__hint">Choose a person to view details</span></div>
    </section>
    <div class="card"><div id="list" class="card__body--flush"><div class="loading">Loading…</div></div></div>`;

  const countEl=main.querySelector('#peopleResultCount');
  const rangeEl=main.querySelector('#peopleRange');
  const searchInput=main.querySelector('#q');
  const clearSearch=main.querySelector('#clearPeopleSearch');
  const updateSearchClear=()=>{clearSearch.hidden=!searchInput.value;};
  updateSearchClear();
  const updateTabs=()=>main.querySelectorAll('[data-status]').forEach(tab=>{const active=tab.dataset.status===filters.status;tab.classList.toggle('is-active',active);tab.setAttribute('aria-pressed',String(active));});
  main.querySelector('#exportPeople')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const rows = await api.people({ ...filters, limit: 2000 });
      if (!rows.length) { toast('Nothing to export.', 'info'); return; }
      const cell = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const head = ['person_code','first_name','last_name','status','contact_number','email','date_registered','date_first_attended','sundays_attended','last_attended'];
      const lines = rows.map((p) => [p.person_code, p.first_name, p.last_name, p.status, p.contact_number, p.email, p.date_registered, p.date_first_attended, p.sundays_attended, p.last_attended].map(cell).join(','));
      downloadBlob(new Blob(['\ufeff' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'people.csv');
      toast(`Exported ${rows.length} ${rows.length === 1 ? 'person' : 'people'}.`);
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });

  const list = main.querySelector('#list');
  let reqId = 0;
  const PAGE = 100; // rows per page — keeps the first paint fast on large lists

  async function load(offset = 0, previous = []) {
    const id = ++reqId;
    history.replaceState(null, '', '#/people' + api.qs({ q: filters.q, status: filters.status === 'active' ? '' : filters.status }));
    if (!offset) { list.innerHTML = '<div class="loading">Loading people…</div>';rangeEl.textContent='Loading records…';countEl.textContent='—'; }
    let page;
    try { page = await api.people({ ...filters, paged: 1, limit: PAGE, offset }); }
    catch (err) { if(id === reqId) { list.innerHTML = html`<div class="alert alert--error" style="margin:16px">${err.message} <button type="button" class="btn btn--sm" id="retryPeople">Retry</button></div>`;list.querySelector('#retryPeople')?.addEventListener('click',()=>load());rangeEl.textContent='Could not load records'; } return; }
    if (id !== reqId) return;
    const people = previous.concat(page.rows);
    countEl.textContent=Number(page.total||0).toLocaleString();
    rangeEl.textContent=people.length+' of '+page.total+' people shown';
    const sorted=[...people].sort((a,b)=>sort==='name'?(String(a.first_name||'')+' '+String(a.last_name||'')).localeCompare(String(b.first_name||'')+' '+String(b.last_name||'')):sort==='recent'?String(b.last_attended||'').localeCompare(String(a.last_attended||'')):String(b.date_registered||'').localeCompare(String(a.date_registered||'')));

    if (!people.length) {
      const filtered = filters.q || filters.status !== 'active';
      list.innerHTML = emptyState({
        icon: 'people',
        title: filtered ? 'No one matches' : 'No one is registered yet',
        text: filtered ? 'Try a different name or clear the search.' : 'Add the first person to start tracking Lifegen attendance.',
        action: filtered ? '<button class="btn" id="clearFilters">Clear search</button>' : (can('people:write') ? '<a class="btn btn--primary" href="#/people/new">Add person</a>' : ''),
      });
      list.querySelector('#clearFilters')?.addEventListener('click', () => { location.hash = '#/people'; renderPeople({ main, query: {} }); });
      return;
    }

    list.innerHTML = html`
      <div class="table-wrap people-directory__table"><table class="table table--stack table--people">
        <thead><tr><th>Person</th><th>Status</th><th>Contact</th><th>Last attended</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          ${sorted.map((p) => html`<tr>
            <td data-label=""><div class="person-cell">${raw(avatar(p, 'sm'))}<div class="person-cell__text"><div class="name">${fullName(p)}</div><div class="code">${p.person_code}</div></div></div></td>
            <td data-label="Status">${p.archived_at ? raw('<span class="badge badge--nodot">Archived</span> ') : ''}${raw(statusBadge(p.status))}${p.is_demo ? raw(' <span class="badge badge--demo badge--nodot">Demo</span>') : ''}</td>
            <td data-label="Contact"><span class="people-directory__contact">${p.contact_number || p.email || raw('<span class="muted">Not provided</span>')}</span></td>
            <td data-label="Last attended">${p.last_attended ? fmtDate(p.last_attended, { short: true }) : raw('<span class="muted">No attendance yet</span>')}</td>
            <td data-label=""><a class="btn btn--sm people-directory__view" href="#/people/${p.id}" aria-label="View profile for ${fullName(p)}">View profile ${icon('arrow-right',14)}</a></td>
          </tr>`)}
        </tbody>
      </table></div>
      <div class="card__footer small muted row row--between">
        <span>Showing ${people.length} of ${page.total} ${page.total === 1 ? 'person' : 'people'}</span>
        ${page.has_more ? html`<button class="btn btn--sm" id="loadMore">Load more</button>` : ''}
      </div>`;
    list.querySelector('#loadMore')?.addEventListener('click', (e) => withLoading(e.currentTarget, () => load(people.length, people)));
  }

  searchInput.addEventListener('input',()=>updateSearchClear());
  searchInput.addEventListener('input', debounce((e) => { filters.q = e.target.value.trim(); load(); }, 300));
  clearSearch.onclick=()=>{searchInput.value='';filters.q='';updateSearchClear();searchInput.focus();load();};
  main.querySelectorAll('[data-status]').forEach(tab=>tab.onclick=()=>{if(filters.status===tab.dataset.status)return;filters.status=tab.dataset.status;updateTabs();load();});
  main.querySelector('#peopleSort').onchange=e=>{sort=e.target.value;load();};
  main.__liveReload = () => load();
  load();
}
