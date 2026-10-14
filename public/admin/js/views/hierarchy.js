/** OSINT-style tree: only network leaders initially visible; click to reveal descendants. */
import { api } from '../api.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const personName = p => p.full_name || [p.first_name,p.last_name].filter(Boolean).join(' ') || 'Unnamed';
const shorten = (s,len=30) => String(s||'').length>len ? String(s).slice(0,len-1)+'…' : String(s||'');
const CSS = [
'.lg-tree-toolbar{display:grid;grid-template-columns:minmax(260px,1fr) minmax(155px,190px) minmax(135px,160px) auto;gap:10px;align-items:center;margin-bottom:16px}',
'.lg-tree-toolbar .gsearch{min-width:0}.lg-tree-toolbar select{width:100%;min-width:0;height:42px;border-radius:9px;background:#fff;border:1px solid #dbe5dd}.lg-tree-toolbar #treeRefresh{height:42px;border-radius:9px}',
'@media(max-width:1000px){.lg-tree-toolbar{grid-template-columns:minmax(200px,1fr) 1fr 1fr}.lg-tree-toolbar .gsearch{grid-column:1/-1}}',
'@media(max-width:560px){.lg-tree-toolbar{grid-template-columns:1fr 1fr}.lg-tree-toolbar #treeRefresh{grid-column:1/-1}}',

 ".lfg{position:relative;isolation:isolate;background:linear-gradient(155deg,#fff 0%,#fafcf9 67%,#f0f7f0 100%);color:#173a2a;border:1px solid #d6e3d8;border-radius:16px;overflow:hidden;box-shadow:0 5px 20px rgba(19,71,44,.045)}",
 ".lfg *{box-sizing:border-box}.lfg__heading{position:absolute;left:22px;top:18px;z-index:2;pointer-events:none;display:grid;gap:5px}",
 ".lfg__heading b{display:block;font-size:14px;color:#173f2e;font-weight:750;letter-spacing:-.015em}.lfg__heading small{font-size:12px;color:#708677}",
 ".lfg__buttons{position:absolute;top:15px;right:16px;z-index:3;display:flex;align-items:center;gap:6px}",
 ".lfg__buttons button{background:#fff;color:#315643;border:1px solid #d5e3d9;border-radius:9px;min-width:34px;min-height:34px;padding:7px 11px;font-weight:650;font-size:12px;box-shadow:0 1px 3px #183c2110;cursor:pointer;transition:background .15s,border-color .15s}",
 ".lfg__buttons button:hover,.lfg__buttons button:focus-visible{background:#eaf4ec;border-color:#75a58a;outline:2px solid transparent}.lfg__buttons button:focus-visible{outline:2px solid #3b8a62;outline-offset:2px}",
 ".lfg__svg{display:block;width:100%;height:min(72vh,690px);min-height:450px;touch-action:none;cursor:grab;background-image:radial-gradient(#d4e4d9 .8px,transparent .8px);background-size:22px 22px}",
 ".lfg__svg.panning{cursor:grabbing}.lfg__edge{stroke:#96bc9f;stroke-width:1.8;opacity:.92;fill:none}",
 ".lfg__node{cursor:pointer;outline:none}.lfg__node circle{fill:#f0faf3;stroke:#2b8054;stroke-width:2.4}",
 ".lfg__node[data-kind=\"group\"] circle{stroke:#609784;fill:#eef7f2}",
 ".lfg__node[data-kind=\"member\"] circle{stroke:#d2a95e;fill:#fff6e5}",
 ".lfg__node:hover circle,.lfg__node:focus-visible circle{stroke:#125b36;stroke-width:3.5;filter:drop-shadow(0 0 5px #2e8c5b40)}",
 ".lfg__node text{font:600 13px system-ui,sans-serif;fill:#203d2d;paint-order:stroke;stroke:#fbfdf9;stroke-width:3.5px;stroke-linejoin:round}",
 ".lfg__node .sub{font-weight:400;font-size:11px;fill:#708577}.lfg__node .symbol{font-size:11px;font-weight:700;stroke:none;fill:#2e8054}",
 ".lfg__panel{position:absolute;bottom:20px;left:18px;max-width:310px;padding:15px 17px;border-radius:12px;background:#fff;border:1px solid #d6e4da;box-shadow:0 12px 32px #183b2418}",
 ".lfg__panel strong{display:block;font-size:14px;color:#244430}.lfg__panel p{font-size:12px;color:#6c8575;margin:5px 0 10px}.lfg__panel a{font-size:12px;color:#216b42;text-decoration:underline;font-weight:600}",
 ".lfg__hint{position:absolute;bottom:12px;right:16px;color:#84988a;font-size:11px;pointer-events:none}",
 ".lfg__blank{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);min-width:min(340px,80%);max-width:470px;padding:25px;text-align:center;background:#ffffffec;border:1px dashed #bdd6c3;border-radius:16px;box-shadow:0 7px 24px #17462b0d}",
 ".lfg__blank b{display:block;font-size:17px;color:#204c33;margin-bottom:7px}.lfg__blank p{font-size:13px;color:#71867a;line-height:1.6;margin:0}",
 "@media(max-width:700px){.lfg__heading{top:61px;left:14px}.lfg__buttons{left:12px;right:auto;top:12px}.lfg__svg{height:65vh;min-height:440px}.lfg__hint{font-size:10px}.lfg__panel{bottom:38px;left:12px}}",
 "@media(prefers-reduced-motion:reduce){.lfg__buttons button{transition:none}}"
].join('\n');
function ensureCSS(){
 if(document.getElementById('lifegen-node-graph-style'))return;
 const style=document.createElement('style');style.id='lifegen-node-graph-style';
 style.textContent=CSS;document.head.append(style);
}
function build(networks,groups,filters,expanded,members,loading){
 const query=String(filters.q||'').trim().toLowerCase(), gender=filters.gender||'', status=filters.status||'active';
 const allowed=o=>status==='all'||(status==='inactive'?o.is_active===false||o.is_active===0:o.is_active!==false&&o.is_active!==0);
 const match=o=>[o.name,o.leader_name].some(s=>String(s||'').toLowerCase().includes(query));
 const roots=[],linked=new Set();
 function cell(g){
  const key='group:'+g.id,listed=members.get(key)||[];
  return {key,kind:'group',name:g.leader_name||'Cell leader not assigned',subtitle:g.name||'Lifegroup',record:g,count:Number(g.member_count)||listed.length,
    children:expanded.has(key)&&!loading.has(key)?listed.map(p=>({key:'person:'+p.id,kind:'member',name:personName(p),subtitle:(p.role||p.status||'Member').replaceAll('_',' '),record:p,count:0,children:[]})):[]};
 }
 for(const network of networks){
  if((gender&&network.gender!==gender)||!allowed(network))continue;
  const all=groups.filter(g=>String(g.network_id)===String(network.id)&&!g.is_leader_group);
  all.forEach(g=>linked.add(String(g.id)));
  const selected=all.filter(allowed);
  const visible=!query||match(network)?selected:selected.filter(match);
  if(query&&!match(network)&&!visible.length)continue;
  const key='network:'+network.id;
  roots.push({key,kind:'network',name:network.leader_name||'Network leader not assigned',subtitle:network.name||'Network',record:network,count:visible.length,
    children:expanded.has(key)||!!query?visible.map(cell):[]});
 }
 const orphan=groups.filter(g=>!g.is_leader_group&&!linked.has(String(g.id))&&(!gender||g.gender===gender)&&allowed(g)&&(!query||match(g)));
 if(orphan.length){
  const key='network:unassigned';
  roots.push({key,kind:'network',name:'Unassigned Lifegroups',subtitle:'No network leader',record:null,count:orphan.length,
    children:expanded.has(key)||!!query?orphan.map(cell):[]});
 }
 return roots;
}
function arrange(roots){
 let row=0;const all=[],lines=[];
 function walk(node,depth,parent){
  node.x=100+depth*265;
  for(const child of node.children)walk(child,depth+1,node);
  node.y=node.children.length?(node.children[0].y+node.children[node.children.length-1].y)/2:70+(row++*46);
  all.push(node);
  if(parent)lines.push([parent,node]);
 }
 for(const root of roots)walk(root,0,null);
 return {nodes:all,lines,height:Math.max(320,140+row*46),width:Math.max(420,...all.map(n=>n.x+240))};
}
export async function renderHierarchy(target,networks,groups,filters={}){
 ensureCSS();
 const old=target.__lifegenTree||{};
 const expanded=old.expanded||new Set(),members=old.members||new Map(),loading=old.loading||new Set();
 const state={expanded,members,loading,selected:old.selected||null};
 target.__lifegenTree=state;
 target.innerHTML='<section class="lfg"><div class="lfg__heading"><b>LIFEGEN · Discipleship Network</b><small>Click a network leader to explore its Lifegroups</small></div><div class="lfg__buttons"><button type="button" data-action="fit" aria-label="Fit diagram">Fit view</button><button type="button" data-action="collapse" aria-label="Collapse all branches">Reset</button><button type="button" data-action="plus" aria-label="Zoom in">+</button><button type="button" data-action="minus" aria-label="Zoom out">−</button></div><svg class="lfg__svg" aria-label="Expandable discipleship network diagram"><g class="scene"><g class="edges"></g><g class="nodes"></g></g></svg><div class="lfg__panel" hidden></div><div class="lfg__blank" hidden></div><span class="lfg__hint">Drag to pan · Scroll to zoom · Click nodes to expand</span></section>';
 const svg=target.querySelector('svg'),scene=svg.querySelector('.scene'),edgeLayer=svg.querySelector('.edges'),nodeLayer=svg.querySelector('.nodes'),panel=target.querySelector('.lfg__panel'),blank=target.querySelector('.lfg__blank');
 let k=1,panX=20,panY=20,drag=null,layout={nodes:[],lines:[],height:450,width:500},first=true;
 const updateTransform=()=>scene.setAttribute('transform','translate('+panX+','+panY+') scale('+k+')');
 function fit(){
  const width=svg.clientWidth||900,height=svg.clientHeight||550;
  k=Math.max(.22,Math.min(1.25,(width-60)/layout.width,(height-65)/layout.height));
  panX=(width-layout.width*k)/2;
  panY=(height-layout.height*k)/2;
  updateTransform();
 }
 function details(node){
  state.selected=node.key;
  const link=node.kind==='network'&&node.record?'#/networks/'+encodeURIComponent(node.record.id):
   node.kind==='group'?'#/lifegroups/'+encodeURIComponent(node.record.id):
   node.kind==='member'?'#/people/'+encodeURIComponent(node.record.id):'';
  panel.hidden=false;
  panel.innerHTML='<strong>'+esc(node.name)+'</strong><p>'+esc(node.subtitle)+(node.count?' · '+node.count+' connections':'')+'</p>'+
   (link?'<a href="'+link+'">Open details →</a>':'');
 }
 function draw(shouldFit=false){
  layout=arrange(build(networks,groups,filters,expanded,members,loading));
  edgeLayer.innerHTML=layout.lines.map(pair=>{
   const p=pair[0],c=pair[1],x=(p.x+c.x)/2;
   return '<path class="lfg__edge" d="M'+(p.x+7)+' '+p.y+' C'+x+' '+p.y+' '+x+' '+c.y+' '+(c.x-7)+' '+c.y+'"/>';
  }).join('');
  nodeLayer.innerHTML=layout.nodes.map(n=>{
   const isOpen=expanded.has(n.key),canExpand=n.kind!=='member'&&n.count>0;
   return '<g class="lfg__node" data-key="'+esc(n.key)+'" data-kind="'+n.kind+'" role="button" tabindex="0" aria-label="'+esc(n.name)+'" transform="translate('+n.x+','+n.y+')">'+
    '<circle r="7.2"/>'+(canExpand?'<text class="symbol" text-anchor="middle" y="3">'+(isOpen?'−':'+')+'</text>':'')+
    '<text x="15" y="-5">'+esc(shorten(n.name))+'</text><text class="sub" x="15" y="11">'+esc(shorten(n.subtitle,36))+'</text></g>';
  }).join('');
  if(state.selected){const found=layout.nodes.find(n=>n.key===state.selected);if(found)details(found);else panel.hidden=true;}
  if(!layout.nodes.length){panel.hidden=true;blank.hidden=false;blank.innerHTML='<b>No network leaders to display</b><p>There are no matching networks for the current filters. Check All networks, change Active to All, or create a Network using the button above.</p>';}else{blank.hidden=true;}
  if(first||shouldFit){fit();first=false;}else updateTransform();
  for(const el of nodeLayer.querySelectorAll('[data-key]')){
   const activateNode=()=>{const node=layout.nodes.find(n=>n.key===el.dataset.key);if(node)activate(node);};
   el.addEventListener('click',activateNode);
   el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activateNode();}});
  }
 }
 async function activate(node){
  details(node);
  if(node.kind==='member'){draw();return;}
  if(expanded.has(node.key)){expanded.delete(node.key);draw(true);return;}
  expanded.add(node.key);
  if(node.kind==='group'&&!members.has(node.key)&&!loading.has(node.key)){
   loading.add(node.key);draw();
   try{
    const response=await api.lifegroup(node.record.id);
    if(target.__lifegenTree!==state||!target.isConnected)return;
    members.set(node.key,(response.members||[]).filter(p=>!p.left_at));
   }catch(error){
    if(target.__lifegenTree!==state||!target.isConnected)return;
    expanded.delete(node.key);
    panel.hidden=false;panel.innerHTML='<strong>Unable to load members</strong><p>'+esc(error.message||'Please try again.')+'</p>';
   }finally{loading.delete(node.key);}
  }
  if(target.__lifegenTree===state&&target.isConnected)draw(true);
 }
 target.querySelector('[data-action="fit"]').onclick=fit;
 target.querySelector('[data-action="collapse"]').onclick=()=>{expanded.clear();state.selected=null;panel.hidden=true;draw(true);};
 const zoom=amount=>{k=Math.max(.2,Math.min(3,k*amount));updateTransform();};
 target.querySelector('[data-action="plus"]').onclick=()=>zoom(1.25);
 target.querySelector('[data-action="minus"]').onclick=()=>zoom(.8);
 svg.addEventListener('wheel',e=>{
  e.preventDefault();
  const rect=svg.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
  const next=Math.max(.2,Math.min(3,k*(e.deltaY<0?1.13:.88)));
  panX=x-(x-panX)*next/k;panY=y-(y-panY)*next/k;k=next;updateTransform();
 },{passive:false});
 svg.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('[data-key]'))return;
  drag={x:e.clientX,y:e.clientY,px:panX,py:panY};svg.setPointerCapture(e.pointerId);svg.classList.add('panning');
 });
 svg.addEventListener('pointermove',e=>{if(drag){panX=drag.px+e.clientX-drag.x;panY=drag.py+e.clientY-drag.y;updateTransform();}});
 const stop=()=>{drag=null;svg.classList.remove('panning');};
 svg.addEventListener('pointerup',stop);svg.addEventListener('pointercancel',stop);
 draw(true);
}
