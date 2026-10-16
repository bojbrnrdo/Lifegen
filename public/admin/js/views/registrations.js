import {createAddNewModal} from './unifiedAddNew.js';
import { api } from '../api.js';
import { state, can } from '../app.js';
import { html, raw, icon, fmtDate, fmtDateTime, toast, withLoading, openModal, closeModal, debounce, statusBadge, confirmDialog, esc } from '../ui.js';
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
/** One VIP row of the Gift Tracker card: progress towards the gift, and the
 *  record/undo action once the gift has been handed out in person. */
function giftRow(r,target){
 const n=Math.min(Number(r.sundays_attended)||0,target),pct=Math.round((n/target)*100),ready=!r.gift_given&&n>=target;
 const meta=r.gift_given?`Recorded ${fmtDate(r.gift_given_at)}${r.gift_given_by?' by '+r.gift_given_by:''}`:`${n}/${target} Sunday attendances`;
 const badge=r.gift_given?html`<span class="badge badge--member">Gift given</span>`:ready?html`<span class="badge badge--present">Gift eligible</span>`:html`<span class="badge">${target-n} to go</span>`;
 const action=r.gift_given?html`<button class="btn btn--sm" data-undo="${r.person_id}">Undo</button>`:ready?html`<button class="btn btn--primary btn--sm" data-give="${r.person_id}">Record gift</button>`:'';
 return html`<div class="gift-row"><div class="row row--between"><div><b>${r.full_name}</b><div class="small muted">${meta}${r.inviter?' · invited by '+r.inviter:''}</div></div><div class="row">${badge}${action}</div></div><div class="progress"><span style="width:${pct}%"></span></div></div>`;
}
export async function refreshPendingBadge(){
 if(!state.user||!can('registrations:manage'))return;
 try{const r=await api.registrationCounts(),badge=document.getElementById('navPendingBadge');if(badge){badge.textContent=r.pending;badge.hidden=r.pending===0;}}catch{}
}
export async function renderRegistrations({main,query}){
 let filter=query.status||'new',search=query.q||'';
 main.innerHTML=html`<div class="page-header"><div><h1>Registration</h1><p class="sub">Register People and manage VIP follow-up.</p></div><div class="page-actions"><a class="btn" href="#/qr-poster">${icon('qr')} Registration QR</a><button class="btn" id="refreshVips">${icon('refresh')} Refresh</button></div></div>
 <div class="card mb-2"><div class="card__header"><h2>Register a person</h2></div><div class="card__body"><div class="row" style="gap:8px;flex-wrap:wrap">${can('people:write')?['network','cell','member','vip'].map((mode,i)=>html`<button type="button" class="btn" data-register-mode="${mode}">${['Network Leader','Cell Leader','Member','VIP'][i]}</button>`).join(''):html`<p class="small muted">Your role can review VIP registrations, but cannot create People records.</p>`}</div><p class="small muted mt-2">VIPs without an eligible Cell assignment can be managed in Needs Cell.</p></div></div>
 ${can('lifegroups:manage')?html`<div class="card mb-2"><div class="card__body"><div class="row" style="align-items:end;gap:12px;flex-wrap:wrap">
  <label class="grow">VIP auto-assignment priority
    <select id="vipPriorityOrder" aria-label="VIP Cell assignment priority">
      <option value="day,area,category,capacity">Matching day first</option>
      <option value="area,day,category,capacity">Matching area first</option>
      <option value="category,day,area,capacity">Matching category first</option>
      <option value="capacity,day,area,category">Available capacity first</option>
    </select>
  </label><button type="button" class="btn" id="saveVipPriority">Save priority</button></div>
  <p class="small muted mt-1">Only compatible, active, available Cells are considered; ties are deterministic.</p>
 </div></div>`:''}
 <div class="sync-note mb-2"><b>VIP follow-up:</b> every signup creates a linked People record and immediately appears in the <a href="#/lifegroups?tab=needs">Lifegroup Tracker follow-up queue</a> until a group is selected. The monthly prize streak remains visible here; it does not export or move VIPs into a group.</div>
 <div class="card mb-2" id="giftCard"><div class="card__header"><h2>${icon('gift')} VIP Gift Tracker</h2><p class="small muted">Track Sunday attendance and gift eligibility.</p></div>
  <div class="card__body"><div class="kpi-row" id="giftKpis"></div><div class="stack mt-2" id="giftList"><div class="loading">Loading…</div></div></div></div>
 <div class="card mb-2"><div class="card__header"><h2>Sunday check-ins awaiting validation</h2></div><div class="card__body" id="pendingChecks">Loading…</div></div>
 <div class="toolbar"><div class="filter-tabs" id="vipFilters"><button data-f="new" class="${filter==='new'?'active':''}">New</button><button data-f="reviewed" class="${filter==='reviewed'?'active':''}">Reviewed</button><button data-f="all" class="${filter==='all'?'active':''}">All</button></div><div class="gsearch grow">${icon('search')}<input id="vipSearch" type="search" value="${search}" placeholder="Search VIP, inviter or contact" aria-label="Search registrations"/></div></div><div class="card" id="vipList"></div>`;
 main.querySelectorAll('[data-register-mode]').forEach(button=>button.addEventListener('click',()=>createAddNewModal({initialTab:button.dataset.registerMode,onSaved:()=>load()})));
 const priority=main.querySelector('#vipPriorityOrder');
 if(priority){
   api.vipAssignmentPolicy().then(result=>{const order=result.priority_order?.join(',');if([...priority.options].some(o=>o.value===order))priority.value=order;})
     .catch(e=>toast('Could not load VIP assignment priorities: '+e.message,'error'));
   main.querySelector('#saveVipPriority').onclick=async event=>{
     const confirmed=await confirmDialog({title:'Update VIP matching priorities?',
       message:'New VIPs will be matched using the selected criteria first. Existing Cell assignments will not be changed.',
       confirmText:'Save priority'});
     if(!confirmed)return;
     await withLoading(event.currentTarget,async()=>{
       try{await api.saveVipAssignmentPolicy(priority.value.split(','));toast('VIP matching priorities saved.');}
       catch(e){toast(e.message,'error');}
     });
   };
 }

 async function load(){
  loadGiftTracker();
  const box=main.querySelector('#pendingChecks'),list=main.querySelector('#vipList');if(!box||!list)return;
  const [data,pending]=await Promise.all([api.registrations({status:filter,q:search}),api.pendingCheckins()]);
  if(!main.contains(box)||!main.contains(list))return;box.innerHTML=pending.length?html`<div class="stack">${pending.map(c=>html`<div class="row row--between"><div><a href="#/people/${c.person_id}"><b>${c.full_name}</b></a><div class="small muted">${c.date_key} · ${c.person_code}</div></div><div class="row">${can('attendance:write')?html`<button class="btn btn--primary btn--sm" data-check="${c.id}" data-valid="true">Validate</button><button class="btn btn--sm" data-check="${c.id}" data-valid="false">Decline</button>`:''}</div></div>`)}</div>`:'<p class="small muted">No pending check-ins.</p>';
  box.querySelectorAll('[data-check]').forEach(b=>b.onclick=e=>withLoading(b,async()=>{try{await api.validateCheckin(Number(b.dataset.check),b.dataset.valid==='true');toast('Check-in updated.');load();}catch(err){toast(err.message,'error');}}));
  list.innerHTML=data.items.length?html`<div class="table-wrap"><table class="table table--stack"><thead><tr><th>VIP / Person</th><th>Age</th><th>School</th><th>Inviter</th><th>This month</th><th>Registered</th><th></th></tr></thead><tbody>${data.items.map(r=>html`<tr><td data-label="VIP"><a href="#/people/${r.person_id}"><b>${r.full_name}</b></a><div class="small muted">${r.person_code} · ${r.review_status==='new'?'New':'Reviewed'}</div></td><td data-label="Age">${r.age??'—'}</td><td data-label="School">${r.school||'—'}</td><td data-label="Inviter">${r.inviter||'—'}</td><td data-label="This month">${attendeeCell(r)}</td><td data-label="Registered" class="small">${fmtDateTime(r.created_at)}</td><td><button class="btn btn--sm" data-view="${r.id}">View</button></td></tr>`)}</tbody></table></div><div class="card__footer small muted">${data.items.length} registrations shown</div>`:'<div class="empty"><h3>No registrations here yet</h3><p>New VIP signups appear automatically. No CSV import or manual refresh is needed.</p></div>';
  list.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>openVip(Number(b.dataset.view),load));refreshPendingBadge();
 }
 // ---- VIP Gift Tracker -----------------------------------------------------
 // The count of Sunday attendances per VIP, and the record of the gift handed
 // out in person. One gift per VIP; a recording can be undone.
 async function loadGiftTracker(){
  const kpis=main.querySelector('#giftKpis'),box=main.querySelector('#giftList');if(!kpis||!box)return;
  let data;try{data=await api.giftTracker();}catch(err){box.innerHTML=html`<p class="small muted">${err.message}</p>`;return;}
  if(!main.contains(box)||!main.contains(kpis))return;
  const target=data.target||4,counts=data.counts||{};
  kpis.innerHTML=html`<div class="kpi"><b>${counts.active_vips??0}</b><span>Active VIPs</span></div><div class="kpi ${counts.gift_eligible?'kpi--green':''}"><b>${counts.gift_eligible??0}</b><span>Gift eligible</span></div>`;
  box.innerHTML=data.items.length?html`<div class="stack">${data.items.map(r=>giftRow(r,target))}</div>`:html`<p class="small muted">No VIP registrations yet.</p>`;
  box.querySelectorAll('[data-give]').forEach(b=>b.onclick=async()=>{
   const r=data.items.find(i=>i.person_id===b.dataset.give);
   const ok=await confirmDialog({title:'Record this gift?',message:`Mark <b>${esc(r?.full_name||'this VIP')}</b> as already given the gift? One gift per VIP.`,confirmText:'Record gift'});
   if(!ok)return;
   await withLoading(b,async()=>{try{await api.markGiftGiven(Number(b.dataset.give));toast('Gift recorded.');await load();}catch(err){toast(err.message,'error');}});
  });
  box.querySelectorAll('[data-undo]').forEach(b=>b.onclick=async()=>{
   const r=data.items.find(i=>i.person_id===b.dataset.undo);
   const ok=await confirmDialog({title:'Undo this recording?',message:`Remove the gift record for <b>${esc(r?.full_name||'this VIP')}</b>?`,confirmText:'Undo',danger:true});
   if(!ok)return;
   await withLoading(b,async()=>{try{await api.undoGiftGiven(Number(b.dataset.undo));toast('Recording removed.');await load();}catch(err){toast(err.message,'error');}});
  });
 }
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
