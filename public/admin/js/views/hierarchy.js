/** Interactive, read-only Lifegroup hierarchy using existing network APIs. */
import { api } from '../api.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const css = `
.lg-hierarchy{display:grid;gap:22px;padding:20px;background:linear-gradient(155deg,#f4faf7,#fff);border:1px solid var(--border);border-radius:16px;min-height:240px}
.lg-hierarchy__top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.lg-hierarchy__group{border:1px solid #c9ddd6;border-radius:14px;padding:18px;background:#fff;min-width:0}
.lg-hierarchy__root{margin:0 auto;max-width:390px;padding:16px;text-align:center;background:#ecfdf5;border:2px solid #0f766e;border-radius:14px}
.lg-hierarchy__eyebrow{display:block;text-transform:uppercase;letter-spacing:.09em;font-size:10px;font-weight:750;color:#0f766e;margin-bottom:5px}
.lg-hierarchy__name{font-size:17px;font-weight:750;line-height:1.35}
.lg-hierarchy__sub{font-size:12px;color:var(--muted);margin-top:5px}
.lg-hierarchy__stem{width:2px;height:22px;background:#9fbcb2;margin:auto}
.lg-hierarchy__children{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,225px),1fr));gap:14px}
.lg-hierarchy__cell{min-width:0;border:1px solid #d9e7df;background:white;border-radius:12px;overflow:hidden}
.lg-hierarchy__cell[open]{border-color:#0f766e;box-shadow:0 4px 14px #0b3d3a12}
.lg-hierarchy__cell>summary{padding:15px;cursor:pointer;list-style:none;outline-offset:-3px}
.lg-hierarchy__cell>summary::-webkit-details-marker{display:none}
.lg-hierarchy__cell>summary:focus-visible{outline:2px solid #0f766e}
.lg-hierarchy__toggle{color:#0f766e;font-size:12px;font-weight:650;display:block;margin-top:10px}
.lg-hierarchy__members{border-top:1px solid #e4e9e6;padding:10px 12px;display:grid;gap:7px;max-height:300px;overflow:auto}
.lg-hierarchy__person{border-left:2px solid #b8d7c7;padding:6px 9px;font-size:13px;display:flex;justify-content:space-between;gap:8px;align-items:center}
.lg-hierarchy__pill{font-size:10px;color:#475569;background:#f1f5f9;border-radius:20px;padding:2px 7px;white-space:nowrap}
.lg-hierarchy__empty{padding:24px;text-align:center;color:var(--muted)}
@media(min-width:800px){.lg-hierarchy__children{position:relative}.lg-hierarchy__children:before{content:'';position:absolute;top:-8px;left:12%;right:12%;height:1px;background:#b8cfc5}}
`;
function styles(){if(document.getElementById('lg-hierarchy-css'))return;const element=document.createElement('style');element.id='lg-hierarchy-css';element.textContent=css;document.head.append(element)}
function person(m){const name=m.full_name||[m.first_name,m.last_name].filter(Boolean).join(' ')||'Unnamed';const label=String(m.status||m.role||'member').replaceAll('_',' ');return `<div class="lg-hierarchy__person"><a href="#/people/${encodeURIComponent(m.id)}">${esc(name)}</a><span class="lg-hierarchy__pill">${esc(label)}</span></div>`}
function cell(g){const members=(g.members||[]).filter(m=>!m.left_at);return `<details class="lg-hierarchy__cell"><summary><span class="lg-hierarchy__eyebrow">Cell / Lifegroup leader</span><div class="lg-hierarchy__name">${esc(g.leader_name||'Leader not assigned')}</div><div class="lg-hierarchy__sub">${esc(g.name)} · ${members.length||g.member_count||0} members</div><span class="lg-hierarchy__toggle">Show / hide members ▾</span></summary><div class="lg-hierarchy__members"><a href="#/lifegroups/${encodeURIComponent(g.id)}">Open Lifegroup →</a>${members.length?members.map(person).join(''):'<span class="lg-hierarchy__sub">No members yet</span>'}</div></details>`}
function network(n){const groups=(n.groups||[]).filter(g=>!g.is_leader_group);return `<section class="lg-hierarchy__group"><div class="lg-hierarchy__root"><span class="lg-hierarchy__eyebrow">Network leader</span><div class="lg-hierarchy__name">${esc(n.leader_name||'Leader not assigned')}</div><div class="lg-hierarchy__sub">${esc(n.name)} · ${groups.length} Lifegroups</div><a href="#/networks/${encodeURIComponent(n.id)}">View network →</a></div>${groups.length?`<div class="lg-hierarchy__stem"></div><div class="lg-hierarchy__children">${groups.map(cell).join('')}</div>`:'<p class="lg-hierarchy__empty">No cell groups assigned yet.</p>'}</section>`}
export async function renderHierarchy(target,nets,groups,{q='',gender='',status='active'}={}){
 styles();const serial=Symbol();target.__hierarchySerial=serial;
 target.innerHTML='<div class="lg-hierarchy"><div class="loading">Loading network relationships…</div></div>';
 const matching=nets.filter(n=>!gender||n.gender===gender);
 const results=await Promise.all(matching.map(n=>api.network(n.id).then(value=>({value})).catch(error=>({error}))));
 if(target.__hierarchySerial!==serial||!target.isConnected)return;
 const full=results.filter(r=>r.value).map(r=>r.value),failures=results.filter(r=>r.error).length;
 const needle=q.trim().toLowerCase();
 const filtered=full.filter(n=>!needle||[n.name,n.leader_name,...(n.groups||[]).flatMap(g=>[g.name,g.leader_name,...(g.members||[]).map(m=>m.full_name||`${m.first_name} ${m.last_name}`)])].some(v=>String(v||'').toLowerCase().includes(needle)));
 const linked=new Set(full.flatMap(n=>(n.groups||[]).map(g=>g.id)));
 const loose=groups.filter(g=>!linked.has(g.id)&&(!gender||g.gender===gender)&&(!needle||[g.name,g.leader_name].some(v=>String(v||'').toLowerCase().includes(needle))));
 target.innerHTML=`<div class="lg-hierarchy"><div class="lg-hierarchy__top"><h2>Discipleship hierarchy</h2><span class="lg-hierarchy__sub">${filtered.length} networks · ${filtered.reduce((count,n)=>count+(n.groups||[]).filter(g=>!g.is_leader_group).length,0)} Lifegroups</span></div>${failures?`<div class="alert alert--error">Could not load ${failures} network(s). Refresh to retry.</div>`:''}${filtered.map(network).join('')||'<div class="lg-hierarchy__empty">No matching networks.</div>'}${loose.length?`<section class="lg-hierarchy__group"><span class="lg-hierarchy__eyebrow">Not assigned to a network</span><div class="lg-hierarchy__children">${loose.map(cell).join('')}</div></section>`:''}</div>`;
}
