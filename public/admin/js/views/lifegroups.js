import { api } from '../api.js';
import { findUnassignedGroups, filterTrackerView, lifegroupHeadline } from './hierarchy.js';

import { filterPeople, rankPeople, relationshipLine } from './lifegroupSearch.js';
import { simplifyNetworkDetail } from './networkDetailUI.js';
import { networkLeaderRegistrationHtml, bindNetworkLeaderRegistration } from './networkLeaderRegistration.js';
import { createFourFieldNetwork } from './networkFourField.js';
import { createAddNewModal } from './unifiedAddNew.js';
import { openRemoveFromLifegroups } from './removeFromLifegroups.js';
import { renderProgressCard, renderNetworkCalendar, drawProgressTab, solidBadge, weekStrip, memberSections, memberDots, dotsKey, TIER_LABEL, meetingForm } from './progress.js';
import { can } from '../app.js';
import {
  html, raw, icon, avatar, fullName, statusBadge, fmtDate, fmtNum, emptyState, debounce, toast, confirmDialog,
  openModal, closeModal, withLoading, formData, toISODate,
} from '../ui.js';

/**
 * Cell Leaders: the connection tool after attendance.
 *   #/lifegroups        list of groups (+ "Needs Cell" follow-up list)
 *   #/lifegroups/:id    one group: leader, schedule, members, former members
 * Person ↔ group is a real relationship with history (see findLifegroup()).
 */

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slotsText = (g) => (g.max_members == null ? 'Open' : g.slots > 0 ? `${g.slots} slot${g.slots === 1 ? '' : 's'}` : 'Full');
const closedCount = (g) => g.members.filter((m) => m.tier === 'solid').length;
/** Boys / girls ratio bar — exported so Reports can reuse it. */
export function ratioBar(boys, girls, total, { compact = false } = {}) {
  total = total ?? boys + girls;
  const unknown = Math.max(total - boys - girls, 0);
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  if (!total) return html`<div class="ratio ${compact ? 'ratio--compact' : ''}"><div class="ratio__bar"><span class="ratio__none"></span></div>${compact ? '' : raw('<div class="ratio__legend muted">No members yet</div>')}</div>`;
  return html`<div class="ratio ${compact ? 'ratio--compact' : ''}" title="${boys} boys · ${girls} girls${unknown ? ' · ' + unknown + ' not set' : ''}">
    <div class="ratio__bar"><span class="ratio__boys" style="width:${pct(boys)}%"></span><span class="ratio__girls" style="width:${pct(girls)}%"></span>${unknown ? html`<span class="ratio__unknown" style="width:${pct(unknown)}%"></span>` : ''}</div>
    <div class="ratio__legend"><span title="Boys" aria-label="Boys: ${boys}">${icon('mars',14)} ${boys} <span class="muted">${pct(boys)}%</span></span><span title="Girls" aria-label="Girls: ${girls}">${icon('venus',14)} ${girls} <span class="muted">${pct(girls)}%</span></span>${unknown ? html`<span class="muted">${unknown} not set</span>` : ''}</div>
  </div>`;
}
/** Sex-specific network indicators, kept accessible even when the visible label is icon-only. */
export const genderBadge = (g, { long = false, noun = 'group' } = {}) => {
  const title = g === 'boys' ? 'Boys' : g === 'girls' ? 'Girls' : 'Category not set';
  if (g !== 'boys' && g !== 'girls') return raw('<span class="gbadge gbadge--na" role="img" aria-label="Category not set" title="Category not set">?</span>');
  const text = title + (long ? ' ' + noun : '');
  return raw(`<span class="gbadge gbadge--icon gbadge--${g}" role="img" aria-label="${text}" title="${text}">${icon(g === 'boys' ? 'mars' : 'venus', 16).value}</span>`);
};
const sexBadge = (sex) => sex === 'male' ? genderBadge('boys') : sex === 'female' ? genderBadge('girls') : genderBadge(null);

// ---------------------------------------------------------------------------
// Person picker (search registered people) — used for leader + add member
// ---------------------------------------------------------------------------
// `sex` may be 'male' | 'female' | null or a function returning one — when set, only boys (or only girls)
// are ever listed, so a girl can't even be picked for a boys group (and vice versa).
const SEX_WORD = { male: 'boys', female: 'girls' };
const SEX_OF = { boys: 'male', girls: 'female' };
function personPicker(root, { inputId, hiddenId, labelId, initial, sex = null, onSelect = null, onInput = null }) {
  const input = root.querySelector('#' + inputId);
  const hidden = root.querySelector('#' + hiddenId);
  const results = root.querySelector('#' + inputId + 'Results');
  const sexNow = () => (typeof sex === 'function' ? sex() : sex);
  if (initial) { input.value = initial.name; hidden.value = initial.id; }
  if (!results) throw new Error('Missing person search results element for ' + inputId);
  const hide = () => { results.hidden = true; results.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); };
  input.setAttribute('aria-controls', results.id);
  input.setAttribute('aria-expanded', 'false');
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) return hide();
    try {
      const sx = sexNow();
      if (sex && !sx) { results.innerHTML = '<div class="gsearch__empty">Choose Boys group or Girls group first.</div>'; results.hidden = false; return; }
      const { people: found } = await api.search(q);
      if (input.value.trim() !== q) return; // Ignore stale search results.
      const people = sx ? found.filter((p) => !p.sex || p.sex === sx) : found;
      if (!people.length) { results.innerHTML = `<div class="gsearch__empty">${sx ? `No ${SEX_WORD[sx]} found — only ${SEX_WORD[sx]} can be in this group.` : 'No one found'}</div>`; results.hidden = false; return; }
      results.innerHTML = people.map((p) => `<button type="button" class="gsearch__item" data-id="${p.id}" data-name="${esc(fullName(p))}">${avatar(p, 'sm')}<span><b>${esc(fullName(p))}</b><small>${esc(p.person_code)}</small></span></button>`).join('');
      results.hidden = false;
      results.querySelectorAll('[data-id]').forEach((b) => {
        const choose = () => { hidden.value = b.dataset.id; input.value = b.dataset.name; hide(); onSelect?.(); };
        b.addEventListener('pointerdown', (event) => { event.preventDefault(); choose(); });
        b.addEventListener('click', choose);
      });
    } catch (e) {
      if (input.value.trim() !== q) return;
      results.innerHTML = '<div class="gsearch__empty">Search failed. Please try again.</div>';
      results.hidden = false;
    }
  }, 200);
  input.addEventListener('input', () => { hidden.value = ''; hide(); onInput?.(); search(); });
  input.addEventListener('blur', () => setTimeout(hide, 180));
}

