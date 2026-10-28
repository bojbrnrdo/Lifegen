import { api } from '../api.js';
import { can } from '../app.js';
import { html, raw, icon, avatar, statusBadge, classBadge, fmtDate, fmtDateTime, fmtNum, fmtPct, age, toast, confirmDialog, openModal, closeModal, withLoading, STATUS_LABELS, DAY_LABELS, DAY_SHORT, TIME_LABELS, fmtSchedule } from '../ui.js';

/** Person profile: who they are, how often they attend, and their Sunday history. */
export async function renderPerson({ main }, id) {
  const p = await api.person(id);
  const locked = p.private_hidden;
  const inactive = p.status === 'inactive';
  const archived = Boolean(p.archived_at);
  const present = p.history.filter((h) => h.status === 'present');

  const row = (label, value, fmt = (x) => x, sensitive = false) => {
    if (locked && (sensitive || value === undefined)) return html`<div><dt>${label}</dt><dd class="locked">${icon('lock', 13)} Restricted</dd></div>`;
    return html`<div><dt>${label}</dt>${value ? html`<dd>${fmt(value)}</dd>` : raw('<dd class="none">—</dd>')}</div>`;
  };

  main.innerHTML = html`
    <div class="page-header">
      <div class="profile-head">
        ${raw(avatar(p, 'lg'))}
        <div class="info">
          <a class="small" href="#/people">${icon('back', 14)} People</a>
          <h1 class="mt-1">${p.first_name} ${p.middle_name ? p.middle_name + ' ' : ''}${p.last_name}</h1>
          <div class="row mt-1"><span class="code mono">${p.person_code}</span>${archived ? raw('<span class="badge badge--nodot">Archived</span>') : ''}${raw(statusBadge(p.status))}${p.is_demo ? raw('<span class="badge badge--demo badge--nodot">Demo data</span>') : ''}</div>
        </div>
      </div>
      ${can('people:write') && !archived ? html`<div class="page-actions">
        <button class="btn" id="statusBtn">Change status</button>
        <a class="btn btn--primary" href="#/people/${p.id}/edit">${icon('edit')} Edit</a>
      </div>` : ''}
    </div>

    <div class="grid grid--stats mb-2" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="card stat"><span class="stat__label">Attendance</span><span class="stat__value">${fmtNum(p.sundays_attended)}<small> / ${p.services_since} Sundays</small></span></div>
      <div class="card stat"><span class="stat__label">Attendance rate</span><span class="stat__value">${fmtPct(p.attendance_rate)}</span></div>
      <div class="card stat"><span class="stat__label">First attended</span><span class="stat__value" style="font-size:1.15rem">${p.date_first_attended ? fmtDate(p.date_first_attended) : '—'}</span></div>
      <div class="card stat"><span class="stat__label">Last attended</span><span class="stat__value" style="font-size:1.15rem">${p.last_attended ? fmtDate(p.last_attended) : '—'}</span></div>
    </div>


    <div class="grid grid--2">
      <div class="card">
        <div class="card__header"><h2>Details</h2>${locked ? raw(`<span class="hint">${icon('lock', 13).value} Contact details hidden for your role</span>`) : ''}</div>
        <div class="card__body"><dl class="dl">
          ${row('Contact number', p.contact_number, (v) => html`<a href="tel:${String(v).replace(/[^+0-9]/g, '')}">${v}</a>`, true)}
          ${row('Email', p.email, (v) => html`<a href="mailto:${v}">${v}</a>`, true)}
          ${row('Birthday', p.birthdate, (v) => `${fmtDate(v)} · ${age(v)} yrs`, true)}
          ${row('Sex', p.sex, (v) => v[0].toUpperCase() + v.slice(1))}
          ${row('School', p.school)}
          ${row('Course / Year', p.course_year)}
          ${row('Occupation', p.occupation)}
          ${!p.birthdate ? row('Age', p.age, (v) => `${v} yrs (self-reported)`, true) : ''}
          ${row('Ministry', p.ministry)}
          ${row('Registered', p.date_registered, (v) => fmtDate(v) + (p.registration_source === 'qr' ? ' · via QR registration' : ''))}
          <div><dt>Privacy consent</dt><dd>${locked ? html`<span class="locked">${icon('lock', 13)} Restricted</span>` : p.privacy_consent_at ? html`Given · ${fmtDate(p.privacy_consent_at)}` : raw('<span class="muted">Not yet recorded</span>')}</dd></div>
          <div style="grid-column:1/-1">${row('Address', p.address, (v) => v, true)}</div>
          ${!locked && p.notes ? html`<div style="grid-column:1/-1"><dt>Notes</dt><dd>${p.notes}</dd></div>` : ''}
        </dl></div>
      </div>

      <div class="card">
        <div class="card__header"><h2>Attendance history</h2><span class="hint">${present.length} Sunday${present.length === 1 ? '' : 's'} present</span></div>
        <div class="card__body card__body--flush">
          ${p.history.length ? html`<ul class="timeline" style="padding:4px 20px">
            ${p.history.map((h) => html`<li>
              <span class="date">${fmtDate(h.service_date, { short: true })}</span>
              ${h.status === 'present' ? raw(classBadge(h.classification)) : raw('<span class="badge badge--absent">Absent</span>')}
              <span class="when">${h.recorded_by || ''}<br>${fmtDateTime(h.recorded_at)}</span>
            </li>`)}
          </ul>` : html`<div class="empty" style="padding:32px"><p>No attendance recorded yet.</p></div>`}
        </div>
      </div>
    </div>

    ${archived ? html`<div class="alert alert--info mt-3">This person is archived — hidden from People, search and the Sunday roster. Attendance history is kept.${can('people:write') ? html` <button class="btn btn--sm" id="restoreBtn" style="margin-left:8px">Restore</button>` : ''}</div>` : ''}
    ${can('people:write') && !archived ? html`<div class="row row--between mt-3" style="padding:0 4px">
      <span class="small muted">${inactive ? 'This person is inactive and not shown on the Sunday roster.' : 'Deactivating keeps all history but removes the person from the Sunday roster.'}</span>
      <span class="row">
        <button class="btn ${inactive ? '' : 'btn--danger-ghost'}" id="toggleActive">${inactive ? 'Reactivate' : 'Deactivate'}</button>
        <button class="btn btn--ghost small" id="archiveBtn" style="color:var(--muted)" title="Hide from lists; keep history">Archive</button>
      </span>
    </div>` : ''}`;

  main.querySelector('#archiveBtn')?.addEventListener('click', async (e) => {
    const ok = await confirmDialog({
      title: `Archive ${p.first_name}?`,
      message: 'Archived people disappear from People, search and the Sunday roster but <b>all attendance history is kept</b> and past totals do not change. You can restore them anytime from People → Archived.',
      confirmText: 'Archive',
    });
    if (!ok) return;
    await withLoading(e.currentTarget, async () => {
      try { await api.archivePerson(p.id); toast(`${p.first_name} archived.`, 'info'); renderPerson({ main }, id); }
      catch (err) { toast(err.message, 'error'); }
    });
  });
  main.querySelector('#restoreBtn')?.addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
    try { await api.restorePerson(p.id); toast(`${p.first_name} restored.`); renderPerson({ main }, id); }
    catch (err) { toast(err.message, 'error'); }
  }));

  main.querySelector('#toggleActive')?.addEventListener('click', async (e) => {
    if (!inactive) {
      const ok = await confirmDialog({ title: `Deactivate ${p.first_name}?`, message: 'They will no longer appear on the Sunday attendance list. All past attendance is kept and this can be reversed anytime.', confirmText: 'Deactivate', danger: true });
      if (!ok) return;
      await withLoading(e.currentTarget, async () => {
        try { await api.setPersonStatus(p.id, 'inactive'); toast(`${p.first_name} deactivated.`, 'info'); renderPerson({ main }, id); }
        catch (err) { toast(err.message, 'error'); }
      });
    } else openStatusModal('regular');
  });

  main.querySelector('#statusBtn')?.addEventListener('click', () => openStatusModal(p.status));

  function openStatusModal(selected) {
    const modal = openModal({
      title: 'Change status',
      subtitle: `${p.first_name} ${p.last_name} · currently ${STATUS_LABELS[p.status]}`,
      body: `<div class="field"><label>New status</label><select id="newStatus">${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn--primary" id="saveStatus">Save</button>`,
    });
    modal.querySelector('[data-close]').onclick = closeModal;
    modal.querySelector('#saveStatus').onclick = (e) => withLoading(e.currentTarget, async () => {
      const s = modal.querySelector('#newStatus').value;
      try { await api.setPersonStatus(p.id, s); closeModal(); toast(`Status updated to ${STATUS_LABELS[s]}.`); renderPerson({ main }, id); }
      catch (err) { toast(err.message, 'error'); }
    });
  }


}
