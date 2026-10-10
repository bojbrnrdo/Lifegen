import { api } from '../api.js';
import { state, can } from '../app.js';
import { html, raw, icon, fmtDate, fmtDateTime, toast, withLoading, openModal, closeModal, debounce } from '../ui.js';
/** Attendee column reflects the linked person's status and Sunday attendance count. */
function attendeeCell(r){
 const n=Number(r.sundays_attended)||0;
 if(r.person_status==='member')return html`<span class="badge badge--regular">Member</span><div class="small muted">${n} Sundays since ${fmtDate(r.first_attended,{short:true})}</div>`;
 if(r.long_time_attendee)return html`<span class="badge badge--regular">5+ Sundays</span><div class="small muted">${n} Sundays since ${fmtDate(r.first_attended,{short:true})}</div>`;
 if(n)return html`<span class="small">${n} ${n===1?'Sunday':'Sundays'}</span>`;
 return html`<span class="muted">—</span>`;
}
export async function refreshPendingBadge(){
 if(!state.user||!can('registrations:manage'))return;
 try{const r=await api.registrationCounts(),badge=document.getElementById('navPendingBadge');if(badge){badge.textContent=r.pending;badge.hidden=r.pending===0;}}catch{}
}
export async function renderRegistrations({main,query}){
 let filter=query.status||'new',search=query.q||'';
 main.innerHTML=html`<div class="page-header"><div><h1>VIP registrations</h1><p class="sub">From the LIFEGEN website, directly into the shared database.</p></div><div class="page-actions"><a class="btn" href="#/qr-poster">${icon('qr')} Registration QR</a><button class="btn" id="refreshVips">${icon('refresh')} Refresh</button></div></div>
 <div class="sync-note mb-2"><b>Already connected.</b> Every VIP signup creates a First Timer in <a href="#/people">People</a>. After five distinct Sunday visits are recorded as present, their status automatically changes to Member. Reviewing a registration does not create a second person.</div>
 <div class="card mb-2"><div class="card__header"><h2>Sunday check-ins awaiting validation</h2></div><div class="card__body" id="pendingChecks">Loading…</div></div>
 <div class="toolbar"><div class="filter-tabs" id="vipFilters"><button data-f="new" class="${filter==='new'?'active':''}">New</button><button data-f="reviewed" class="${filter==='reviewed'?'active':''}">Reviewed</button><button data-f="all" class="${filter==='all'?'active':''}">All</button></div><div class="gsearch grow">${icon('search')}<input id="vipSearch" type="search" value="${search}" placeholder="Search VIP, inviter or contact" aria-label="Search registrations"/></div></div><div class="card" id="vipList"></div>`;
 async function load(){
  const box=main.querySelector('#pendingChecks'),list=main.querySelector('#vipList');if(!box||!list)return;
  const [data,pending]=await Promise.all([api.registrations({status:filter,q:search}),api.pendingCheckins()]);
  if(!main.contains(box)||!main.contains(list))return;box.innerHTML=pending.length?html`<div class="stack">${pending.map(c=>html`<div class="row row--between"><div><a href="#/people/${c.person_id}"><b>${c.full_name}</b></a><div class="small muted">${c.date_key} · ${c.person_code}</div></div><div class="row">${can('attendance:write')?html`<button class="btn btn--primary btn--sm" data-check="${c.id}" data-valid="true">Validate</button><button class="btn btn--sm" data-check="${c.id}" data-valid="false">Decline</button>`:''}</div></div>`)}</div>`:'<p class="small muted">No pending check-ins.</p>';
  box.querySelectorAll('[data-check]').forEach(b=>b.onclick=e=>withLoading(b,async()=>{try{await api.validateCheckin(Number(b.dataset.check),b.dataset.valid==='true');toast('Check-in updated.');load();}catch(err){toast(err.message,'error');}}));
  list.innerHTML=data.items.length?html`<div class="table-wrap"><table class="table table--stack"><thead><tr><th>VIP / Person</th><th>Age</th><th>School</th><th>Inviter</th><th>Attendee</th><th>Registered</th><th></th></tr></thead><tbody>${data.items.map(r=>html`<tr><td data-label="VIP"><a href="#/people/${r.person_id}"><b>${r.full_name}</b></a><div class="small muted">${r.person_code} · ${r.review_status==='new'?'New':'Reviewed'}</div></td><td data-label="Age">${r.age??'—'}</td><td data-label="School">${r.school||'—'}</td><td data-label="Inviter">${r.inviter||'—'}</td><td data-label="Attendee">${attendeeCell(r)}</td><td data-label="Registered" class="small">${fmtDateTime(r.created_at)}</td><td><button class="btn btn--sm" data-view="${r.id}">View</button></td></tr>`)}</tbody></table></div><div class="card__footer small muted">${data.items.length} registrations shown</div>`:'<div class="empty"><h3>No registrations here yet</h3><p>New VIP signups appear automatically. No CSV import or manual refresh is needed.</p></div>';
  list.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>openVip(Number(b.dataset.view),load));refreshPendingBadge();
 }
 main.querySelector('#refreshVips').onclick=load;main.querySelector('#vipSearch').oninput=debounce(e=>{search=e.target.value;load();});main.querySelector('#vipFilters').onclick=e=>{const b=e.target.closest('[data-f]');if(!b)return;filter=b.dataset.f;main.querySelectorAll('[data-f]').forEach(x=>x.classList.toggle('active',x===b));load();};main.__liveReload=load;await load();
}
async function openVip(id,reload){
 const r=await api.registration(id);const modal=openModal({title:r.full_name,subtitle:r.person_code,body:html`<dl class="dl"><div><dt>Age</dt><dd>${r.age||'—'}</dd></div><div><dt>School</dt><dd>${r.school||'—'}</dd></div><div><dt>Invited by</dt><dd>${r.inviter||'—'}</dd></div><div><dt>Contact</dt><dd>${r.contact||'Not provided'}</dd></div><div><dt>Registered</dt><dd>${fmtDateTime(r.created_at)}</dd></div></dl><p class="small muted mt-2">The full person profile is already available for attendance and Lifegroup assignment.</p><div id="newRecovery" class="alert alert--info mt-2" hidden></div>`.value,footer:html`<a class="btn" href="#/people/${r.person_id}">Open profile</a><button class="btn" id="issueRecovery">Issue recovery code</button>${r.review_status==='new'?html`<button class="btn btn--primary" id="reviewVip">Mark reviewed</button>`:''}`.value});
 modal.querySelector('#reviewVip')?.addEventListener('click',e=>withLoading(e.currentTarget,async()=>{try{await api.reviewRegistration(id);closeModal();toast('Reviewed. The person record stays linked.');reload();}catch(err){toast(err.message,'error');}}));
 modal.querySelector('#issueRecovery').onclick=e=>withLoading(e.currentTarget,async()=>{try{const result=await api.recoverRegistration(id),box=modal.querySelector('#newRecovery');box.hidden=false;box.textContent=`Give this code privately to the VIP: ${result.recovery_code}. Any previous recovery code no longer works.`;}catch(err){toast(err.message,'error');}});
}
export async function renderQrPoster({main}){
 const qr=await api.qrRegistration();main.innerHTML=html`<div class="page-header no-print"><div><h1>VIP registration QR</h1><p class="sub">Visitors register on LIFEGEN; new records appear here immediately.</p></div><button class="btn" data-action="print">${icon('print')} Print</button></div><div class="qr-poster"><p class="qr-poster__kicker">LIFEGEN</p><h1>Welcome home.</h1><h2>Register as our VIP</h2><div class="qr-poster__code">${raw(qr.svg)}</div><p>Scan, register, and connect with the LIFEGEN family.</p><p class="qr-poster__url">${qr.url}</p><p class="qr-poster__foot">Sundays · 1:00–3:00 PM · Lifegiver Church of Faith — Central</p></div>`;
}
