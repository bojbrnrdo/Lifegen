import { api, downloadBlob } from '../api.js';
import { state, can } from '../app.js';
import { html, raw, icon, fmtDate, fmtDateTime, toast, withLoading, openModal, closeModal, debounce, statusBadge } from '../ui.js';
/** Prize progress: 4 consecutive Sundays (weeks) earns the prize. The counter is a
 *  streak — it never shows above 4/4, missing a Sunday resets it, and once a VIP
 *  completes 4/4 they graduate to Regular attendee and leave the prize pool. */
function prizeState(r){
 const streak=Math.min(Number(r.streak)||0,4);
 const best=Math.min(Number(r.best_streak)||0,4);
 const graduated=r.completed||best>=4||['regular','member','leader','volunteer'].includes(r.person_status||'first_timer');
 if(graduated)return {n:4,state:'graduate'};
 if(streak>=1)return {n:streak,state:'building'};
 return {n:0,state:'idle'};
}
function attendeeCell(r){
 const p=prizeState(r);
 if(p.state==='graduate')return html`<span class="badge badge--present">Regular attendee</span><div class="small muted">${r.completed||Number(r.best_streak)>=4?'Completed 4/4 · no longer eligible for the prize':'No longer eligible for the prize'}</div>`;
 if(p.state==='building')return html`<span class="badge badge--regular">${p.n}/4</span><div class="small muted">${p.n===1?'1st week':p.n+' weeks'} in a row · ${4-p.n} more for the prize</div>`;
 return html`<span class="badge badge--na">0/4</span><div class="small muted">No streak yet — attend this Sunday to start</div>`;
}
export async function refreshPendingBadge(){
 if(!state.user||!can('registrations:manage'))return;
 try{const r=await api.registrationCounts(),badge=document.getElementById('navPendingBadge');if(badge){badge.textContent=r.pending;badge.hidden=r.pending===0;}}catch{}
}
export async function renderRegistrations({main,query}){
 let filter=query.status||'new',search=query.q||'';
 main.innerHTML=html`<div class="page-header"><div><h1>VIP registrations</h1><p class="sub">From the LIFEGEN website, directly into the shared database.</p></div><div class="page-actions"><a class="btn" href="#/qr-poster">${icon('qr')} Registration QR</a><button class="btn" id="exportCsv">${icon('download')} Export CSV</button><button class="btn" id="refreshVips">${icon('refresh')} Refresh</button></div></div>
 <div class="sync-note mb-2"><b>Already connected.</b> Every VIP signup creates a First Timer in <a href="#/people">People</a>. <i>This month</i> shows each VIP's streak of consecutive Sundays — 4 weeks in a row earns the prize. No specific Sunday is required; missing a week restarts the streak at 0/4. Completing 4/4 promotes the VIP to <b>Regular attendee</b>, and they are no longer eligible for the prize. When a VIP's <b>4-week window since invitation</b> closes, they are exported to the lifegroup tracker as <b>Regular Attendee</b> (4/4) or a label that fits how many window Sundays they came back.</div>
 <div class="card mb-2"><div class="card__header"><h2>Sunday check-ins awaiting validation</h2></div><div class="card__body" id="pendingChecks">Loading…</div></div>
 <div class="card mb-2"><div class="card__header"><h2>Lifegroup tracker export · 4-week outcomes</h2></div><div class="card__body" id="lgOutcomes">Loading…</div></div>
 <div class="toolbar"><div class="filter-tabs" id="vipFilters"><button data-f="new" class="${filter==='new'?'active':''}">New</button><button data-f="reviewed" class="${filter==='reviewed'?'active':''}">Reviewed</button><button data-f="all" class="${filter==='all'?'active':''}">All</button></div><div class="gsearch grow">${icon('search')}<input id="vipSearch" type="search" value="${search}" placeholder="Search VIP, inviter or contact" aria-label="Search registrations"/></div></div><div class="card" id="vipList"></div>`;
 async function load(){
  const box=main.querySelector('#pendingChecks'),list=main.querySelector('#vipList');if(!box||!list)return;
  const [data,pending,lg]=await Promise.all([api.registrations({status:filter,q:search}),api.pendingCheckins(),api.lifegroupOutcomes()]);
  if(!main.contains(box)||!main.contains(list))return;box.innerHTML=pending.length?html`<div class="stack">${pending.map(c=>html`<div class="row row--between"><div><a href="#/people/${c.person_id}"><b>${c.full_name}</b></a><div class="small muted">${c.date_key} · ${c.person_code}</div></div><div class="row">${can('attendance:write')?html`<button class="btn btn--primary btn--sm" data-check="${c.id}" data-valid="true">Validate</button><button class="btn btn--sm" data-check="${c.id}" data-valid="false">Decline</button>`:''}</div></div>`)}</div>`:'<p class="small muted">No pending check-ins.</p>';
  box.querySelectorAll('[data-check]').forEach(b=>b.onclick=e=>withLoading(b,async()=>{try{await api.validateCheckin(Number(b.dataset.check),b.dataset.valid==='true');toast('Check-in updated.');load();}catch(err){toast(err.message,'error');}}));
  list.innerHTML=data.items.length?html`<div class="table-wrap"><table class="table table--stack"><thead><tr><th>VIP / Person</th><th>Age</th><th>School</th><th>Inviter</th><th>This month</th><th>Registered</th><th></th></tr></thead><tbody>${data.items.map(r=>html`<tr><td data-label="VIP"><a href="#/people/${r.person_id}"><b>${r.full_name}</b></a><div class="small muted">${r.person_code} · ${r.review_status==='new'?'New':'Reviewed'}</div></td><td data-label="Age">${r.age??'—'}</td><td data-label="School">${r.school||'—'}</td><td data-label="Inviter">${r.inviter||'—'}</td><td data-label="This month">${attendeeCell(r)}</td><td data-label="Registered" class="small">${fmtDateTime(r.created_at)}</td><td><button class="btn btn--sm" data-view="${r.id}">View</button></td></tr>`)}</tbody></table></div><div class="card__footer small muted">${data.items.length} registrations shown</div>`:'<div class="empty"><h3>No registrations here yet</h3><p>New VIP signups appear automatically. No CSV import or manual refresh is needed.</p></div>';
  const lgBox=main.querySelector('#lgOutcomes');
 if(lgBox&&main.contains(lgBox)){
  lgBox.innerHTML=lg.items.length?html`<div class="table-wrap"><table class="table table--stack"><thead><tr><th>VIP</th><th>Invited</th><th>4-week window</th><th>Came back</th><th>Lifegroup tracker export</th></tr></thead><tbody>${lg.items.map(r=>html`<tr><td data-label="VIP"><a href="#/people/${r.person_id}"><b>${r.full_name}</b></a><div class="small muted">${r.person_code}</div></td><td data-label="Invited" class="small">${fmtDate(r.invited)}</td><td data-label="Window" class="small">${r.window.length?fmtDate(r.window[0])+' \u2192 '+fmtDate(r.window[3]):'\u2014'}</td><td data-label="Came back"><span class="small">${r.attended.map(x=>x?'\u25cf':'\u25cb').join(' ')}</span> <b>${r.count}/4</b></td><td data-label="Export">${r.exported?statusBadge(r.outcome):html`<span class="badge badge--na">In window \u00b7 ${r.count}/4 so far</span>`}</td></tr>`)}
  </tbody></table></div><div class="card__footer small muted">\u25cf = came back that window Sunday. When the window closes the person is exported to the tracker: 4/4 \u2192 Regular Attendee, otherwise 3/2/1-Time Visitor or No Returns.</div>`:'<p class="small muted">No VIP registrations yet.</p>';
 }
 list.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>openVip(Number(b.dataset.view),load));refreshPendingBadge();
 }
 main.querySelector('#exportCsv').onclick=e=>withLoading(e.currentTarget,async()=>{
  const {items}=await api.registrations({status:'all',q:''});
  if(!items.length){toast('No registrations to export.','info');return;}
  const cell=v=>{const t=v==null?'':String(v);return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
  const head=['person_code','full_name','age','school','invited_by','contact','review_status','registered_at','reviewed_at','person_status','streak_this_month','prize_status','sundays_attended_all_time'];
  const rows=items.map(r=>{const p=prizeState(r);return [r.person_code,r.full_name,r.age,r.school,r.inviter,r.contact,r.review_status,r.created_at,r.reviewed_at,r.person_status,r.streak,p.state==='graduate'?'regular_attendee':p.state==='building'?'building_streak':'no_streak',r.sundays_attended].map(cell).join(',');});
  downloadBlob(new Blob(['\ufeff'+[head.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8'}),'vip-registrations.csv');
  toast(`Exported ${items.length} VIP registration${items.length===1?'':'s'}.`);
 });
 main.querySelector('#refreshVips').onclick=load;main.querySelector('#vipSearch').oninput=debounce(e=>{search=e.target.value;load();});main.querySelector('#vipFilters').onclick=e=>{const b=e.target.closest('[data-f]');if(!b)return;filter=b.dataset.f;main.querySelectorAll('[data-f]').forEach(x=>x.classList.toggle('active',x===b));load();};main.__liveReload=load;await load();
}
async function openVip(id,reload){
 const r=await api.registration(id);const modal=openModal({title:r.full_name,subtitle:r.person_code,body:html`<dl class="dl"><div><dt>Age</dt><dd>${r.age||'—'}</dd></div><div><dt>School</dt><dd>${r.school||'—'}</dd></div><div><dt>Invited by</dt><dd>${r.inviter||'—'}</dd></div><div><dt>Contact</dt><dd>${r.contact||'Not provided'}</dd></div><div><dt>Registered</dt><dd>${fmtDateTime(r.created_at)}</dd></div></dl><p class="small muted mt-2">The full person profile is already available for attendance tracking and follow-up.</p><div id="newRecovery" class="alert alert--info mt-2" hidden></div>`.value,footer:html`<a class="btn" href="#/people/${r.person_id}">Open profile</a><button class="btn" id="issueRecovery">Issue recovery code</button>${r.review_status==='new'?html`<button class="btn btn--primary" id="reviewVip">Mark reviewed</button>`:''}`.value});
 modal.querySelector('#reviewVip')?.addEventListener('click',e=>withLoading(e.currentTarget,async()=>{try{await api.reviewRegistration(id);closeModal();toast('Reviewed. The person record stays linked.');reload();}catch(err){toast(err.message,'error');}}));
 modal.querySelector('#issueRecovery').onclick=e=>withLoading(e.currentTarget,async()=>{try{const result=await api.recoverRegistration(id),box=modal.querySelector('#newRecovery');box.hidden=false;box.textContent=`Give this code privately to the VIP: ${result.recovery_code}. Any previous recovery code no longer works.`;}catch(err){toast(err.message,'error');}});
}
export async function renderQrPoster({main}){
 const qr=await api.qrRegistration();main.innerHTML=html`<div class="page-header no-print"><div><h1>VIP registration QR</h1><p class="sub">Visitors register on LIFEGEN; new records appear here immediately.</p></div><button class="btn" data-action="print">${icon('print')} Print</button></div><div class="qr-poster"><p class="qr-poster__kicker">LIFEGEN</p><h1>Welcome home.</h1><h2>Register as our VIP</h2><div class="qr-poster__code">${raw(qr.svg)}</div><p>Scan, register, and connect with the LIFEGEN family.</p><p class="qr-poster__url">${qr.url}</p><p class="qr-poster__foot">Sundays · 1:00–3:00 PM · Lifegiver Church of Faith — Central</p></div>`;
}