// ---------------------------------------------------------------------------
// Group form (create / edit)
// ---------------------------------------------------------------------------
async function groupForm(g, onSaved, { networkId = null, gender = null } = {}) {
  let opts = { networks: [] };
  try { opts = await api.lifegroupOptions(); } catch (e) { /* optional */ }

  const v = (k) => esc(g?.[k] ?? '');
  const selectedNetworkId = g?.network_id ?? networkId;
  const selectedGender = g?.gender ?? gender;
  const modal = openModal({
    title: g ? 'Edit this Cell' : 'Add a Cell Leader',
    subtitle: g ? 'Change who leads this Cell, or which Network it belongs to.' : 'Pick the Network and the person who will lead the Cell.',
    wide: true,
    body: `<form id="groupForm" class="form-grid" novalidate>
      <div id="groupErr" class="alert alert--error span-2" hidden></div>
      <input type="hidden" name="name" value="${v('name')}" />
      <div class="field"><label>Is this Cell for boys or for girls? <span class="req">*</span></label>
        <div class="choice">
          <label class="choice__opt choice__opt--gender"><input type="radio" name="gender" value="boys" aria-label="Cell for boys" ${selectedGender === 'boys' ? 'checked' : ''} /><span title="Cell for boys">${icon('mars', 22)}</span></label>
          <label class="choice__opt choice__opt--gender"><input type="radio" name="gender" value="girls" aria-label="Cell for girls" ${selectedGender === 'girls' ? 'checked' : ''} /><span title="Cell for girls">${icon('venus', 22)}</span></label>
        </div></div>
      <div class="field"><label>Which Network is it part of? <span class="req">*</span></label><select name="network_id" required><option value="" ${!selectedNetworkId ? 'selected' : ''}>Choose a Network</option>${(opts.networks || []).map((n) => `<option value="${n.id}" data-gender="${n.gender || ''}" ${Number(selectedNetworkId) === n.id && (!g || g.network_manual) ? 'selected' : ''}>${esc(n.name)}${n.gender ? ' ' + (n.gender === 'boys' ? '♂' : '♀') : ''}${n.leader_name ? ' · ' + esc(n.leader_name) : ''}</option>`).join('')}</select></div>
      <div class="field span-2 gsearch-field"><label>Who is the Cell Leader? <span class="req">*</span></label>
        <div class="gsearch" style="max-width:none">${icon('search', 16).value}<input id="leaderPick" aria-label="Search a registered person to be leader" placeholder="Search a registered person…" autocomplete="off" /><div class="gsearch__results" id="leaderPickResults" hidden></div></div>
        <input type="hidden" id="leaderId" name="leader_person_id" />
        <span class="help" id="leaderHint"></span>
        <input type="hidden" name="leader_name" value="${v('leader_name')}" /></div>
      ${g ? `<div class="field span-2"><label class="toggle"><input type="checkbox" name="is_active" ${g.is_active ? 'checked' : ''}/> This Cell is running</label><span class="help">Untick if the Cell has stopped meeting. Its history is kept.</span></div>` : ''}
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn--primary" id="saveGroup">${g ? 'Save' : 'Add Cell Leader'}</button>`,
  });
  modal.querySelector('[data-close]').onclick = closeModal;
  const genderNow = () => modal.querySelector('[name=gender]:checked')?.value || null;
  const leaderHint = modal.querySelector('#leaderHint');
  const netSel = modal.querySelector('[name=network_id]');
  const refreshLeaderHint = () => {
    const gg = genderNow(); leaderHint.textContent = gg ? '' : 'Choose boys or girls first.';
    // only networks of the same type can hold this group
    netSel.querySelectorAll('option[data-gender]').forEach((o) => { const mismatch = gg && o.dataset.gender && o.dataset.gender !== gg; o.hidden = mismatch; o.disabled = mismatch; if (mismatch && o.selected) netSel.value = ''; });
  };
  // picking a network first sets the group type to match it
  netSel.addEventListener('change', () => { const og = netSel.selectedOptions[0]?.dataset.gender; if (og && genderNow() !== og) { modal.querySelector(`[name=gender][value=${og}]`).checked = true; modal.querySelector(`[name=gender][value=${og}]`).dispatchEvent(new Event('change')); } });
  refreshLeaderHint();
  personPicker(modal, { inputId: 'leaderPick', hiddenId: 'leaderId', sex: () => SEX_OF[genderNow()] || null, initial: g?.leader_person_id ? { id: g.leader_person_id, name: g.leader_name } : null });
  modal.querySelectorAll('[name=gender]').forEach((r) => r.addEventListener('change', () => {
    refreshLeaderHint();
    // the picked leader may be the wrong sex for the new choice — clear and let the user pick again
    if (modal.querySelector('#leaderId').value) { modal.querySelector('#leaderId').value = ''; modal.querySelector('#leaderPick').value = ''; }
  }));
  const save = (e) => withLoading(modal.querySelector('#saveGroup'), async () => {
    e.preventDefault();
    const form = modal.querySelector('#groupForm');
    const d = formData(form);
    d.gender = form.querySelector('[name=gender]:checked')?.value || null;
    d.leader_person_id = form.querySelector('#leaderId').value || null;
    d.network_manual = Boolean(d.network_id);
    if (g) d.is_active = form.querySelector('[name=is_active]').checked;
    for (const k of Object.keys(d)) if (d[k] === '') d[k] = null;
    const err = modal.querySelector('#groupErr');
    if (!d.network_id || !d.gender || !d.leader_person_id) {
      err.textContent = 'Select a Network, category, and registered Cell Leader to continue.';
      err.hidden = false;
      return;
    }
    if (!g) d.name = (modal.querySelector('#leaderPick').value.trim() || 'Cell Leader') + ' Cell';
    d.leader_name = null;
    try {
      const saved = g ? await api.updateLifegroup(g.id, d) : await api.createLifegroup(d);
      closeModal(); toast(g ? 'Cell updated.' : `${saved.name} created.`); onSaved(saved);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  modal.querySelector('#saveGroup').onclick = save;
  modal.querySelector('#groupForm').onsubmit = save;
}

// ---------------------------------------------------------------------------
// "Find a Cell" — preferences → recommended groups → Assign
// Exported so the person profile and the Needs list can share it.
// ---------------------------------------------------------------------------
export async function findLifegroup(person, onAssigned) {
  let sex = person.sex || '';
  const modal = openModal({
    title: 'Choose a Cell Leader',
    subtitle: `${fullName(person)} · ${person.person_code}${person.lifegroup ? ' · assigned to a Cell Leader' : ' · not yet assigned'}`,
    wide: true,
    body: `
      <div class="row mb-2" style="gap:10px;flex-wrap:wrap;align-items:center">
        <span class="small muted">Boy or girl</span>
        <div class="choice choice--sm" id="sexChoice">
          <label class="choice__opt"><input type="radio" name="sex" value="male" ${sex === 'male' ? 'checked' : ''} ${person.sex ? 'disabled' : ''} /><span>Boy</span></label>
          <label class="choice__opt"><input type="radio" name="sex" value="female" ${sex === 'female' ? 'checked' : ''} ${person.sex ? 'disabled' : ''} /><span>Girl</span></label>
        </div>
        ${person.sex ? '' : '<span class="small muted">Not set yet — choose one to see matching groups.</span>'}
      </div>
      <div class="gsearch mb-2" style="max-width:none">${icon('search', 16).value}<input id="findQ" placeholder="Search Cell Leader or Network…" autocomplete="off" aria-label="Filter Cell Leaders" /></div>
      <div id="recList"><div class="loading">Loading…</div></div>`,
    footer: `<button class="btn" data-close>Close</button>`,
  });
  modal.querySelector('[data-close]').onclick = closeModal;
  const list = modal.querySelector('#recList');
  const q = modal.querySelector('#findQ');
  let all = null;

  async function load() {
    all = null;
    if (!sex) { list.innerHTML = emptyState({ icon: 'group', title: 'Choose Boy or Girl first', text: 'Choose a category to find an eligible Cell Leader.' }).value; return; }
    list.innerHTML = '<div class="loading">Loading…</div>';
    try { all = (await api.lifegroupRecommend({ sex })).groups.filter((g) => !person.lifegroup || g.id !== person.lifegroup.lifegroup_id); } catch (e) { list.innerHTML = `<div class="alert alert--error">${esc(e.message)}</div>`; return; }
    draw();
  }
  function draw() {
    if (!all) return;
    const needle = q.value.trim().toLowerCase();
    const groups = needle ? all.filter((g) => [g.name, g.leader_name, g.network, g.network_name].some((v) => v && String(v).toLowerCase().includes(needle))) : all;
    if (!groups.length) { list.innerHTML = emptyState({ icon: 'group', title: needle ? 'No match' : 'No Cell Leaders available', text: needle ? 'Try another Cell Leader or Network.' : 'Add a Cell Leader to the selected Network first.' }).value; return; }
    list.innerHTML = `<div class="table-wrap"><table class="table table--stack">
      <thead><tr><th>Cell Leader</th><th>Network</th><th>Slots</th><th></th></tr></thead>
      <tbody>${groups.map((g) => `<tr>
        <td data-label=""><b>${esc(g.leader_name || 'Unassigned Cell Leader')}</b> ${genderBadge(g.gender).value}</td>
        <td data-label="Network">${esc(g.network || g.network_name || '—')}</td>
        <td data-label="Slots">${slotsText(g)}</td>
        <td data-label="" class="actions">${can('lifegroups:manage') ? `<button class="btn btn--sm btn--primary" data-assign="${g.id}" data-name="${esc(g.leader_name || 'Cell Leader')}">Assign</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
    list.querySelectorAll('[data-assign]').forEach((b) => {
      b.onclick = () => withLoading(b, async () => {
        const gid = Number(b.dataset.assign);
        if (person.lifegroup) {
          const ok = await confirmDialog({ title: `Move ${person.first_name} to ${b.dataset.name}?`, message: `Their previous Cell Leader assignment will be closed today. The previous membership stays in their history.`, confirmText: 'Move' });
          if (!ok) return;
        }
        try {
          const r = await api.assignLifegroup(gid, person.id, { joined_at: toISODate(new Date()), sex: sex || undefined, confirm_move: Boolean(person.lifegroup) });
          closeModal();
          toast(`${fullName(person)} assigned to ${b.dataset.name}.`);
          onAssigned?.(r);
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  }
  q.addEventListener('input', debounce(draw, 150));
  modal.querySelector('#sexChoice').addEventListener('change', (e) => { sex = e.target.value; load(); });
  load();
}

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------

/** "Add member" modal — shared by the Cell page and the Network page (also used to add a cell leader). */
export function addMemberDialog(g, onDone, { title = null, buttonText = 'Add to group', role = 'member' } = {}) {
  const modal = openModal({
    title: title || `Add member to ${g.name}`,
    body: `<div class="field gsearch-field"><label>Person</label><div class="gsearch" style="max-width:none">${icon('search', 16).value}<input id="memberPick" aria-label="Search a person to add" placeholder="${g.gender ? `Search a ${g.gender === 'boys' ? 'boy' : 'girl'} by name or ID…` : 'Search by name or ID…'}" autocomplete="off" /><div class="gsearch__results" id="memberPickResults" hidden></div></div><input type="hidden" id="memberId" />
        <span class="help">Type at least 2 letters, then select a registered person from the results. Typing a name alone does not select them. A person can belong to one Cell at a time.</span><span class="help" id="memberPickError" role="alert" style="color:var(--danger,#bb3232)" hidden>Select a registered person from the search results before adding them.</span></div>
      <div class="field mt-1"><label>Role</label><select id="memberRole"><option value="member" ${role === 'member' ? 'selected' : ''}>Member</option><option value="assistant" ${role === 'assistant' ? 'selected' : ''}>Assistant</option><option value="leader" ${role === 'leader' ? 'selected' : ''}>Leader</option></select></div>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn--primary" id="saveMember">${buttonText}</button>`,
  });
  modal.querySelector('[data-close]').onclick = closeModal;
  const pickerError = modal.querySelector('#memberPickError');
  const pickInput = modal.querySelector('#memberPick');
  const clearError = () => { pickerError.hidden = true; pickInput.removeAttribute('aria-invalid'); };
  personPicker(modal, { inputId: 'memberPick', hiddenId: 'memberId', sex: SEX_OF[g.gender] || null, onSelect: clearError, onInput: clearError });
  modal.querySelector('#saveMember').onclick = (e) => {
    const pid = Number(modal.querySelector('#memberId').value);
    if (!pid) {
      pickerError.hidden = false;
      pickInput.setAttribute('aria-invalid', 'true');
      pickInput.focus();
      return;
    }
    return withLoading(e.currentTarget, async () => {
      try {
        const r = await api.assignLifegroup(g.id, pid, { role: modal.querySelector('#memberRole').value, sex: SEX_OF[g.gender] || undefined });
        closeModal(); toast(r.unchanged ? 'Already in this Cell.' : 'Added to the Cell.'); onDone(r);
      } catch (ex) { toast(ex.message, 'error'); }
    });
  };
}

/** Per-person edit menu used inside member lists: Move to another Cell · Remove · Edit profile. */
function memberActions(m, g, refresh) {
  return html`<button class="btn btn--ghost btn--sm" data-move="${m.id}" data-gid="${g.id}" title="Move this person to another Cell">Move</button> <button class="btn btn--ghost btn--sm" data-leave="${m.id}" data-gid="${g.id}" data-name="${fullName(m)}" data-gname="${g.name}" title="Take ${fullName(m)} out of ${g.name} (their record and history are kept)">Remove</button> <a class="btn btn--ghost btn--sm" href="#/people/${m.id}/edit" title="Edit this person's details">Edit details</a> `;
}
function bindMemberActions(root, groupsById, refresh) {
  root.querySelectorAll('[data-leave]').forEach((b) => {
    b.onclick = async (e) => {
      e.preventDefault();
      const ok = await confirmDialog({ title: `Remove ${b.dataset.name} from ${b.dataset.gname}?`, message: 'They will be marked as left today. The membership stays in their history and they can be added again.', confirmText: 'Remove', danger: true });
      if (!ok) return;
      try { await api.leaveLifegroup(Number(b.dataset.gid), Number(b.dataset.leave)); toast('Removed.', 'info'); refresh(); } catch (ex) { toast(ex.message, 'error'); }
    };
  });
  root.querySelectorAll('[data-move]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      const g = groupsById.get(Number(b.dataset.gid));
      const m = g && g.members.find((x) => x.id === Number(b.dataset.move));
      if (!m) return;
      findLifegroup({ ...m, lifegroup: { id: g.id, name: g.name } }, refresh);
    };
  });
}

export async function renderLifegroups({main, query}) {
 // Linked leaders have scoped detail and People endpoints, not the global
 // hierarchy/overview endpoints used by the administrator map.
 const leader=await api.leaderScope();
 if(leader.kind==='network_leader'||leader.kind==='cell_leader'||(leader.kind==='unassigned'&&leader.linked)){
  const people=leader.kind==='unassigned'?[]:await api.people({status:'all',limit:2000});
  main.innerHTML=html`<section class="lifegroups-page"><div class="page-header"><div><h1>My Lifegroups</h1><p class="sub">Only members in your assigned active Cells are displayed.</p></div></div>
   <div class="card"><div class="card__body"><div class="row row--between" style="gap:12px;flex-wrap:wrap"><h2>My People (${people.length})</h2><button class="btn btn--sm" type="button" id="leaderPeopleRefresh">${icon('undo',15)} Refresh people</button></div>
    ${people.length?html`<div class="people-directory"><table class="table"><thead><tr><th>Person</th><th>Profile</th></tr></thead><tbody>${people.map(p=>html`<tr><td data-label="Person">${esc(fullName(p))}</td><td data-label="Profile"><a class="btn btn--sm" href="#/people/${p.id}">View profile</a></td></tr>`)}</tbody></table></div>`:html`<p class="muted">No active Cell members are assigned to you.</p>`}</div></div></section>`;
  main.querySelector('#leaderPeopleRefresh')?.addEventListener('click',()=>renderLifegroups({main,query}).catch(e=>toast(e.message,'error')));
  return;
 }

 const filters={q:query.q||'',gender:query.gender||'',status:query.status||'active'};
 main.innerHTML=html`
 <section class="lifegroups-page">
 <div class="page-header lifegroups-page__header"><div><h1>Lifegroups</h1><p class="sub">Who meets with whom, and how each Cell is doing.</p></div>
 <div class="page-actions">${can('lifegroups:manage')?html`<button class="btn btn--primary" id="addNew" title="Create a Network, a Cell Leader or a member">${icon('plus')} Add New</button><button class="btn" id="removeFromLifegroups" title="Remove someone from a group, keeping their record and history">${icon('trash',16)} Remove</button>`:''}</div></div>
 <div id="treeSummary" class="lifegroups-page__summary lifegroups-page__numbers is-loading" aria-live="polite"><div class="lifegroups-page__number">Loading the numbers…</div></div>
 <div class="toolbar lg-tree-toolbar" role="search"><div class="gsearch grow" style="max-width:none">${icon('search',17)}<input id="treeQ" type="search" value="${filters.q}" placeholder="Search a Network or a Cell Leader…" aria-label="Search Networks and Cell Leaders" /></div>
 <div class="lg-gender-filter" role="group" aria-label="Show only boys or only girls"><button class="lg-gender-filter__button" type="button" data-gender-filter="" aria-label="Show all Networks" title="Show all Networks">${icon('group',18)} <span>Everyone</span></button><button class="lg-gender-filter__button" type="button" data-gender-filter="boys" aria-label="Show only boys' Networks" title="Show only boys' Networks">${icon('mars',18)} <span>Boys</span></button><button class="lg-gender-filter__button" type="button" data-gender-filter="girls" aria-label="Show only girls' Networks" title="Show only girls' Networks">${icon('venus',18)} <span>Girls</span></button></div>
 <select id="treeStatus" aria-label="Show which groups"><option value="active">Active only</option><option value="all">Everything</option><option value="inactive">Removed only</option></select>
 <button class="btn lifegroups-page__refresh" id="treeRefresh" title="Reload the latest numbers" aria-label="Reload the latest numbers">${icon('undo',17)} <span>Refresh</span></button></div>

 <div id="treePeopleMatches" role="region" aria-label="Matching People" hidden></div>
 <div id="treeNotice" aria-live="polite"></div>
 <div id="findPersonPanel" class="lifegroups-page__find"></div>
 <div id="lifegroupsDirectory" class="lifegroups-page__directory" aria-label="Networks and Cell Leaders"></div>
 <div class="lifegroups-page__extras">
 <details class="card" id="allPeoplePanel"><summary class="lifegroups-page__extra-head">${icon('people',18)} <span>Everyone registered</span>${icon('chevR',16)}</summary><div class="lifegroups-page__extra-body" id="allPeopleBody"></div></details>
 <details class="card" id="needsPanel"><summary class="lifegroups-page__extra-head">${icon('user',18)} <span>Not in a Cell yet</span><span class="small muted lifegroups-page__extra-hint">people waiting for a group</span>${icon('chevR',16)}</summary><div class="lifegroups-page__extra-body" id="needsBody"></div></details>
 <details class="card" id="progressPanel"><summary class="lifegroups-page__extra-head">${icon('chart',18)} <span>How groups are doing</span><span class="small muted lifegroups-page__extra-hint">meetings held in the last weeks</span>${icon('chevR',16)}</summary><div class="lifegroups-page__extra-body" id="progressBody"></div></details>
 <details class="card" id="lifegroupsHelp"><summary class="lifegroups-page__extra-head">${icon('info',18)} <span>The three words you need</span><span class="small muted lifegroups-page__extra-hint">Network · Cell · Member</span>${icon('chevR',16)}</summary><div class="lifegroups-page__extra-body lifegroups-page__help-body">
   <ul>
    <li><b>Network</b> — a group of Cells, all boys or all girls. A Network Leader looks after it.</li>
    <li><b>Cell</b> (also called a Lifegroup) — one weekly small group, with its own Cell Leader.</li>
    <li><b>Member</b> — one person in a Cell.</li>
   </ul>
   <p class="small muted">Nothing is deleted when someone leaves. Their record and attendance stay, and they move to <b>Former members</b>.</p>
  </div></details>
 </div></section>`;
 main.querySelector('#addNew')?.addEventListener('click',()=>createAddNewModal({onSaved:()=>{
  // A new Cell or member changes the find-person index too.
  peopleIndex=null;peopleIndexError='';drawFindPanel();loadPeopleIndex();
  load(true);
 }}));
 main.querySelector('#removeFromLifegroups')?.addEventListener('click',()=>openRemoveFromLifegroups({onRemoved:afterRemove}));

 const genderButtons=main.querySelectorAll('[data-gender-filter]');
 const syncGender=()=>genderButtons.forEach(b=>b.setAttribute('aria-pressed', String(b.dataset.genderFilter===filters.gender)));
 syncGender();
 main.querySelector('#treeStatus').value=filters.status;
 const notice=main.querySelector('#treeNotice');
 const directory=main.querySelector('#lifegroupsDirectory');
 let cache=null,sequence=0;
 const renderDirectory=()=>{
  if(!cache)return;
  const q=filters.q.toLowerCase();
  const view=filterTrackerView(cache.nets,cache.groups,filters);
  const nets=view.networks;
  const groups=view.cells;
  const matchingNets=nets.filter(n=>!q||String(n.name||'').toLowerCase().includes(q)||
   String(n.leader_name||'').toLowerCase().includes(q)||
   groups.some(g=>String(g.network_id)===String(n.id)&&
    (String(g.name||'').toLowerCase().includes(q)||String(g.leader_name||'').toLowerCase().includes(q))));
  const allCells=matchingNets.reduce((t,n)=>t+groups.filter(g=>String(g.network_id)===String(n.id)).length,0);
  const allPeople=matchingNets.reduce((t,n)=>t+groups.filter(g=>String(g.network_id)===String(n.id)).reduce((s,g)=>s+Number(g.member_count||0),0),0);
  // Two levels, in the order the church is actually organised:
  //   Bishop / Pastora  ->  Network Leaders  ->  their Cells  ->  people
  // A pastor Network has no cells of its own; its leader-team Cell holds the
  // Network Leaders beneath them.
  const isPastor = n => (n.child_count || 0) > 0 || (n.parent_network_id == null && nets.some(c => String(c.parent_network_id) === String(n.id)));
  const pastorNets = matchingNets.filter(isPastor);
  const childrenOf = n => matchingNets.filter(c => String(c.parent_network_id) === String(n.id));
  const looseNets = matchingNets.filter(n => !isPastor(n) && !matchingNets.some(p => String(p.id) === String(n.parent_network_id)));
  const matches = (n) => !q || String(n.name || '').toLowerCase().includes(q) || String(n.leader_name || '').toLowerCase().includes(q) ||
    groups.some(g => String(g.network_id) === String(n.id) && (String(g.name || '').toLowerCase().includes(q) || String(g.leader_name || '').toLowerCase().includes(q)));
  const shownPastors = pastorNets.filter(p => matches(p) || childrenOf(p).some(matches));
  const shownLoose = looseNets.filter(matches);
  const cellsOf = id => groups.filter(g => String(g.network_id) === String(id) && (!q ||
    String(g.name || '').toLowerCase().includes(q) || String(g.leader_name || '').toLowerCase().includes(q)));
  const cellRow = g => {
    const people = Number(g.member_count || 0);
    const summary = g.leader_name
      ? `Cell Leader ${g.leader_name} · ${people} ${people === 1 ? 'person' : 'people'}`
      : `No Cell Leader yet · ${people} ${people === 1 ? 'person' : 'people'}`;
    return html`<li>${g.is_active ? html`<a class="lifegroups-page__cell-row" href="#/lifegroups/${g.id}" aria-label="Open ${g.name || 'Cell'} — ${summary}">
      <span class="lifegroups-page__cell-row-main"><strong>${g.name || 'Unnamed Cell'}</strong><span>${summary}</span></span>
      <span class="lifegroups-page__cell-row-go" aria-hidden="true">Open ${icon('chevR', 15)}</span>
     </a>` : html`<div class="lifegroups-page__cell-row is-inactive"><span class="lifegroups-page__cell-row-main"><strong>${g.name || 'Unnamed Cell'}</strong><span>${summary}</span></span><span class="badge badge--inactive badge--nodot" title="This Cell was removed. Its people and history are kept.">Removed</span></div>`}</li>`;
  };
  // One row per Network Leader: the whole row opens that Network.
  const networkRow = (n, extra = '') => {
    const kids = Number(n.child_count || 0);
    const cells = groups.filter(g => String(g.network_id) === String(n.id) && !g.leads_network);
    const people = cells.reduce((sum, g) => sum + Number(g.member_count || 0), 0);
    const where = kids ? `${kids} ${kids === 1 ? 'Network' : 'Networks'}` : `${cells.length} ${cells.length === 1 ? 'Cell' : 'Cells'}`;
    return html`<li>${n.is_active ? html`<a class="lifegroups-page__cell-row lifegroups-page__cell-row--leader" href="#/networks/${n.id}" aria-label="Open ${n.name || 'Network'}">
      <span class="lifegroups-page__cell-row-main"><strong>${n.leader_name || n.name || 'Network Leader'}</strong><span>${n.name || 'Network'} · ${where} · ${people} ${people === 1 ? 'person' : 'people'}${extra}</span></span>
      <span class="lifegroups-page__cell-row-go" aria-hidden="true">Open ${icon('chevR', 15)}</span>
     </a>` : html`<div class="lifegroups-page__cell-row is-inactive"><span class="lifegroups-page__cell-row-main"><strong>${n.leader_name || n.name}</strong><span>${n.name} · removed</span></span><span class="badge badge--inactive badge--nodot">Removed</span></div>`}</li>`;
  };
  const totalCells = matchingNets.reduce((t, n) => t + groups.filter(g => String(g.network_id) === String(n.id)).length, 0);
  const totalPeople = matchingNets.reduce((t, n) => t + groups.filter(g => String(g.network_id) === String(n.id)).reduce((sum, g) => sum + Number(g.member_count || 0), 0), 0);
  directory.innerHTML = (shownPastors.length || shownLoose.length) ? html`<div class="lifegroups-page__directory-head"><h2>Who leads whom</h2><p class="small muted">${totalCells} ${totalCells === 1 ? 'Cell' : 'Cells'} · ${totalPeople} ${totalPeople === 1 ? 'person' : 'people'}${shownPastors.length ? ' · tap a pastor to see the Network Leaders under them' : ''}</p></div>
   ${shownPastors.map(p => {
     const kids = childrenOf(p);
     const leaders = (cache.groups || []).filter(g => String(g.network_id) === String(p.id) && g.leads_network);
     const leadTotal = kids.reduce((t, k) => t + Number(k.leaders_here || 0), 0);
     return html`<section class="card lifegroups-page__network-card lifegroups-page__pastor-card mb-2"><div class="card__body">
       <div class="lifegroups-page__network-title"><div><span class="small muted">${p.gender === 'girls' ? 'Pastora' : 'Bishop'}</span><h3><a href="#/networks/${p.id}" aria-label="Open ${p.name || 'pastor Network'}">${p.leader_name || p.name || 'Pastor'}</a></h3><p class="small muted">${kids.length} ${kids.length === 1 ? 'Network Leader' : 'Network Leaders'}${leadTotal ? ` · ${leadTotal} in their cell` : ''}</p></div><span class="badge">${p.is_active ? 'Active' : 'Removed'}</span></div>
       ${kids.length ? html`<ul class="lifegroups-page__cell-list">${kids.map(k => networkRow(k, ''))}</ul>`
         : html`<p class="small muted">No Network Leaders under them yet.</p>`}
       ${leaders.length ? html`` : html`<p class="small muted lifegroups-page__extra-hint">The pastor’s own cell holds the Network Leaders. Open “${p.leader_name || p.name}” to see it.</p>`}
     </div></section>`;
   })}
   ${shownLoose.length ? (shownPastors.length
     ? html`<section class="card lifegroups-page__network-card mb-2"><div class="card__body">
     <div class="lifegroups-page__network-title"><div><span class="small muted">Not under a pastor yet</span><h3>Other Networks</h3><p class="small muted">These Networks are on their own. Edit a Network to place it under a pastor.</p></div></div>
     ${shownLoose.map(n => {
       const cells = groups.filter(g => String(g.network_id) === String(n.id) && (!q || matches(n)));
       const memberTotal = cells.reduce((sum, g) => sum + Number(g.member_count || 0), 0);
       return html`<details class="lifegroups-page__loose-net">
         <summary><b>${n.name || 'Unnamed Network'}</b> <span class="small muted">Network Leader: ${n.leader_name || 'not assigned yet'} · ${cells.length} ${cells.length === 1 ? 'Cell' : 'Cells'} · ${memberTotal} ${memberTotal === 1 ? 'person' : 'people'}</span></summary>
         ${cells.length ? html`<ul class="lifegroups-page__cell-list">${cells.map(g => cellRow(g))}</ul>` : html`<p class="small muted">No Cells to show in this Network${filters.status === 'active' ? ' right now' : ''}.</p>`}
         ${n.is_active ? html`<p class="small"><a href="#/networks/${n.id}">Open ${n.name || 'this Network'} ›</a></p>` : ''}
       </details>`;
     })}
   </div></section>`
     : shownLoose.map(n => {
       const cells = groups.filter(g => String(g.network_id) === String(n.id) && (!q || matches(n)));
       const memberTotal = cells.reduce((sum, g) => sum + Number(g.member_count || 0), 0);
       return html`<section class="card lifegroups-page__network-card mb-2"><div class="card__body">
         <div class="lifegroups-page__network-title"><div><span class="small muted">Network</span><h3><a href="#/networks/${n.id}" aria-label="Open Network ${n.name || n.id}">${n.name || 'Unnamed network'}</a></h3><p class="small muted">Network Leader: ${n.leader_name || 'not assigned yet'}</p></div><span class="badge">${n.is_active ? 'Active' : 'Removed'}</span></div>
         <div class="lifegroups-page__network-count">${cells.length} ${cells.length === 1 ? 'Cell' : 'Cells'} · ${memberTotal} ${memberTotal === 1 ? 'person' : 'people'}</div>
         ${cells.length ? html`<ul class="lifegroups-page__cell-list">${cells.map(g => cellRow(g))}</ul>`
           : html`<p class="small muted">No Cells to show in this Network${filters.status === 'active' ? ' right now' : ''}.</p>`}
       </div></section>`;
     })) : ''}`
   : html`<div class="card"><div class="card__body"><h3>No matching networks</h3><p class="muted">Try another search term or filter.</p><button type="button" class="btn" id="clearLifegroupFilters">Clear filters</button></div></div>`;
  directory.querySelector('#clearLifegroupFilters')?.addEventListener('click',()=>{
   filters.q='';filters.gender='';filters.status='active';
   main.querySelector('#treeQ').value='';main.querySelector('#treeStatus').value='active';syncGender();load();
  });
 };

 // ---------------------------------------------------------------------------
 // Find a person — one box, one tap to where somebody sits.
 // Replaces hunting for a name on the network map (which stays available for
 // staff who want the whole picture, but is no longer the way in).
 // ---------------------------------------------------------------------------
 let peopleIndex=null, peopleIndexError='';
 let repaintFind=null;
 const findPanel=main.querySelector('#findPersonPanel');
 const drawFindPanel=()=>{
  if(!findPanel)return;
  const ready=Array.isArray(peopleIndex);
  findPanel.innerHTML=html`<section class="card lifegroups-page__find-card" aria-labelledby="findPersonHeading">
   <div class="card__body">
    <div class="lifegroups-page__find-head"><div><h2 id="findPersonHeading">Find a person</h2>
     <p class="small muted">Their Cell, Cell Leader and Network — or search a Cell or Network name.</p></div>
     ${ready?html`<span class="small muted nowrap" id="findPersonCount">${peopleIndex.length} people in Cells</span>`:''}</div>
    <div class="lifegroups-page__find-input gsearch">${icon('search',17)}
     <input id="findPersonQ" type="search" autocomplete="off" placeholder="Type a name, e.g. Maria…" aria-label="Find a person in any Cell" aria-controls="findPersonResults" />
    </div>
    <div id="findPersonResults" class="lifegroups-page__find-results" role="region" aria-live="polite"></div>
   </div>
  </section>`;
  const input=findPanel.querySelector('#findPersonQ'), results=findPanel.querySelector('#findPersonResults');
  const paint=()=>{
   const q=input.value.trim();
   if(peopleIndexError&&!Array.isArray(peopleIndex)){
    results.innerHTML=html`<div class="alert alert--error">${peopleIndexError}</div>`;
    return;
   }
   if(!Array.isArray(peopleIndex)){results.innerHTML='<div class="loading">Loading people…</div>';return;}
   if(q.length<2){
    results.innerHTML=html`<p class="small muted lifegroups-page__find-hint">Two letters is enough. Tap a result to open that person.</p>`;
    return;
   }
   const rows=rankPeople(filterPeople(peopleIndex,q),q).slice(0,40);
   // Cells whose name or leader matches: one tap straight into the Cell.
   const cells=q.length>=2?filterTrackerView(cache?.nets||[],cache?.groups||[],{status:'all'}).cells
     .filter(g=>[g.name,g.leader_name].some(v=>String(v||'').toLowerCase().includes(q.toLowerCase()))).slice(0,6):[];
   const cellBlock=cells.length?html`<div class="lifegroups-page__find-cells"><span class="small muted">Cells</span>
     <div class="row" style="gap:6px;flex-wrap:wrap">${cells.map(g=>html`<a class="btn btn--sm" href="#/lifegroups/${g.id}">${icon('group',14)} ${g.name||'Cell'} · ${Number(g.member_count||0)}</a>`)}</div></div>`:'';
   if(!rows.length){
    results.innerHTML=cellBlock||html`<p class="small muted lifegroups-page__find-hint">Nobody in a Cell matches “${q}”. ${can('lifegroups:manage')?html`<a href="#/lifegroups?tab=needs">Check the People to connect list</a> for people without a Cell.`:''}</p>`;
    return;
   }
   results.innerHTML=html`${cellBlock}<ul class="lifegroups-page__find-list">${rows.map(p=>html`<li>
    <a class="lifegroups-page__find-row" href="#/people/${p.id}">
     ${raw(avatar({first_name:p.first_name,last_name:p.last_name,photo:p.photo},'sm'))}
     <span class="lifegroups-page__find-who"><b>${p.first_name||''} ${p.last_name||''}</b>
      <span class="small muted">${p.person_code||''}</span>
      <span class="small lifegroups-page__find-where">${relationshipLine(p)}</span></span>
     <span class="lifegroups-page__find-go" aria-hidden="true">${icon('chevR',16)}</span>
    </a></li>`)}</ul>
    ${rows.length===40?html`<p class="small muted">Showing the first 40 matches — keep typing to narrow it down.</p>`:''}`;
  };
  input.addEventListener('input',debounce(paint,140));
  repaintFind=paint;
  paint();
 };
 const loadPeopleIndex=async()=>{
  if(Array.isArray(peopleIndex))return;
  try{ const rows=await api.lifegroupPeopleIndex(4000); peopleIndex=Array.isArray(rows)?rows:[]; }
  catch(error){ peopleIndexError=error.message||'Unable to load people.'; }
  if(main.contains(findPanel))drawFindPanel();
 };
 drawFindPanel();
 loadPeopleIndex();

 function afterRemove(){
  // People may have moved, so the find box reloads with the tree.
  peopleIndex=null;peopleIndexError='';drawFindPanel();loadPeopleIndex();
  load(true);
 }
 function renderUnassigned(){
  const missing=findUnassignedGroups(cache.nets,cache.groups,filters);
  if(!missing.length){notice.innerHTML='';return;}
  const canManage=can('lifegroups:manage');
  notice.innerHTML=html`<section class="card mb-2" style="border:1px solid #eadbb0;background:#fffdf7" aria-label="Unassigned Cell Leaders">
   <div class="card__body" style="padding:16px 18px"><div class="row row--between" style="align-items:start;gap:12px;flex-wrap:wrap">
   <div><strong style="color:#755b21">${missing.length} Cell${missing.length===1?'':'s'} not connected to a Network</strong>
   <p class="small muted mt-1">These Cell Leaders cannot appear beneath a Network Leader until assigned. Choose the correct Network; no church records will change until you confirm.</p></div></div>
   <div style="display:grid;gap:9px;margin-top:12px">${missing.map(g=>{
     const choices=cache.nets.filter(n=>n.is_active&&n.gender===g.gender);
     return html`<div class="row" style="gap:10px;align-items:center;flex-wrap:wrap;background:#fff;padding:10px 12px;border:1px solid #efe7d2;border-radius:10px">
       <div class="grow" style="min-width:170px"><b>${esc(g.name)}</b><div class="small muted">${esc(g.leader_name||'No cell leader assigned')} · ${Number(g.member_count)||0} members · <a href="#/lifegroups/${g.id}">Open Cell</a></div></div>
       ${canManage&&choices.length?html`<select data-network-for="${g.id}" aria-label="Network for ${esc(g.name)}" style="min-width:165px;width:auto"><option value="">Choose Network…</option>${choices.map(n=>html`<option value="${n.id}">${esc(n.name)}</option>`)}</select><button type="button" class="btn btn--sm btn--primary" data-connect="${g.id}" disabled>Connect</button>`:html`<span class="small muted">${choices.length?'Open the Cell to manage':'No compatible active Network'}</span>`}
     </div>`;})}</div></div></section>`;
  notice.querySelectorAll('[data-network-for]').forEach(select=>{
   const button=notice.querySelector(`[data-connect="${select.dataset.networkFor}"]`);
   select.onchange=()=>{if(button)button.disabled=!select.value;};
  });
  notice.querySelectorAll('[data-connect]').forEach(button=>{
   button.onclick=()=>withLoading(button,async()=>{
    const group=missing.find(g=>String(g.id)===button.dataset.connect);
    const select=notice.querySelector(`[data-network-for="${button.dataset.connect}"]`);
    const network=cache.nets.find(n=>String(n.id)===select?.value);
    if(!group||!network||network.gender!==group.gender||!network.is_active)return toast('Choose a matching active Network.', 'error');
    const confirmed=await confirmDialog({title:'Connect Cell to Network?',message:`Assign <b>${esc(group.name)}</b> to <b>${esc(network.name)}</b>? This changes its Network assignment but preserves its members and attendance history.`,confirmText:'Connect'});
    if(!confirmed)return;
    try{
     await api.updateLifegroup(group.id,{network_id:network.id,network_manual:true});
     toast('Network assignment saved.');
     await load(true);
    }catch(error){toast(error.message,'error');}
   });
  });
 }

 async function load(force=false){
  const seq=++sequence;
  if(!cache||force){
   try{
    const [groups,nets]=await Promise.all([api.lifegroups({status:'all'}),api.networks({status:'all'})]);
    if(seq!==sequence||!main.contains(directory))return;
    cache={groups,nets};
   }catch(e){
    if(seq===sequence)directory.innerHTML=html`<div class="alert alert--error">${e.message}</div>`;
    return;
   }
  }
  if(seq!==sequence||!main.contains(directory))return;
  history.replaceState(null,'','#/lifegroups'+api.qs({q:filters.q,gender:filters.gender,status:filters.status==='active'?'':filters.status}));
  renderUnassigned();
  renderDirectory();
  repaintFind?.();
  const summary=main.querySelector('#treeSummary');
  // Headline numbers: what a leader wants to know before scrolling. "Needs attention"
  // is shown as an actionable number, not buried in a table further down.
  const headline=lifegroupHeadline(cache.nets,cache.groups,filters);
  const {pastors:pastorCount,members:memberTotal,cellLeaders,attention,withoutLeader,unconnected,looseNetworks:looseCount}=headline;
  const num=(value,label,{tone='',href='',title=''}={})=>{
   const inner=html`<span class="lifegroups-page__number-value">${value}</span><span class="lifegroups-page__number-label">${label}</span>`;
   return href?html`<a class="lifegroups-page__number ${tone}" href="${href}" title="${title}">${inner}</a>`
     :html`<div class="lifegroups-page__number ${tone}" title="${title}">${inner}</div>`;
  };
  summary.hidden=Boolean(filters.q);
  summary.classList.remove('is-loading');
  summary.innerHTML=html`
   ${num(pastorCount||'—',pastorCount===1?'Bishop / Pastora':'Bishops / Pastoras',{title:'The pastors at the top of the structure'})}
   ${num(cellLeaders,cellLeaders===1?'Cell Leader':'Cell Leaders',{title:'Cells currently meeting, each with its own Cell Leader'})}
   ${num(memberTotal,memberTotal===1?'Person in a Cell':'People in Cells',{title:'Everyone meeting in a Cell'})}
   ${attention
     ? num(attention,attention===1?'Needs attention':'Need attention',{tone:'is-attention',title:`${withoutLeader} Network${withoutLeader===1?'':'s'} without a leader · ${unconnected} Cell${unconnected===1?'':'s'} not connected to a Network — both listed below`})
     : num('0','Nothing to fix',{tone:'is-ok',title:'Every Cell is connected and every Network has a leader'})}
   ${looseCount?num(looseCount,'Not under a pastor',{tone:'is-warn',title:'Networks with no pastor above them'}):''}`;
 }

 let peopleSearchSeq=0;
 async function searchPeople(){
   const box=main.querySelector('#treePeopleMatches'),q=filters.q.trim(),seq=++peopleSearchSeq;
   if(!can('people:view')||q.length<2){box.hidden=true;box.innerHTML='';return;}
   box.hidden=false;box.innerHTML='<div class="loading">Searching People…</div>';
   try{
     const rows=await api.people({q,status:'all',limit:15});
     if(seq!==peopleSearchSeq||!main.contains(box))return;
     box.innerHTML=rows.length?html`<section class="card mb-2"><div class="card__body" style="padding:12px 16px">
       <b>Matching People</b><div class="row" style="flex-wrap:wrap;gap:8px;margin-top:10px">
       ${rows.map(p=>html`<a class="btn btn--sm" href="#/people/${p.id}">${fullName(p)} · ${p.person_code}</a>`)}
       </div></div></section>`:html`<p class="small muted mb-2">No matching People records. Try a different name or Person ID.</p>`;
   }catch(e){if(seq===peopleSearchSeq)box.innerHTML=html`<p class="small muted">${e.message||'Search unavailable.'}</p>`;}
 }
 main.querySelector('#treeQ').addEventListener('input',debounce(e=>{filters.q=e.target.value.trim();load();searchPeople();},200));
 if(filters.q)searchPeople();
 genderButtons.forEach(button=>button.addEventListener('click',()=>{filters.gender=button.dataset.genderFilter;syncGender();load();}));
 main.querySelector('#treeStatus').addEventListener('change',e=>{filters.status=e.target.value;load();});
 main.querySelector('#treeRefresh').addEventListener('click',()=>load(true));
 const allPeople=main.querySelector('#allPeoplePanel');
 allPeople.addEventListener('toggle',()=>{if(allPeople.open&&!allPeople.dataset.loaded){allPeople.dataset.loaded='yes';drawAllPeople(main.querySelector('#allPeopleBody'));}});
 const needs=main.querySelector('#needsPanel'),progress=main.querySelector('#progressPanel');
 needs.addEventListener('toggle',()=>{if(needs.open&&!needs.dataset.loaded){needs.dataset.loaded='yes';drawNeeds(main.querySelector('#needsBody'));}});
 progress.addEventListener('toggle',()=>{if(progress.open&&!progress.dataset.loaded){progress.dataset.loaded='yes';drawProgressTab(main.querySelector('#progressBody'));}});
 if(query.tab==='people')allPeople.open=true;
 if(query.tab==='needs')needs.open=true;
 if(query.tab==='progress')progress.open=true;
 main.__liveReload=()=>load(true);
 return load();
}

/** In-page People directory: retain canonical People records and existing profile routes. */
async function drawAllPeople(body) {
 body.innerHTML=html`<div class="toolbar"><div class="gsearch grow" style="max-width:none">${icon('search',17)}<input type="search" id="allPeopleQ" placeholder="Search people by name or Person ID" aria-label="Search all People"/></div><label class="small">Status <select id="allPeopleStatus" aria-label="Filter people by status"><option value="all">All active records</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option><option value="first_timer">First timers</option><option value="member">Members</option><option value="leader">Leaders</option></select></label></div><div id="allPeopleResults" role="status"><div class="loading">Loading People…</div></div><div class="row row--between mt-2" id="allPeoplePager"></div>`;
 const result=body.querySelector('#allPeopleResults'),pager=body.querySelector('#allPeoplePager'),input=body.querySelector('#allPeopleQ'),status=body.querySelector('#allPeopleStatus');
 let requestId=0,offset=0;
 const PAGE=50;
 async function load(){
  const version=++requestId,q=input.value.trim();
  result.innerHTML='<div class="loading">Loading People…</div>';pager.innerHTML='';
  try{
   const page=await api.people({q,status:status.value,paged:1,limit:PAGE,offset});
   if(version!==requestId||!body.isConnected)return;
   const rows=Array.isArray(page)?page:page?.people||page?.rows||page?.items||[];
   const total=Array.isArray(page)?rows.length:Number(page?.total??rows.length);
   if(!Number.isFinite(total)||total<0)throw new Error('Invalid directory result. Please retry.');
   if(offset>0&&rows.length===0){offset=total>0?Math.floor((total-1)/PAGE)*PAGE:0;return load();}
   result.innerHTML=rows.length?html`<div class="table-wrap people-directory"><table class="table"><thead><tr><th>Person</th><th>Status</th><th>Profile</th></tr></thead><tbody>${rows.map(p=>html`<tr><td data-label="Person"><div class="person-cell">${raw(avatar(p,'sm'))}<div><strong>${fullName(p)}</strong><div class="small muted">${p.person_code||''}</div></div></div></td><td data-label="Status">${raw(statusBadge(p.status))}</td><td data-label="Profile"><a class="btn btn--sm" href="#/people/${Number(p.id)}">View profile</a></td></tr>`)}</tbody></table></div>`:emptyState({icon:'people',title:'No people found',text:'Try another name or Person ID.'});
   pager.innerHTML=html`<span class="small muted">Showing ${rows.length?offset+1:0}–${offset+rows.length} of ${total}</span><div class="row"><button class="btn btn--sm" type="button" data-prev ${offset===0?'disabled':''}>Previous</button><button class="btn btn--sm" type="button" data-next ${offset+rows.length>=total?'disabled':''}>Next</button></div>`;
   pager.querySelector('[data-prev]').onclick=()=>{offset=Math.max(0,offset-PAGE);load();};
   pager.querySelector('[data-next]').onclick=()=>{offset+=PAGE;load();};
  }catch(e){if(version===requestId&&body.isConnected){result.innerHTML=html`<div class="alert alert--error">${e.message||'Unable to load People.'}</div>`;pager.innerHTML='<button type="button" class="btn btn--sm" data-retry>Retry</button>';pager.querySelector('[data-retry]').onclick=load;}}
 }
 const debouncedSearch=debounce(()=>{offset=0;load();},250);
 input.addEventListener('input',()=>{
  // Invalidate the in-flight request immediately, not after the debounce.
  // Otherwise an old search can repaint stale People while the user is typing.
  requestId++;
  result.innerHTML='<div class="loading">Searching People…</div>';
  pager.innerHTML='';
  debouncedSearch();
 });
 status.addEventListener('change',()=>{offset=0;load();});
 await load();
}

async function drawNeeds(body) {
  body.innerHTML = html`
    <div class="toolbar"><div class="gsearch grow" style="max-width:none">${icon('search', 17)}<input type="search" id="nq" placeholder="Search name or Person ID" autocomplete="off" /></div></div>
    <div class="card"><div id="nlist" class="card__body--flush"><div class="loading">Loading…</div></div></div>`;
  const list = body.querySelector('#nlist');
  let q = '';
  async function load() {
    let rows;
    try { rows = await api.lifegroupNeeds({ q }); } catch (e) { list.innerHTML = html`<div class="alert alert--error" style="margin:16px">${e.message}</div>`; return; }
    if (!rows.length) { list.innerHTML = emptyState({ icon: 'check', title: q ? 'No one matches' : 'Everyone is connected', text: q ? '' : 'Every active person already has a Cell.' }); return; }
    list.innerHTML = html`<div class="table-wrap"><table class="table table--stack">
      <thead><tr><th>Name</th><th>Boy / Girl</th><th>Status</th><th>Last attendance</th><th></th></tr></thead>
      <tbody>${rows.map((p) => html`<tr data-id="${p.id}">
        <td data-label=""><div class="person-cell">${raw(avatar(p, 'sm'))}<div class="person-cell__text"><a class="name" href="#/people/${p.id}">${fullName(p)}</a><div class="code">${p.person_code}${p.is_vip ? raw(' <span class="badge badge--vip badge--nodot">VIP signup</span>') : ''}</div></div></div></td>
        <td data-label="Boy / Girl">${sexBadge(p.sex)}</td>
        <td data-label="Status">${raw(statusBadge(p.status))}</td>
        <td data-label="Last attendance" class="nowrap">${p.last_attended ? fmtDate(p.last_attended, { short: true }) : raw('<span class="muted">—</span>')}</td>
        <td data-label="" class="actions">${can('lifegroups:manage') ? html`<button class="btn btn--sm" data-find="${p.id}">${icon('group', 14)} Find a Cell</button>` : ''}</td>
      </tr>`)}</tbody></table></div>
      <div class="card__footer small muted">${rows.length} ${rows.length === 1 ? 'person' : 'people'} without a Cell</div>`;
    list.querySelectorAll('[data-find]').forEach((b) => {
      const p = rows.find((x) => x.id === Number(b.dataset.find));
      b.onclick = () => findLifegroup(p, () => load());
    });
  }
  body.querySelector('#nq').addEventListener('input', debounce((e) => { q = e.target.value.trim(); load(); }, 250));
  load();
}

// ---------------------------------------------------------------------------
// Group detail
// ---------------------------------------------------------------------------
export async function renderLifegroup({ main }, id) {
  const g = await api.lifegroup(id);
  const manage = can('lifegroups:manage');


  main.innerHTML = html`
  <section class="lifegroup-detail">
    <div class="page-header lifegroup-detail__header">
      <div>
        <a class="small lifegroup-detail__back" href="#/lifegroups">${icon('back', 14)} Back to all Lifegroups</a>
        <div class="lifegroup-detail__identity">
          ${raw(avatar({first_name:(g.leader_name||'Cell').split(' ')[0],last_name:(g.leader_name||'Leader').split(' ').slice(1).join(' '),photo:g.leader_photo}))}
          <div><h1>${g.name || 'Unnamed Cell'}</h1>
            <div class="lifegroup-detail__meta"><span class="lifegroup-detail__role">${icon('user',13)} Cell Leader: ${g.leader_name || 'not assigned yet'}</span>${genderBadge(g.gender)}${g.network_id ? html`<a href="#/networks/${g.network_id}">${icon('group',13)} ${g.network || 'Network'}</a>` : ''}${g.is_active ? '' : raw('<span class="badge badge--nodot">Inactive</span>')}${g.is_demo ? raw('<span class="badge badge--demo badge--nodot">Demo</span>') : ''}</div>
          </div>
        </div>
      </div>
      ${manage ? html`<div class="page-actions"><button class="btn btn--primary" id="addMember">${icon('plus')} Add member</button><button class="btn" id="editGroup" title="Edit Cell Leader">${icon('edit')} Edit</button>${!g.leads_network && g.is_active ? html`<button class="btn" id="removeCellLeader">${icon('trash',16)} Remove</button>` : ''}</div>` : ''}
    </div>

    <div class="lifegroup-detail__stats">
      ${g.leads_network ? html`
        <div class="lifegroup-detail__stat">${icon('user',18)} <div><small>Cell Leaders</small><strong>${g.member_count}<span> / ${g.max_members}</span></strong></div></div>
        <div class="lifegroup-detail__stat">${icon('group',18)} <div><small>Leading a Cell</small><strong>${g.led_groups.length}</strong></div></div>
      ` : html`
        <div class="lifegroup-detail__stat">${icon('people',18)} <div><small>People in this Cell</small><strong>${g.member_count}<span> / 12</span></strong></div></div>
        <div class="lifegroup-detail__stat">${icon('check',18)} <div><small>Settled members</small><strong>${closedCount(g)}<span> / ${g.solid_target}</span></strong></div></div>
      `}
    </div>

    <div class="stack">
      ${g.leads_network ? html`<div class="card">
        <div class="card__header"><h2>Cell leaders</h2><span class="hint">${g.member_count} / ${g.max_members}</span></div>
        <div class="card__body card__body--flush" id="membersCard">
          ${g.members.length ? html`<div class="table-wrap"><table class="table table--stack">
            <thead><tr><th>Cell Leader</th><th>Came (last 4 weeks)</th><th>Their Cell</th><th class="num">People</th><th class="num">Settled</th><th class="num">New</th>${manage ? raw('<th></th>') : ''}</tr></thead>
            <tbody>${g.members.map((m) => { const lg = g.led_groups.find((x) => x.leader_person_id === m.id); return html`<tr data-pid="${m.id}" class="cl-row" data-lg="${lg ? lg.id : ''}" title="${lg ? 'Show how their Cell is doing' : ''}">
              <td data-label="" class="nowrap"><span class="cl-caret" aria-hidden="true"></span><a href="#/people/${m.id}"><b>${fullName(m)}</b></a><div class="code">${m.person_code}</div>${lg ? raw('<div class="small cl-tap">Tap to see how their Cell is doing</div>') : ''}</td>
              <td data-label="Present" class="nowrap"><span class="l4slot muted small">…</span></td>
              <td data-label="Their Cell" class="nowrap">${lg ? html`<a href="#/lifegroups/${lg.id}">View members</a>` : raw('<span class="muted">No members assigned</span>')}</td>
              <td data-label="Members" class="num">${lg ? lg.member_count : '—'}</td>
              <td data-label="Settled" class="num nowrap">${lg ? (lg.solid_count >= g.solid_target ? raw(`<span class="badge badge--present badge--nodot" title="This Cell is thriving">${lg.solid_count}</span>`) : html`<span class="nowrap">${lg.solid_count}<span class="muted small">/${g.solid_target}</span></span>`) : '—'}</td>
              <td data-label="New" class="num">${lg ? lg.member_count - lg.solid_count : '—'}</td>
              ${manage ? html`<td data-label="" class="actions nowrap">${memberActions(m, g)}</td>` : ''}
            </tr>`; })}</tbody></table></div>
            <div class="card__footer small muted">${dotsKey()}</div>` : html`<div class="empty" style="padding:28px"><p>No cell leaders yet.${manage ? raw(' Use <b>Add member</b> to add up to 12 cell leaders.') : ''}</p></div>`}
        </div>
      </div>` : html`<div class="card lifegroup-detail__members">
        <div class="card__header lifegroup-detail__members-head"><div><h2>${icon('people',18)} People in this Cell</h2><p class="small muted">Tap a person to see more, or use the buttons to add, move or remove them.</p></div><span class="hint">${g.member_count} / 12</span></div>
        ${g.members.length>5?html`<div class="lifegroup-detail__member-search"><label for="cellMemberSearch" class="sr-only">Find a person in this Cell</label>${icon('search',16)} <input type="search" id="cellMemberSearch" placeholder="Find a person by name…" autocomplete="off" /><span id="cellMemberCount" class="small muted">${g.members.length} ${g.members.length===1?'person':'people'}</span></div>`:''}
        <div class="card__body card__body--flush" id="membersCard">
          ${g.members.length ? html`<div class="lifegroup-detail__people">${g.members.map(m=>html`
            <div class="lifegroup-detail__person">
              <a class="lifegroup-detail__person-photo" href="#/people/${m.id}" aria-label="Open ${fullName(m)} profile">${raw(avatar(m,'sm'))}</a>
              <div class="lifegroup-detail__person-info">
                <a href="#/people/${m.id}"><strong>${fullName(m)}</strong></a>
                <span title="${m.tier==='solid'?'Attends regularly and is committed':'Still getting to know the group'}">${m.tier==='solid' ? html`${icon('check',13)} Settled` : 'New — still getting to know the group'}${m.role&&m.role!=='member' ? ' · '+m.role : ''}</span>
              </div>
              ${manage ? html`<details class="lifegroup-detail__member-actions">
                <summary title="Manage ${fullName(m)}" aria-label="Manage ${fullName(m)}">${icon('menu',16)}</summary>
                <div class="lifegroup-detail__member-menu">${memberActions(m,g)}
                  <button class="btn btn--sm" data-tier="${m.id}" data-to="${m.tier==='solid'?'new':'solid'}" title="${m.tier==='solid'?'They are still new or not attending regularly':'They attend regularly and are committed'}">${m.tier==='solid'?'Mark as new':'Mark as settled'}</button>
                </div>
              </details>` : ''}
            </div>`)}</div>` : html`<div class="lifegroup-detail__empty">${icon('people',25)}<p>No members yet.</p>${manage ? raw('<p class="small muted">Select Add member to get started.</p>') : ''}</div>`}
        </div>
      </div>`}
      <details class="card lifegroup-detail__info" id="leadershipSection">
        <summary class="card__header">${icon('link',18)} <h2>Network & leadership</h2>${icon('chevR',16)}</summary>
        <div class="card__body"><dl class="dl">
          <div><dt>Leader</dt>${g.leader_person_id ? html`<dd><a href="#/people/${g.leader_person_id}">${g.leader_name}</a>${g.leader_contact ? html` <span class="small muted">· ${g.leader_contact}</span>` : ''}</dd>` : g.leader_name ? html`<dd>${g.leader_name} <span class="small muted">(not registered)</span></dd>` : raw('<dd class="none">—</dd>')}</div>
          <div><dt>Network</dt>${g.network_id ? html`<dd><a href="#/networks/${g.network_id}">${g.network}</a></dd>` : g.network ? html`<dd>${g.network}</dd>` : html`<dd class="none">—</dd>`}</div>
          <div><dt>Network leader</dt>${g.network_leader_name ? html`<dd>${g.network_leader_person_id ? html`<a href="#/people/${g.network_leader_person_id}">${g.network_leader_name}</a>` : g.network_leader_name}</dd>` : raw('<dd class="none">—</dd>')}</div>
        </dl></div>
      </details>
    </div>
    <details class="card mt-2 lifegroup-detail__progress" id="progressDisclosure"><summary class="card__header">${icon('chart',18)} <h2>Attendance &amp; progress</h2>${icon('chevR',16)}</summary><div id="progressCard"></div></details>
    ${g.former.length ? html`<details class="card mt-2" id="formerMembersSection"><summary class="card__header" style="cursor:pointer"><h2>Former members</h2></summary>
      <div class="card__body"><ul class="small" style="margin:0 0 0 18px;columns:2;column-gap:24px">${g.former.map((f) => html`<li><a href="#/people/${f.id}">${fullName(f)}</a> <span class="muted">· ${fmtDate(f.joined_at, { short: true })} → ${fmtDate(f.left_at, { short: true })}</span></li>`)}</ul></div></details>` : ''}
    ${can('lifegroups:manage') && !g.members.length && !g.former.length ? html`<div class="row mt-3" style="padding:0 4px"><button class="btn btn--ghost small" id="delGroup" style="color:var(--muted)">Delete this empty group</button></div>` : ''}
  </section>`;

  const memberSearch=main.querySelector('#cellMemberSearch');
  if(memberSearch){
    const rows=[...main.querySelectorAll('.lifegroup-detail__people .lifegroup-detail__person')];
    const count=main.querySelector('#cellMemberCount');
    memberSearch.addEventListener('input',()=>{
      const term=memberSearch.value.trim().toLocaleLowerCase();
      let shown=0;
      rows.forEach(row=>{
        const matched=row.querySelector('.lifegroup-detail__person-info strong')?.textContent?.toLocaleLowerCase().includes(term);
        row.hidden=!matched;if(matched)shown++;
      });
      count.textContent=shown+' of '+rows.length+(rows.length===1?' person':' people');
    });
  }
  const progressDisclosure=main.querySelector('#progressDisclosure');
  progressDisclosure.addEventListener('toggle',()=>{
    if(!progressDisclosure.open||progressDisclosure.dataset.loaded)return;
    progressDisclosure.dataset.loaded='true';
    // A live update can replace the card before the fetch returns, so read it
    // now rather than querying the page again later.
    const progressCard=main.querySelector('#progressCard');
    if(!progressCard)return;
    renderProgressCard(progressCard, g.id, { onChange: () => {}, onLoaded: (p) => {
    // fill in the last-4-weeks cells now that progress data is here
    const by = new Map(p.members.map((m) => [m.id, m.last4]));
    main.querySelectorAll('#membersCard tr[data-pid] .l4slot').forEach((el) => { const l4 = by.get(Number(el.closest('tr').dataset.pid)); if (l4) el.outerHTML = memberDots(l4).value + (l4.consistency_pct != null ? ` <span class="small muted">${l4.consistency_pct}%</span>` : ''); else el.textContent = '—'; });
    main.querySelectorAll('#membersCard [data-tier]').forEach((b) => {
      const row = b.closest('tr'); const cell = row && row.querySelector('[data-label="Last 4 weeks"]'); const l4 = by.get(Number(b.dataset.tier));
      if (cell && l4) cell.innerHTML = memberDots(l4).value + (l4.consistency_pct != null ? ` <span class="small muted">${l4.consistency_pct}%</span>` : '');
    });
  } });
  });
  main.querySelectorAll('#membersCard [data-tier]').forEach((b) => {
    b.onclick = () => withLoading(b, async () => {
      try { await api.setTier(g.id, Number(b.dataset.tier), b.dataset.to); toast(b.dataset.to === 'solid' ? 'Marked as Settled.' : 'Marked as New.'); renderLifegroup({ main }, id); }
      catch (e) { toast(e.message, 'error'); }
    });
  });
  // Network leader view: click a cell leader row to expand their own Cell's Open / Closed cell
  main.querySelectorAll('#membersCard tr.cl-row').forEach((row) => {
    row.onclick = (ev) => {
      if (ev.target.closest('a, button')) return;
      const lgId = Number(row.dataset.lg);
      if (!lgId) { toast('This cell leader has no Cell yet.', 'info'); return; }
      const next = row.nextElementSibling;
      if (next && next.classList.contains('cl-detail')) { next.remove(); row.classList.remove('is-open'); return; }
      const tr = document.createElement('tr'); tr.className = 'cl-detail';
      const td = document.createElement('td'); td.colSpan = row.children.length; td.dataset.label = '';
      td.innerHTML = '<div class="loading small" style="padding:12px 16px">Loading…</div>';
      tr.appendChild(td); row.after(tr); row.classList.add('is-open');
      const draw = async () => {
        let p;
        try { p = await api.lifegroupProgress(lgId, 4); } catch (e) { td.innerHTML = html`<div class="alert alert--error" style="margin:10px 16px">${e.message}</div>`; return; }
        const solid = p.members.filter((m) => m.tier === 'solid').length;
        td.innerHTML = html`<div class="cl-detail__head small"><a href="#/lifegroups/${lgId}"><b>View Cell Leader</b></a><span class="muted"> · ${p.members.length} people · ${solid} settled / ${p.target}${solid >= p.target ? ' · thriving' : ''} · ${p.members.length - solid} new or not regular</span></div>
          ${p.members.length ? memberSections(p.members.map((m) => ({ ...m, name: `${m.first_name} ${m.last_name}` })), { manage }) : raw('<div class="small muted" style="padding:10px 16px">No members yet.</div>')}`;
        // keep the summary row in sync after a move
        const cellOf = (label) => row.querySelector(`td[data-label="${label}"]`);
        if (cellOf('Members')) cellOf('Members').textContent = p.members.length;
        if (cellOf('New')) cellOf('New').textContent = p.members.length - solid;
        if (cellOf('Settled')) cellOf('Settled').innerHTML = solid >= p.target ? `<span class="badge badge--present badge--nodot" title="This Cell is thriving">${solid}</span>` : `<span class="nowrap">${solid}<span class="muted small">/${p.target}</span></span>`;
        td.querySelectorAll('[data-tier]').forEach((b) => {
          b.onclick = () => withLoading(b, async () => {
            try { await api.setTier(lgId, Number(b.dataset.tier), b.dataset.to); toast(b.dataset.to === 'solid' ? 'Marked as Settled.' : 'Marked as New.'); await draw(); }
            catch (e) { toast(e.message, 'error'); }
          });
        });
      };
      draw();
    };
  });
  main.querySelector('#editGroup')?.addEventListener('click', () => groupForm(g, () => renderLifegroup({ main }, id)));
  main.querySelector('#removeCellLeader')?.addEventListener('click', () => openRemoveFromLifegroups({
    initialTab:'cell',networkId:g.network_id,groupId:g.id,onRemoved:()=>{ location.hash='#/lifegroups'; },
  }));
  main.querySelector('#delGroup')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `Delete ${g.name}?`, message: 'This group has no membership history, so it can be removed.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try { await api.deleteLifegroup(g.id); toast('Cell deleted.', 'info'); location.hash = '#/lifegroups'; } catch (e) { toast(e.message, 'error'); }
  });
  bindMemberActions(main, new Map([[g.id, g]]), () => renderLifegroup({ main }, id));
  main.querySelector('#addMember')?.addEventListener('click', () => addMemberDialog(g, () => renderLifegroup({ main }, id)));
}

