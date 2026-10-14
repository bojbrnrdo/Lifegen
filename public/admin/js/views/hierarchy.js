/** LIFEGEN collapsible discipleship tree: Network → Cell leader → Members. */
import { api } from '../api.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = v => encodeURIComponent(String(v));
const statusName = v => String(v || 'Member').replaceAll('_',' ').replace(/\b\w/g, x => x.toUpperCase());
const CSS = `
.lgt{background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:16px;padding:clamp(12px,2vw,24px);min-width:0}
.lgt *{box-sizing:border-box}.lgt__heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.lgt__heading h2{font-size:1.1rem}.lgt__tools{display:flex;gap:8px;flex-wrap:wrap}
.lgt__tools button{border:1px solid var(--border,#cbd5e1);border-radius:9px;background:var(--surface,#fff);color:var(--text,#0f172a);padding:7px 12px;cursor:pointer}
.lgt__tools button:focus-visible,.lgt summary:focus-visible{outline:2px solid #0f766e;outline-offset:3px}
.lgt__forest{display:grid;gap:18px}.lgt__network{border:1px solid #c7dfd7;border-radius:14px;padding:14px;background:linear-gradient(150deg,#f3faf6,#fff)}
.lgt__network>summary{list-style:none;cursor:pointer;display:flex;gap:12px;align-items:center}
.lgt summary::-webkit-details-marker{display:none}.lgt__twisty{width:26px;height:26px;flex:none;border-radius:8px;display:grid;place-items:center;background:#ddf1e7;color:#166347;font-weight:700;transition:transform .15s}
.lgt details[open]>summary>.lgt__twisty{transform:rotate(90deg)}.lgt__node-main{min-width:0;flex:1}
.lgt__role{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.10em;font-weight:800;color:#0f766e}
.lgt__name{display:block;font-size:15px;font-weight:750;color:var(--text,#17232a);overflow-wrap:anywhere}.lgt__meta{display:block;font-size:12px;color:var(--muted,#64748b);margin-top:4px}
.lgt__action{font-size:12px;white-space:nowrap;color:#0f766e;text-decoration:none}.lgt__action:hover{text-decoration:underline}
.lgt__branches{margin:15px 0 2px 13px;padding-left:20px;border-left:2px solid #bdd7ca;display:grid;gap:10px}
.lgt__group{position:relative;border:1px solid #e0e9e4;border-radius:11px;background:#fff;padding:12px}
.lgt__group:before{content:'';position:absolute;width:20px;height:2px;background:#bdd7ca;left:-21px;top:26px}
.lgt__group>summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none}
.lgt__group .lgt__twisty{width:22px;height:22px;font-size:12px}
.lgt__members{border-left:2px solid #d8e7dc;margin:14px 0 0 11px;padding-left:16px;display:grid;gap:7px}
.lgt__person{position:relative;padding:8px 10px;background:#f8faf9;border:1px solid #edf1ee;border-radius:9px;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.lgt__person:before{content:'';position:absolute;width:16px;height:2px;background:#d8e7dc;left:-17px;top:19px}
.lgt__person a{font-weight:600;font-size:13px}.lgt__pill{font-size:10px;background:#e4f2e8;color:#276148;border-radius:99px;padding:3px 8px}
.lgt__notice{font-size:13px;color:var(--muted,#64748b);padding:12px}.lgt__empty{background:#f8faf9;border:1px dashed #d4e3dc;padding:22px;border-radius:12px;text-align:center;color:#64748b}
.lgt__network[hidden],.lgt__group[hidden]{display:none}
@media(max-width:650px){.lgt__network{padding:11px}.lgt__branches{margin-left:9px;padding-left:13px}.lgt__group:before{width:13px;left:-14px}.lgt__action{white-space:normal}.lgt__network>summary{flex-wrap:wrap}}
`;
function attachCss(){
 if(document.getElementById('lifegen-tree-style'))return;
 const e=document.createElement('style');e.id='lifegen-tree-style';e.textContent=CSS;document.head.append(e);
}
function personNode(m){
 const name=m.full_name || [m.first_name,m.last_name].filter(Boolean).join(' ') || 'Unnamed person';
 const role=m.role === 'assistant'?'Assistant leader':m.role === 'leader'?'Cell leader':statusName(m.status);
 return `<div class="lgt__person"><a href="#/people/${key(m.id)}">${esc(name)}</a><span class="lgt__pill">${esc(role)}</span></div>`;
}
function groupNode(g){
 const active=g.is_active === false || g.is_active === 0 ? ' · Inactive' : '';
 return `<details class="lgt__group" data-group="${esc(g.id)}"><summary><span class="lgt__twisty" aria-hidden="true">›</span><span class="lgt__node-main"><span class="lgt__role">Cell / Lifegroup leader</span><span class="lgt__name">${esc(g.leader_name || 'Leader not assigned')}</span><span class="lgt__meta">${esc(g.name)} · ${Number(g.member_count)||0} members${active}</span></span><a class="lgt__action" href="#/lifegroups/${key(g.id)}">Manage →</a></summary><div class="lgt__members" aria-live="polite"><div class="lgt__notice">Expand to see members</div></div></details>`;
}
function netNode(n,groups){
 const active=n.is_active === false || n.is_active === 0 ? ' · Inactive' : '';
 return `<details class="lgt__network" data-network="${esc(n.id)}"><summary><span class="lgt__twisty" aria-hidden="true">›</span><span class="lgt__node-main"><span class="lgt__role">Network leader</span><span class="lgt__name">${esc(n.leader_name || 'Leader not assigned')}</span><span class="lgt__meta">${esc(n.name)} · ${groups.length} Lifegroups · ${Number(n.people_count)||0} people${active}</span></span><a class="lgt__action" href="#/networks/${key(n.id)}">Manage →</a></summary><div class="lgt__branches">${groups.length?groups.map(groupNode).join(''):'<div class="lgt__notice">No cell groups assigned to this network.</div>'}</div></details>`;
}
/** Render a fully collapsible read-only tree; mutations remain on existing authorized edit screens. */
export async function renderHierarchy(target,networks,groups,{q='',gender='',status='active'}={}){
 attachCss();
 const needle=String(q).trim().toLowerCase();
 const matchGroup=g=>[g.name,g.leader_name].some(v=>String(v||'').toLowerCase().includes(needle));
 const filteredNetworks=networks.filter(n=>(!gender||n.gender===gender)&&(status!=='inactive'||n.is_active===false||n.is_active===0));
 const linked=new Set();
 const matched=[];
 for(const n of filteredNetworks){
  const children=groups.filter(g=>String(g.network_id)===String(n.id)&&!g.is_leader_group&&(status!=='active'||g.is_active!==false&&g.is_active!==0));
  children.forEach(g=>linked.add(String(g.id)));
  const netMatch=[n.name,n.leader_name].some(v=>String(v||'').toLowerCase().includes(needle));
  if(!needle||netMatch||children.some(matchGroup))matched.push({n,children:needle&&!netMatch?children.filter(matchGroup):children});
 }
 const orphan=groups.filter(g=>!g.is_leader_group&&!linked.has(String(g.id))&&(!gender||g.gender===gender)&&(status!=='active'||g.is_active!==false&&g.is_active!==0)&&(!needle||matchGroup(g)));
 const count=matched.reduce((t,r)=>t+r.children.length,0)+orphan.length;
 target.innerHTML=`<div class="lgt"><div class="lgt__heading"><div><h2>Discipleship tree</h2><span class="lgt__meta">${matched.length} networks · ${count} Lifegroups · Select a branch to explore</span></div><div class="lgt__tools"><button type="button" data-tree-action="expand">Expand networks</button><button type="button" data-tree-action="collapse">Collapse all</button></div></div><div class="lgt__forest">${matched.map(x=>netNode(x.n,x.children)).join('')}${orphan.length?netNode({id:'unassigned',name:'Unassigned Lifegroups',leader_name:'No network leader'},orphan):''}${!matched.length&&!orphan.length?'<div class="lgt__empty">No matching networks or Lifegroups found.</div>':''}</div></div>`;
 // Prevent Manage links from also toggling a summary.
 target.querySelectorAll('summary a').forEach(a=>a.addEventListener('click',e=>e.stopPropagation()));
 target.querySelector('[data-tree-action="expand"]')?.addEventListener('click',()=>target.querySelectorAll('.lgt__network').forEach(d=>d.open=true));
 target.querySelector('[data-tree-action="collapse"]')?.addEventListener('click',()=>target.querySelectorAll('.lgt details').forEach(d=>d.open=false));
 target.querySelectorAll('.lgt__group').forEach(d=>d.addEventListener('toggle',async()=>{
  if(!d.open||d.dataset.loaded==='yes'||d.dataset.loaded==='loading')return;
  d.dataset.loaded='loading';
  const box=d.querySelector('.lgt__members');
  box.innerHTML='<div class="lgt__notice">Loading members…</div>';
  try{
   const detail=await api.lifegroup(Number(d.dataset.group));
   if(!d.isConnected)return;
   const members=(detail.members||[]).filter(m=>!m.left_at);
   box.innerHTML=members.length?members.map(personNode).join(''):'<div class="lgt__notice">No members in this Lifegroup yet.</div>';
   d.dataset.loaded='yes';
  }catch(error){
   if(d.isConnected)box.innerHTML='<div class="lgt__notice">Could not load members. Collapse and expand to retry.</div>';
   delete d.dataset.loaded;
  }
 }));
}
