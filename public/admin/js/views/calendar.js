/**
 * Admin events calendar: month grid + event manager (create / edit / delete).
 * Data lives in the shared calendar_events table; the public website shows
 * published events, staff also see drafts here.
 */
import { api } from '../api.js';
import { state, can } from '../app.js';
import { html, raw, icon, esc, toast, openModal, closeModal, confirmDialog, formData, withLoading } from '../ui.js';

const CATS = {
  service: 'Sunday service', worship: 'Worship night', prayer: 'Prayer gathering',
  youth: 'Youth', lifegroup: 'Lifegroup', outreach: 'Outreach', special: 'Special event',
};
const CAT_CLASS = {
  service: 'acal--service', worship: 'acal--worship', prayer: 'acal--prayer', youth: 'acal--youth',
  lifegroup: 'acal--lifegroup', outreach: 'acal--outreach', special: 'acal--special',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtClock = (t) => {
  if (!t) return 'All day';
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return m ? `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}` : `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`;
};
const fmtRange = (e) => (e.all_day || !e.start_time ? 'All day' : e.end_time && e.end_time !== e.start_time ? `${fmtClock(e.start_time)} – ${fmtClock(e.end_time)}` : fmtClock(e.start_time));
const fmtLong = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${DOWS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
};
const norm = (e) => ({ ...e, date: e.event_date || e.date, start_time: e.start_time ? String(e.start_time).slice(0, 5) : null, end_time: e.end_time ? String(e.end_time).slice(0, 5) : null });

export async function renderCalendar({ main }) {
  const manage = can('calendar:manage');
  const now = new Date();
  let view = new Date(now.getFullYear(), now.getMonth(), 1);
  let data = null;

  async function load() {
    data = await api.calendarEvents({ months: 13 });
  }

  function byDate() {
    const map = new Map();
    for (const raw_ of data.events) {
      const e = norm(raw_);
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    }
    return map;
  }

  function draw() {
    const y = view.getFullYear(), m = view.getMonth();
    const map = byDate();
    const todayKey = data.today || iso(now);
    const firstDow = new Date(y, m, 1).getDay();
    const start = new Date(y, m, 1 - firstDow);
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = iso(d);
      const out = d.getMonth() !== m;
      const events = map.get(key) || [];
      const chips = events.slice(0, 2).map((e) =>
        html`<span class="acal__chip ${CAT_CLASS[e.category]}${e.is_published === false ? ' is-draft' : ''}"><b>${e.all_day ? '' : fmtClock(e.start_time)}</b>${e.title}</span>`);
      const more = events.length > 2 ? html`<span class="acal__more">+${events.length - 2} more</span>` : '';
      cells += html`<button type="button" class="acal__cell${out ? ' is-out' : ''}${key === todayKey ? ' is-today' : ''}${events.length ? ' has-events' : ''}" data-date="${key}" aria-label="${fmtLong(key)}${events.length ? `, ${events.length} event${events.length > 1 ? 's' : ''}` : ''}">
        <span class="acal__daynum">${d.getDate()}</span>
        <span class="acal__chips">${chips}${more}</span>
      </button>`;
    }
    const monthEvents = [...map.entries()].filter(([k]) => k.startsWith(`${y}-${pad(m + 1)}`)).flatMap(([, v]) => v);
    const upcoming = data.events.map(norm).filter((e) => e.date >= (data.today || iso(now)) && e.is_published !== false).slice(0, 8);

    main.innerHTML = html`
      <div class="page-header">
        <div><h1>Calendar</h1><p class="sub">Church events shown on the public website. Published events appear to everyone; drafts stay staff-only.</p></div>
        <div class="page-actions">
          ${manage ? html`<button class="btn btn--primary btn--sm" id="acalNew">${icon('plus', 15)} New event</button>` : ''}
        </div>
      </div>
      <div class="card acal">
        <div class="acal__toolbar">
          <div><h2 id="acalTitle">${MONTHS[m]} ${y}</h2><span class="small muted">Asia/Manila · Sundays show the weekly 1:00 PM service automatically</span></div>
          <div class="acal__navbtns">
            <button class="icon-btn" id="acalPrev" aria-label="Previous month">${icon('chevL', 18)}</button>
            <button class="btn btn--sm" id="acalToday">Today</button>
            <button class="icon-btn" id="acalNext" aria-label="Next month">${icon('chevR', 18)}</button>
          </div>
        </div>
        <div class="acal__dow" aria-hidden="true">${DOWS.map((d) => html`<span>${d.slice(0, 3)}</span>`)}</div>
        <div class="acal__grid" id="acalGrid">${raw(cells)}</div>
        <div class="acal__legend">${Object.entries(CATS).map(([k, label]) => html`<span><i class="acal__dot ${CAT_CLASS[k]}"></i>${label}</span>`)}</div>
      </div>
      <div class="cal-two-col">
        <div class="card">
          <div class="card__header"><h3>${MONTHS[m]} events</h3><span class="small muted">${monthEvents.length} total</span></div>
          ${monthEvents.length ? html`<div class="table-wrap"><table class="table table--compact">
            <thead><tr><th>Date</th><th>Event</th><th>Time</th><th>Status</th>${manage ? raw('<th></th>') : ''}</tr></thead>
            <tbody>${monthEvents.map((e) => html`<tr>
              <td class="nowrap">${fmtLong(e.date).replace(/, \d{4}/, '')}</td>
              <td><strong>${e.title}</strong><div class="small muted">${CATS[e.category] || 'Event'}${e.location ? ` · ${e.location}` : ''}</div></td>
              <td class="nowrap">${fmtRange(e)}</td>
              <td>${raw(e.recurring ? '<span class="badge badge--demo">Weekly</span>' : e.is_published === false ? '<span class="badge badge--muted">Draft</span>' : '<span class="badge badge--present">Published</span>')}</td>
              ${manage && e.recurring ? raw('<td></td>') : ''}${manage && !e.recurring ? html`<td class="nowrap row-actions"><button class="icon-btn" data-edit="${e.id}" aria-label="Edit ${e.title}">${icon('edit', 15)}</button><button class="icon-btn" data-del="${e.id}" aria-label="Delete ${e.title}">${icon('trash', 15)}</button></td>` : ''}
            </tr>`)}</tbody>
          </table></div>` : html`<p class="muted" style="padding:14px 4px">No stored events this month — the weekly Sunday service still appears.</p>`}
        </div>
        <div class="card">
          <div class="card__header"><h3>Upcoming</h3><span class="small muted">what visitors see first</span></div>
          ${raw(upcoming.length ? `<div class="acal__mini">${upcoming.map((e) => `
            <div class="acal__mini-row ${CAT_CLASS[e.category]}"><span class="acal__mini-date">${Number(e.date.slice(8))} ${MONTHS[Number(e.date.slice(5, 7)) - 1].slice(0, 3)}</span>
            <span class="acal__mini-body"><strong>${esc(e.title)}</strong><small>${fmtRange(e)}${e.location ? ` · ${esc(e.location)}` : ''}</small></span></div>`).join('')}</div>`
        : '<p class="muted" style="padding:14px 4px">Nothing scheduled yet besides the weekly Sunday service.</p>')}
        </div>
      </div>`;

    document.getElementById('acalPrev').onclick = () => { view = new Date(y, m - 1, 1); draw(); };
    document.getElementById('acalNext').onclick = () => { view = new Date(y, m + 1, 1); draw(); };
    document.getElementById('acalToday').onclick = () => { view = new Date(now.getFullYear(), now.getMonth(), 1); draw(); };
    const newBtn = document.getElementById('acalNew');
    if (newBtn) newBtn.onclick = () => openForm(null, null);
    document.getElementById('acalGrid').onclick = (e) => {
      const cell = e.target.closest('[data-date]');
      if (cell) openDay(cell.dataset.date);
    };
    main.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); openForm(findEvent(b.dataset.edit), null); }; });
    main.querySelectorAll('[data-del]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); removeEvent(findEvent(b.dataset.del)); }; });
  }

  const findEvent = (id) => data.events.map(norm).find((e) => String(e.id) === String(id));

  function openDay(dateKey) {
    const events = (byDate().get(dateKey) || []);
    const editable = events.filter((e) => !e.recurring);
    const manageBtns = manage
      ? `<div class="acal__day-actions">${editable.length ? '<button class="btn btn--sm" data-day-edit>__EDIT__</button>' : ''}<button class="btn btn--primary btn--sm" data-day-add>${icon('plus', 14).value} Add event on this day</button></div>`
      : '';
    const body = events.length
      ? events.map((e) => `
        <div class="acal__evrow ${CAT_CLASS[e.category]}${e.is_published === false ? ' is-draft' : ''}">
          <div class="acal__evrow-main">
            <strong>${esc(e.title)}</strong>
            <small>${fmtRange(e)} · ${esc(CATS[e.category] || 'Event')}${e.location ? ` · ${esc(e.location)}` : ''}${e.is_published === false ? ' · <b class="acal__draft-tag">Draft</b>' : ''}</small>
          </div>
          ${manage && !e.recurring ? `<span class="nowrap"><button class="icon-btn" data-ev-edit="${e.id}" aria-label="Edit">${icon('edit', 15).value}</button><button class="icon-btn" data-ev-del="${e.id}" aria-label="Delete">${icon('trash', 15).value}</button></span>` : ''}
        </div>`).join('')
      : `<p class="muted" style="margin:6px 0 2px">No events on ${esc(fmtLong(dateKey))}.</p>`;
    const modal = openModal({
      title: fmtLong(dateKey),
      subtitle: events.length ? `${events.length} event${events.length > 1 ? 's' : ''} scheduled` : 'Nothing scheduled for this day',
      body: body + manageBtns.replace('__EDIT__', editable.length === 1 ? 'Edit event' : 'Edit first event'),
      footer: '',
      onClose: null,
    });
    const addBtn = modal.querySelector('[data-day-add]');
    if (addBtn) addBtn.onclick = () => openForm(null, dateKey);
    const editBtn = modal.querySelector('[data-day-edit]');
    if (editBtn && editable.length) editBtn.onclick = () => openForm(editable[0], null);
    modal.querySelectorAll('[data-ev-edit]').forEach((b) => { b.onclick = () => openForm(findEvent(b.dataset.evEdit), null); });
    modal.querySelectorAll('[data-ev-del]').forEach((b) => { b.onclick = () => removeEvent(findEvent(b.dataset.evDel)); });
  }

  function openForm(existing, presetDate) {
    const e = existing || { title: '', category: 'special', date: presetDate || iso(now), start_time: '18:00', end_time: '20:00', all_day: false, location: '', description: '', is_published: true };
    const modal = openModal({
      title: existing ? 'Edit event' : 'New calendar event',
      subtitle: existing ? 'Saved changes appear on the public calendar immediately.' : 'Published events appear on the public website calendar right away.',
      wide: true,
      body: html`<form id="acalForm" class="form-grid">
        <div class="field" style="grid-column:1/-1"><label for="acfTitle">Event title *</label><input id="acfTitle" name="title" maxlength="200" required value="${e.title}" placeholder="e.g. Youth Night — Worship &amp; Word" /></div>
        <div class="field"><label for="acfCat">Category *</label><select id="acfCat" name="category">${Object.entries(CATS).map(([k, v]) => html`<option value="${k}"${raw(k === e.category ? ' selected' : '')}>${v}</option>`)}</select></div>
        <div class="field"><label for="acfDate">Date *</label><input id="acfDate" name="date" type="date" required value="${e.date}" /></div>
        <div class="field"><label for="acfStart">Starts</label><input id="acfStart" name="start_time" type="time" step="60" value="${e.start_time || ''}" /></div>
        <div class="field"><label for="acfEnd">Ends</label><input id="acfEnd" name="end_time" type="time" step="60" value="${e.end_time || ''}" /></div>
        <div class="field" style="grid-column:1/-1"><label for="acfLoc">Location</label><input id="acfLoc" name="location" maxlength="200" value="${e.location || ''}" placeholder="e.g. Main sanctuary · Lifegiver Church of Faith — Central" /></div>
        <div class="field" style="grid-column:1/-1"><label for="acfDesc">Description</label><textarea id="acfDesc" name="description" rows="3" maxlength="2000" placeholder="What is this gathering about? Shown when a visitor taps the event.">${e.description || ''}</textarea></div>
        <label class="acal__check"><input id="acfAllDay" name="all_day" type="checkbox"${raw(e.all_day ? ' checked' : '')}/> All-day event (hides the times)</label>
        <label class="acal__check"><input id="acfPub" name="is_published" type="checkbox"${raw(e.is_published !== false ? ' checked' : '')}/> Published — visible on the public website</label>
      </form>`,
      footer: `<button class="btn" data-cancel>Cancel</button><button class="btn btn--primary" data-save>${existing ? 'Save changes' : 'Create event'}</button>`,
    });
    const form = modal.querySelector('#acalForm');
    const allDay = modal.querySelector('#acfAllDay');
    const syncTimes = () => {
      modal.querySelector('#acfStart').disabled = allDay.checked;
      modal.querySelector('#acfEnd').disabled = allDay.checked;
    };
    allDay.onchange = syncTimes;
    syncTimes();
    modal.querySelector('[data-cancel]').onclick = closeModal;
    modal.querySelector('[data-save]').onclick = () => withLoading(modal.querySelector('[data-save]'), async () => {
      const v = formData(form);
      if (!v.title) { toast('Give the event a title.', 'error'); return; }
      try {
        await api.saveCalendarEvent({
          id: existing?.id,
          title: v.title,
          category: v.category,
          date: v.date,
          start_time: allDay.checked ? '' : (v.start_time || ''),
          end_time: allDay.checked ? '' : (v.end_time || ''),
          all_day: allDay.checked,
          location: v.location || '',
          description: v.description || '',
          is_published: modal.querySelector('#acfPub').checked,
        });
        closeModal();
        toast(existing ? 'Event updated.' : 'Event created — it is on the public calendar.', 'success');
        await load();
        const target = new Date(v.date + 'T12:00:00');
        view = new Date(target.getFullYear(), target.getMonth(), 1);
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    setTimeout(() => modal.querySelector('#acfTitle').focus(), 30);
  }

  async function removeEvent(e) {
    if (!e) return;
    const ok = await confirmDialog({
      title: 'Delete event',
      message: `Remove <b>${esc(e.title)}</b> on ${esc(fmtLong(e.date))} from the calendar? This cannot be undone.`,
      confirmText: 'Delete event',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCalendarEvent(e.id);
      toast('Event deleted.', 'success');
      closeModal();
      await load();
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  await load();
  draw();
  main.__liveReload = async () => { await load(); draw(); };
  return () => { main.__liveReload = null; };
}