// ---------------------------------------------------------------------------
// Networks: the layer above Cell Leaders. Each Network has a leader; group leaders
// report to their Network leader. Networks are flat — every Network has the same shape.
// ---------------------------------------------------------------------------
async function networkForm(n, onSaved) {
  if (!n) return createFourFieldNetwork(onSaved,{allowRegistration:can('people:write')});
  // Existing optional fields are intentionally omitted; server-side update merges them from the record.
  const v = (k) => esc(n?.[k] ?? '');
  const modal = openModal({
    title: n ? `Edit ${n.name}` : 'New Network',
    subtitle: 'Choose a category and link a registered leader. You can assign the leader later.',
    body: `<form id="netForm" class="form-grid" novalidate>
      <div id="netErr" class="alert alert--error span-2" hidden></div>
      <div class="field span-2"><label>Network name <span class="req">*</span></label><input name="name" value="${v('name')}" required autocomplete="off" placeholder="e.g. Network A" /></div>
      <div class="field span-2"><label>Network category <span class="req">*</span></label>
        <div class="choice choice--gender" role="group" aria-label="Network category">
          <label class="choice__opt choice__opt--gender"><input type="radio" name="gender" value="boys" aria-label="Boys network" ${n?.gender === 'boys' ? 'checked' : ''} /><span title="Boys network">${icon('mars', 23)}</span></label>
          <label class="choice__opt choice__opt--gender"><input type="radio" name="gender" value="girls" aria-label="Girls network" ${n?.gender === 'girls' ? 'checked' : ''} /><span title="Girls network">${icon('venus', 23)}</span></label>
        </div><span class="help">Choose a category icon to filter eligible leaders.</span></div>
      <div class="field span-2 gsearch-field"><label for="netLeaderPick">Network leader <span class="opt">optional until assigned</span></label>
        <div class="gsearch" style="max-width:none">${icon('search', 16).value}<input id="netLeaderPick" aria-label="Find a registered Network Leader" placeholder="Find a registered person…" autocomplete="off" /><div class="gsearch__results" id="netLeaderPickResults" hidden></div></div>
        <input type="hidden" id="netLeaderId" name="leader_person_id" />
        <input type="hidden" id="netLegacyLeaderName" name="leader_name" value="${n?.leader_person_id ? '' : v('leader_name')}" />
        <div class="network-leader-picker__status" id="netLeaderStatus" role="status"></div>
        <span class="help" id="netLeaderHint">Select a search result to link a registered person.</span>
        <div class="row network-leader-picker__actions">
          ${can('people:write') ? `<button type="button" class="btn btn--sm" id="netLeaderRegister" aria-expanded="false">${icon('plus', 14).value} Register new leader</button>` : ''}
          <button type="button" class="btn btn--sm btn--ghost" id="netLeaderClear" hidden>Remove leader</button>
        </div>
        ${n?.leader_name && !n?.leader_person_id ? `<div class="network-leader-picker__legacy" role="status">${icon('info', 15)} Existing name: <b>${v('leader_name')}</b>. Select or register this person to link a real profile.</div>` : ''}
      </div>
      <div class="field span-2"><label>Who is this Network under? <span class="opt">optional</span></label>
        <select name="parent_network_id" id="netParent"><option value="">On its own (no pastor above it)</option></select>
        <span class="help">Choose the Bishop or Pastora whose cell this Network Leader belongs to.</span></div>
      ${n ? `<div class="field span-2"><label class="toggle"><input type="checkbox" name="is_active" ${n.is_active ? 'checked' : ''}/> Network is active</label></div>` : ''}
    </form>${can('people:write') ? networkLeaderRegistrationHtml() : ''}`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn--primary" id="saveNet">${n ? 'Save' : 'Create Network'}</button>`,
  });
  modal.querySelector('[data-close]').onclick = closeModal;

  const form = modal.querySelector('#netForm');
  const err = modal.querySelector('#netErr');
  const personId = modal.querySelector('#netLeaderId');
  const personPick = modal.querySelector('#netLeaderPick');
  const legacyName = modal.querySelector('#netLegacyLeaderName');
  const hint = modal.querySelector('#netLeaderHint');
  const status = modal.querySelector('#netLeaderStatus');
  const clear = modal.querySelector('#netLeaderClear');
  const netGenderNow = () => form.querySelector('[name=gender]:checked')?.value || null;
  let explicitlyCleared = false;
  function errorMessage(message) {
    err.textContent = message;
    err.hidden = false;
  }
  function showLeaderStatus() {
    if (personId.value) {
      status.textContent = 'Linked to registered person: ' + personPick.value;
      status.className = 'network-leader-picker__status is-linked';
    } else if (legacyName.value && !explicitlyCleared) {
      status.textContent = 'Not linked to a registered profile yet';
      status.className = 'network-leader-picker__status is-pending';
    } else {
      status.textContent = 'No leader assigned yet';
      status.className = 'network-leader-picker__status is-pending';
    }
    clear.hidden = !personId.value && !legacyName.value;
  }
  function syncGender(clearSelected = false) {
    const gender = netGenderNow();
    hint.textContent = gender ? 'Choose a matching registered person from the search results.' :
      'Choose the category icon first.';
    if (clearSelected && (personId.value || legacyName.value || personPick.value.trim())) {
      // Never silently keep a leader selected for a category they may not match.
      personId.value = '';
      personPick.value = '';
      legacyName.value = '';
      const pickerResults = modal.querySelector('#netLeaderPickResults');
      if (pickerResults) { pickerResults.hidden = true; pickerResults.innerHTML = ''; }
      personPick.setAttribute('aria-expanded', 'false');
      explicitlyCleared = false; // Re-selection is required when changing categories on an existing Network.
      errorMessage('Network category changed. Choose an eligible leader again, or use Remove leader.');
    }
    showLeaderStatus();
  }
  syncGender();
  form.querySelectorAll('[name=gender]').forEach(input => input.addEventListener('change', () => syncGender(true)));
  personPicker(modal, {
    inputId: 'netLeaderPick', hiddenId: 'netLeaderId',
    sex: () => SEX_OF[netGenderNow()] || null,
    initial: n?.leader_person_id ? { id: n.leader_person_id, name: n.leader_name } : null,
    onInput: () => { err.hidden = true; explicitlyCleared = false; showLeaderStatus(); },
    onSelect: () => {
      legacyName.value = '';
      explicitlyCleared = false;
      const registration = modal.querySelector('#netRegisterPanel');
      if (registration) registration.hidden = true;
      modal.querySelector('#netLeaderRegister')?.setAttribute('aria-expanded', 'false');
      err.hidden = true;
      showLeaderStatus();
    },
  });
  showLeaderStatus();
  // Pastor choices: Networks that hold other Networks (Bishop / Pastora).
  const parentSelect = modal.querySelector('#netParent');
  if (parentSelect) {
    api.networks({ status: 'active' }).then(list => {
      const nets = Array.isArray(list) ? list : (list?.networks || []);
      for (const p of nets.filter(x => Number(x.child_count || 0) > 0 || (!x.parent_network_id && nets.some(c => String(c.parent_network_id) === String(x.id))))) {
        parentSelect.add(new Option((p.leader_name ? p.leader_name + ' — ' : '') + p.name, String(p.id)));
      }
      if (n?.parent_network_id) parentSelect.value = String(n.parent_network_id);
    }).catch(() => {});
  }
  clear.onclick = () => {
    personId.value = '';
    personPick.value = '';
    legacyName.value = '';
    explicitlyCleared = true;
    err.hidden = true;
    showLeaderStatus();
  };
  bindNetworkLeaderRegistration(modal, {
    genderNow: netGenderNow, onError: errorMessage,
    onRegistered: person => {
      personId.value = String(person.id);
      personPick.value = person.name;
      legacyName.value = '';
      explicitlyCleared = false;
      err.hidden = true;
      showLeaderStatus();
    },
  });
  const save = event => {
    event.preventDefault();
    if (!form.querySelector('[name=name]').value.trim()) {
      errorMessage('Enter a Network name.');
      form.querySelector('[name=name]').focus();
      return;
    }
    if (!netGenderNow()) {
      errorMessage('Choose a Network category icon.');
      return;
    }
    if (personPick.value.trim() && !personId.value) {
      errorMessage('Select an existing registered person from the search results, or choose Register new leader.');
      personPick.focus();
      return;
    }
    if (n?.leader_person_id && !personId.value && !explicitlyCleared) {
      errorMessage('The original leader selection changed. Select a registered person or choose Remove leader.');
      personPick.focus();
      return;
    }
    return withLoading(modal.querySelector('#saveNet'), async () => {
      const data = formData(form);
      data.gender = netGenderNow();
      data.leader_person_id = personId.value || null;
      data.leader_name = data.leader_person_id ? null : (legacyName.value.trim() || null);
      data.parent_network_id = parentSelect?.value ? Number(parentSelect.value) : null;
      if (n) data.is_active = form.querySelector('[name=is_active]').checked;
      for (const key of Object.keys(data)) if (data[key] === '') data[key] = null;
      try {
        const saved = n ? await api.updateNetwork(n.id, data) : await api.createNetwork(data);
        closeModal();
        toast(n ? 'Network updated.' : 'Network created.');
        onSaved(saved);
      } catch (error) {
        errorMessage(error.message);
      }
    });
  };
  modal.querySelector('#saveNet').onclick = save;
  form.onsubmit = save;

}

export async function renderNetwork({ main }, id, openGroups = new Set(), { autoTried = false } = {}) {
  const [n, cal] = await Promise.all([api.network(id), api.networkCalendar(id, 8, { members: true }).catch(() => null)]);
  const manage = can('lifegroups:manage');
  const isPastorNet = (net) => Boolean(net && net.parent_network_id == null &&
    (Number(net.child_count || 0) > 0 || (net.child_networks || []).length > 0));
  // The Network QR is the network leader's own Cell link. If the leader has no Cell yet, create it once
  // ("<Network> Leaders" — it holds the cell leaders) so the QR always loads.
  let autoErr = '';
  if (manage && n.leader_person_id && !(cal && cal.groups && cal.groups.some((g) => g.is_leader_group)) && !autoTried) {
    try { await api.ensureNetworkLeaderGroup(id); return renderNetwork({ main }, id, openGroups, { autoTried: true }); } catch (e) { autoErr = e.message; }
  }
  const netTarget = cal ? cal.target : 6;
  const last4Of = (gid, pid) => (cal && cal.members_last4 && cal.members_last4[gid] ? cal.members_last4[gid][pid] || null : null);
  // independent network: root = the network leader (their own Cell = the cell leaders); children = the cell leaders' Cell Leaders
  const own = n.groups.find((g) => g.is_leader_group) || null;
  const cells = n.groups.filter((g) => !g.is_leader_group);
  const members = cells.reduce((t, g) => t + g.member_count, 0);
  const boys = cells.reduce((t, g) => t + g.boys, 0), girls = cells.reduce((t, g) => t + g.girls, 0);
  const personLink = (p) => html`<a href="#/people/${p.id}">${fullName(p)}</a>`;
  const leaderGroup = cal && cal.groups ? cal.groups.find((g) => g.is_leader_group) || null : null;

  main.innerHTML = html`
    <div class="page-header">
      <div>
        <a class="small" href="#/lifegroups">${icon('back', 14)} Back to all Lifegroups</a>
        <h1 class="mt-1">${n.name}</h1>
        ${n.parent_network_id ? html`<p class="small muted">Network Leader under <a href="#/networks/${n.parent_network_id}">${n.parent_name || 'their pastor'}</a></p>`
          : isPastorNet(n) ? html`<p class="small muted">Pastor · the Network Leaders under them are listed below</p>` : ''}
        <div class="row mt-1">${genderBadge(n.gender, { long: true, noun: 'network' })}<span class="small muted">${n.is_auto ? 'Created automatically' : 'Created by staff'}</span>${n.is_active ? '' : raw('<span class="badge badge--nodot">Inactive</span>')}${n.is_demo ? raw('<span class="badge badge--demo badge--nodot">Demo data</span>') : ''}</div>
      </div>
      ${manage ? html`<div class="page-actions">${leaderGroup ? html`<button class="btn btn--primary" id="netReport">${icon('plus')} Report a meeting</button>` : ''}<button class="btn" id="editNet">${icon('edit')} Edit</button>${n.is_active?html`<button class="btn" id="removeNetwork">${icon('trash',16)} Remove</button>`:''}</div>` : ''}
    </div>


    ${!n.gender ? html`<div class="alert alert--warn mb-2">${icon('warn', 16)} This Network is not yet marked as boys or girls. ${manage ? 'Press Edit and choose one — networks are never combined.' : 'Ask an Admin to set it.'}${boys && girls ? html` It currently holds ${boys} boys and ${girls} girls; move one side to another Network first.` : ''}</div>` : ''}
    <div class="grid grid--stats mb-2" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <div class="card stat"><span class="stat__label">Cell Leaders in the leader team</span><span class="stat__value">${n.cell_leaders || 0}<small> / 12</small></span><span class="small muted">${leaderGroup ? 'listed in ' + leaderGroup.name : 'the Network Leader has no Cell yet'}</span></div>
      <div class="card stat"><span class="stat__label">Cells</span><span class="stat__value">${n.group_count}</span><span class="small muted">each with its own Cell Leader</span></div>
      <div class="card stat"><span class="stat__label">${n.gender === 'boys' ? 'Boys' : n.gender === 'girls' ? 'Girls' : 'Members'}</span><span class="stat__value">${members}</span>${n.gender ? '' : html`<span class="small muted">${boys} boys · ${girls} girls</span>`}</div>
      <div class="card stat ${n.group_count && cells.filter((g) => g.is_active).every((g) => g.members.filter((m) => m.tier === 'solid').length >= netTarget) ? 'stat--ok' : ''}"><span class="stat__label">Settled members</span><span class="stat__value">${n.closed_cell || 0}</span><span class="small muted">${netTarget} in one Cell means it is thriving</span></div>
      <div class="card stat"><span class="stat__label">New / not yet regular</span><span class="stat__value">${n.open_cell || 0}</span><span class="small muted">no limit — everyone is welcome</span></div>
    </div>

    ${(n.child_networks || []).length ? html`
    <div class="card mb-2" id="childNetworks">
      <div class="card__header"><h2>Network Leaders under ${n.leader_name || 'this pastor'}</h2><span class="hint">${n.child_networks.length} ${n.child_networks.length === 1 ? 'Network' : 'Networks'}</span></div>
      <div class="card__body card__body--flush">
        <ul class="lifegroups-page__cell-list">${n.child_networks.map(c => html`<li><a class="lifegroups-page__cell-row lifegroups-page__cell-row--leader" href="#/networks/${c.id}">
          <span class="lifegroups-page__cell-row-main"><strong>${c.leader_name || c.name}</strong><span>${c.name} · ${c.group_count} ${c.group_count === 1 ? 'Cell' : 'Cells'} · ${c.people_count} ${c.people_count === 1 ? 'person' : 'people'}</span></span>
          <span class="lifegroups-page__cell-row-go" aria-hidden="true">Open ${icon('chevR', 15)}</span></a></li>`)}</ul>
      </div>
    </div>` : ''}

    <div class="card mb-2">
      <div class="card__header"><h2>Structure</h2></div>
      <div class="card__body">
        <div class="tree">
          <div class="tree__root">
            <div class="tree__node tree__node--root">
              <span class="tree__tag">Network leader</span>
              <div class="tree__who">${n.leader_person_id ? html`<a href="#/people/${n.leader_person_id}"><b>${n.leader_name}</b></a>` : n.leader_name ? html`<b>${n.leader_name}</b> <span class="small muted">(profile not linked)</span>` : raw('<span class="muted">No leader set yet</span>')}${n.leader_contact ? html`<span class="small muted"> · ${n.leader_contact}</span>` : ''}</div>
              <div class="small muted">${isPastorNet(n) ? `Pastor · ${(n.child_networks || []).length} Network Leader${(n.child_networks || []).length === 1 ? '' : 's'} report here` : `Network · ${n.cell_leaders || 0} Cell Leader${n.cell_leaders === 1 ? '' : 's'} report here`}</div>
              ${own ? html`<div class="small mt-1 row" style="gap:6px;flex-wrap:wrap;align-items:center">Cell leaders:${own.members.length ? own.members.map((m) => html`<span class="chip-sm"><a href="#/people/${m.id}">${fullName(m)}</a>${manage ? html`<button type="button" class="chip-sm__x" data-leave="${m.id}" data-gid="${own.id}" data-name="${fullName(m)}" data-gname="${own.name}" title="Remove ${fullName(m)} as cell leader" aria-label="Remove ${fullName(m)}">×</button>` : ''}</span>`) : raw('<span class="muted">none yet</span>')}${manage ? html`<button type="button" class="btn btn--ghost btn--sm" id="addCellLeader">${icon('plus', 14)} Add to leader team</button>` : ''}</div>` : ''}
              ${manage ? html`<div class="row mt-1" style="gap:6px;flex-wrap:wrap"><button type="button" class="btn btn--sm" id="editNet2">${icon('edit', 14)} Edit network / change leader</button></div>` : ''}
            </div>
          </div>

          ${cells.length ? html`<div class="tree__children">${cells.map((g) => html`<details class="tree__node tree__node--group ${g.is_active ? '' : 'is-inactive'}" data-gid="${g.id}" ${openGroups.has(g.id) ? 'open' : ''}>
            <summary>
              <div class="row row--between" style="gap:10px;flex-wrap:wrap">
                <div class="min-w-0">
                  <span class="tree__tag tree__tag--with-icon">Cell leader ${genderBadge(g.gender)}</span>
                  <div class="tree__who"><b>${g.leader_name || raw('<span class="muted">Cell Leader not assigned</span>')}</b>${g.is_active ? '' : raw(' <span class="badge badge--nodot">Inactive</span>')}</div>
                  <div class="small muted">${g.member_count} member${g.member_count === 1 ? '' : 's'}</div>
                </div>
                <div class="small muted nowrap">${solidBadge(g.members.filter((m) => m.tier === 'solid').length, netTarget, g.members.filter((m) => m.tier === 'solid').length >= netTarget)}</div>
              </div>
              <span class="tree__toggle small">${icon('chevR', 14)} <span class="t-open">Show members</span><span class="t-close">Hide members</span></span>
            </summary>
            <div class="tree__members">
              <div class="row row--between small mb-1" style="gap:10px;flex-wrap:wrap"><span class="row" style="gap:10px"><a href="#/lifegroups/${g.id}">Open Cell Leader ${icon('chevR', 12)}</a>${g.leader_person_id ? html`<a href="#/people/${g.leader_person_id}">Leader profile</a>` : ''}</span>
                ${manage ? html`<span class="row" style="gap:6px"><button type="button" class="btn btn--sm" data-edit-group="${g.id}">${icon('edit', 14)} Edit group / leader</button><button type="button" class="btn btn--sm" data-add-member="${g.id}">${icon('plus', 14)} Add member</button></span>` : ''}</div>
              ${g.members.length ? memberSections(g.members.map((m) => ({ ...m, name: fullName(m), last4: last4Of(g.id, m.id), sub: raw(statusBadge(m.status)) })), { manage, actions: (m) => memberActions(m, g) }) : raw('<div class="small muted" style="padding:6px 0">No members yet.</div>')}
            </div>
          </details>`)}</div>` : html`<div class="tree__children"><div class="tree__node small muted">${isPastorNet(n) ? 'No Network Leaders under this pastor yet.' : 'No Cell Leaders connected yet.'}${manage ? ' Use Add Cell Leader to connect one.' : ''}</div></div>`}
        </div>
      </div>
      <div class="card__footer small muted">${dotsKey()} · Settled = attends regularly and is committed · New = still getting to know the group. For all the numbers and a spreadsheet export, open <a href="#/reports?view=lifegroups">Reports</a>.</div>
    </div>

    <div class="card mb-2" id="netCalendar"></div>
    ${can('lifegroups:manage') && !n.groups.length ? html`<div class="row mt-3" style="padding:0 4px"><button class="btn btn--ghost small" id="delNet" style="color:var(--muted)">Delete this empty network</button></div>` : ''}`;
  const compact = simplifyNetworkDetail(main, { cells, cal, manage, leaderRegistered: Boolean(n.leader_person_id) });
  main.querySelector('#netLinkLeader')?.addEventListener('click', () => {
    networkForm(n, () => renderNetwork({ main }, id));
    document.querySelector('#netLeaderPick')?.focus();
  });
  // Load the eight-week table only when explicitly requested.
  compact?.history.addEventListener('toggle', () => {
    if (!compact.history.open || compact.history.dataset.loaded) return;
    compact.history.dataset.loaded = 'true';
    renderNetworkCalendar(main.querySelector('#netCalendar'), n.id, cal).catch((e) => toast(e.message, 'error'));
  });
  main.querySelector('#netCreateGroup')?.addEventListener('click', () =>
    groupForm(null, () => renderNetwork({ main }, id), { networkId: n.id, gender: n.gender }));
  main.querySelector('#netQuickAddMember')?.addEventListener('click', () => {
    if (!cells.length) return;
    if (cells.length === 1) return addMemberDialog(cells[0], () => renderNetwork({ main }, id));
    const chooser = compact?.chooser;
    if (!chooser) return;
    chooser.hidden = !chooser.hidden;
    if (chooser.hidden) return;
    chooser.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = 'Choose a Cell';
    chooser.append(heading);
    cells.forEach((group) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = group.name + (group.leader_name ? ' · ' + group.leader_name : '');
      button.addEventListener('click', () => {
        chooser.hidden = true;
        addMemberDialog(group, () => renderNetwork({ main }, id));
      });
      chooser.append(button);
    });
  });
  // move a member between Open / Closed cell straight from the Structure tree (closed cell cap still applies)
  main.querySelectorAll('.tree [data-tier]').forEach((b) => {
    b.onclick = () => withLoading(b, async () => {
      const gid = Number(b.closest('details[data-gid]').dataset.gid);
      try {
        await api.setTier(gid, Number(b.dataset.tier), b.dataset.to);
        toast(b.dataset.to === 'solid' ? 'Marked as Settled.' : 'Marked as New.');
        const keep = new Set([...main.querySelectorAll('details[data-gid][open]')].map((d) => Number(d.dataset.gid)));
        renderNetwork({ main }, id, keep);
      } catch (e) { toast(e.message, 'error'); }
    });
  });
  if (manage && leaderGroup) {
    main.querySelector('#netReport').onclick = async () => { try { const p = await api.lifegroupProgress(leaderGroup.id, 12); meetingForm(leaderGroup.id, p, null, () => renderNetwork({ main }, id)); } catch (e) { toast(e.message, 'error'); } };
  }
  main.querySelector('#editNet')?.addEventListener('click', () => networkForm(n, () => renderNetwork({ main }, id)));
  main.querySelector('#removeNetwork')?.addEventListener('click', () => openRemoveFromLifegroups({
    initialTab:'network',networkId:n.id,onRemoved:()=>{ location.hash='#/lifegroups'; },
  }));
  main.querySelector('#editNet2')?.addEventListener('click', () => networkForm(n, () => renderNetwork({ main }, id)));
  // in-place editing: cell leaders, groups, members (keeps the opened groups open after a change)
  const refresh = () => renderNetwork({ main }, id, new Set([...main.querySelectorAll('details[data-gid][open]')].map((d) => Number(d.dataset.gid))));
  const groupsById = new Map(n.groups.map((g) => [g.id, g]));
  main.querySelector('#addCellLeader')?.addEventListener('click', () => addMemberDialog(own, refresh, { title: `Add a cell leader to ${n.name}`, buttonText: 'Add as cell leader', role: 'leader' }));
  main.querySelectorAll('[data-add-member]').forEach((b) => { b.onclick = () => { const g = groupsById.get(Number(b.dataset.addMember)); if (g) addMemberDialog(g, refresh); }; });
  main.querySelectorAll('[data-edit-group]').forEach((b) => {
    b.onclick = () => withLoading(b, async () => {
      try { const full = await api.lifegroup(Number(b.dataset.editGroup)); groupForm(full, refresh); } catch (e) { toast(e.message, 'error'); }
    });
  });
  bindMemberActions(main, groupsById, refresh);
  main.querySelector('#delNet')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `Delete ${n.name}?`, message: 'This Network has no Cell Leaders, so it can be removed.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try { await api.deleteNetwork(n.id); toast('Network deleted.', 'info'); location.hash = '#/lifegroups?tab=networks'; } catch (e) { toast(e.message, 'error'); }
  });
}
