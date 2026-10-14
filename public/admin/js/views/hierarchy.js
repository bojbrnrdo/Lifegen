/** Three-level vertical hierarchy: Network Leader → Cell Leader → Member. */
import { api } from '../api.js';
// Browser-independent SVG glyphs keep the hierarchy pure/testable.
const GLYPHS={
 facebook:'<path d="M15 21v-8h3l.5-4H15V7c0-1 .4-1.5 1.6-1.5H19V2h-3.6C11.8 2 11 4.5 11 7v2H8v4h3v8"/>',
 instagram:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
 tiktok:'<path d="M13 3v12a4 4 0 1 1-4-4h1M13 3c1.2 3.2 3.2 5 6.5 5.5"/>',
 xsocial:'<path d="m4 3 16 18M20 3 4 21M4 3h4l12 18h-4"/>',
 youtube:'<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/>',
};
const socialIcon=(glyph,size=16)=>'<svg aria-hidden="true" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">'+(GLYPHS[glyph]||'')+'</svg>';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const personName = p => p.full_name || [p.first_name,p.last_name].filter(Boolean).join(' ') || 'Unnamed';
const shorten = (s,len=30) => String(s||'').length>len ? String(s).slice(0,len-1)+'…' : String(s||'');
const SOCIAL = [
 ['facebook','Facebook','facebook_url',['facebook.com','fb.com']],
 ['instagram','Instagram','instagram_url',['instagram.com']],
 ['tiktok','TikTok','tiktok_url',['tiktok.com']],
 ['xsocial','X','x_url',['x.com','twitter.com']],
 ['youtube','YouTube','youtube_url',['youtube.com','youtu.be']],
];
export function safeSocialLink(value,domains) {
 try {
  const u=new URL(String(value||''));
  const host=u.hostname.toLowerCase().replace(/^www\./,'');
  if(u.protocol!=='https:'||u.username||u.password||u.href.length>500)return null;
  return domains.some(domain=>host===domain||host.endsWith('.'+domain))?u.href:null;
 } catch {return null;}
}
export function nodePhoto(node) {
 const photo=node?.kind==='member'?node?.record?.photo:node?.record?.leader_photo;
 return typeof photo==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)&&photo.length<=400000?photo:null;
}
function linksForNode(node) {
 const isMember=node.kind==='member';
 return SOCIAL.map(([glyph,label,key,hosts])=>{
  const url=safeSocialLink(node.record?.[(isMember?'':'leader_')+key],hosts);
  return url?{glyph,label,url}:null;
 }).filter(Boolean);
}
function profileAvatar(node) {
 const key=String(node.key).replace(/[^a-zA-Z0-9_-]/g,'_');
 const photo=nodePhoto(node);
 const image=photo?'<defs><clipPath id="lg-avatar-'+key+'"><circle r="21"/></clipPath></defs>'+
  '<image x="-21" y="-21" width="42" height="42" preserveAspectRatio="xMidYMid slice" href="'+esc(photo)+'" clip-path="url(#lg-avatar-'+key+')"/>':
  '<path class="lfg__avatar-fallback" d="M-8 8c1-9 15-9 16 0M-6-8a6 6 0 1 0 12 0a6 6 0 1 0-12 0" fill="none" stroke="#36724f" stroke-width="2.6" stroke-linecap="round"/>';
 return '<circle class="lfg__avatar-background" r="23"/>'+image+
  '<circle class="lfg__avatar-ring" r="23" fill="none"/>';
}

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
,
'.lfg__node .touch-hit{fill:transparent!important;stroke:none!important;pointer-events:all}',
'.lfg__node text{cursor:pointer}',
'.lfg__node[aria-expanded="true"] circle:not(.touch-hit){fill:#dbf1e2;stroke:#187447}',
'.lfg__node:focus-visible{outline:none}',
'.lfg__node:focus-visible circle:not(.touch-hit){stroke:#165f3b;stroke-width:3.5}',
'.lfg__nodes-live{position:absolute;left:15px;bottom:10px;font-size:11px;color:#718876;pointer-events:none;max-width:60%}',
'@media(max-width:700px){.lfg__nodes-live{max-width:90%;left:12px;bottom:10px}.lfg__hint{display:none}.lfg__svg{height:67vh;min-height:500px}}',
'.lfg__node .name-label{font-size:13px;font-weight:700;letter-spacing:-.01em}',
'.lfg__node .sub{font-size:11px}',
'.lfg__node .symbol{font-size:11px}',
'.lfg__edge{stroke-linecap:round}',
'.lfg__node .lfg__avatar-background{fill:#e3f1e9;stroke:none}',
'.lfg__node .lfg__avatar-ring{fill:none;stroke:#378760;stroke-width:2.2}',
'.lfg__node[data-kind="group"] .lfg__avatar-ring{stroke:#6b9889}',
'.lfg__node[data-kind="member"] .lfg__avatar-ring{stroke:#b59e66}',
'.lfg__node .lfg__avatar-fallback{pointer-events:none}',
'.lfg__node:hover .lfg__avatar-ring,.lfg__node:focus-visible .lfg__avatar-ring{stroke:#155f3f;stroke-width:3.5}',
'.lfg__socials{display:flex;flex-wrap:wrap;gap:7px;margin:9px 0 12px}',
'.lfg__socials a{display:inline-flex!important;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #d8e9dc;border-radius:9px;text-decoration:none!important;background:#f6faf6;color:#256747}',
'.lfg__socials a:hover,.lfg__socials a:focus-visible{background:#e7f4ea;border-color:#66a481}',
'@media(max-width:700px){.lfg__node .name-label{font-size:13.5px}}'
].join('\n');
function ensureCSS(){
 if(document.getElementById('lifegen-node-graph-style'))return;
 const style=document.createElement('style');style.id='lifegen-node-graph-style';
 style.textContent=CSS;document.head.append(style);
}
/** Cell teams with no valid Network assignment cannot be displayed under a Network Leader. */
export function findUnassignedGroups(networks,groups,filters={}){
 const ids=new Set(networks.map(n=>String(n.id)));
 const status=filters.status||'active';
 return groups.filter(g=>
  (!filters.gender||g.gender===filters.gender) &&
  (status==='all'||(status==='inactive'?(g.is_active===false||g.is_active===0):(g.is_active!==false&&g.is_active!==0))) &&
  (g.network_id==null||!ids.has(String(g.network_id)))
 );
}
export function buildLifegroupTree(networks,groups,filters,expanded,members,loading){
 const query=String(filters.q||'').trim().toLowerCase(), gender=filters.gender||'', status=filters.status||'active';
 const allowed=o=>status==='all'||(status==='inactive'?o.is_active===false||o.is_active===0:o.is_active!==false&&o.is_active!==0);
 const match=o=>[o.name,o.leader_name].some(s=>String(s||'').toLowerCase().includes(query));
 const roots=[],linked=new Set();
 function cell(g){
  const key='group:'+g.id,listed=members.get(key)||[];
  return {key,kind:'group',name:g.leader_name||'Cell leader not assigned',subtitle:'Cell Leader',record:g,count:Number(g.member_count)||listed.length,
    children:expanded.has(key)&&!loading.has(key)?listed.map(p=>({key:'person:'+p.id,kind:'member',name:personName(p),subtitle:(p.role==='assistant'?'Assistant leader':p.role==='leader'?'Leader':p.status||'Member').replaceAll('_',' '),record:p,count:0,children:[]})):[]};
 }
 for(const network of networks){
  if((gender&&network.gender!==gender)||!allowed(network))continue;
  const all=groups.filter(g=>String(g.network_id)===String(network.id)&&!g.is_leader_group);
  all.forEach(g=>linked.add(String(g.id)));
  const selected=all.filter(g=>allowed(g)&&!(network.leader_person_id&&g.leader_person_id&&String(g.leader_person_id)===String(network.leader_person_id)));
  const visible=!query||match(network)?selected:selected.filter(match);
  if(query&&!match(network)&&!visible.length)continue;
  const key='network:'+network.id;
  roots.push({key,kind:'network',name:network.leader_name||'Network leader not assigned',subtitle:'Network Leader',record:network,count:visible.length,
    children:expanded.has(key)||!!query?visible.map(cell):[]});
 }

 return roots;
}
export function arrangeLifegroupTree(roots){
 // Center a parent above the complete width of its visible descendant branches.
 // Every new depth goes DOWN; siblings spread from left to right.
 const columnGap=235,levelGap=200,margin=210,top=118;
 const all=[],lines=[];
 let leaf=0,maxDepth=0;
 function walk(node,depth,parent){
  node.parentKey=parent?.key||null;
  node.y=top+depth*levelGap;
  maxDepth=Math.max(maxDepth,depth);
  if(node.children.length){
   for(const child of node.children)walk(child,depth+1,node);
   node.x=(node.children[0].x+node.children[node.children.length-1].x)/2;
  }else{
   node.x=margin+leaf*columnGap;
   leaf++;
  }
  all.push(node);
  if(parent)lines.push([parent,node]);
 }
 for(const root of roots)walk(root,0,null);
 return {
  nodes:all,lines,
  width:Math.max(420,margin*2+Math.max(0,leaf-1)*columnGap),
  height:Math.max(345,top+maxDepth*levelGap+112),
 };
}
/** Smooth cubic ease-out for OSINT-style branch transitions. */
export function hierarchyEasing(progress) {
 const t=Math.max(0,Math.min(1,Number(progress)||0));
 return 1-(1-t)*(1-t)*(1-t);
}
/** Curved connection between leader and child nodes. */
export function hierarchyCurve(parent,child) {
 // Route each connector from beneath the parent label to above its child's circle.
 const x1=parent.x,y1=parent.y+75,x2=child.x,y2=child.y-29;
 const bend=(y1+y2)/2;
 return 'M'+x1+' '+y1+' C'+x1+' '+bend+' '+x2+' '+bend+' '+x2+' '+y2;
}
export async function renderHierarchy(target,networks,groups,filters={}){
 ensureCSS();
 const old=target.__lifegenTree||{};
 old.cleanup?.();
 const expanded=old.expanded||new Set(),members=old.members||new Map(),loading=old.loading||new Set();
 const state={expanded,members,loading,selected:old.selected||null,cleanup:()=>{}};
 target.__lifegenTree=state;
 target.innerHTML='<section class="lfg"><div class="lfg__heading"><b>LIFEGEN · Discipleship Network</b><small>Network Leader → Cell Leader → Member</small></div><div class="lfg__buttons"><button type="button" data-action="fit" aria-label="Fit diagram">Fit view</button><button type="button" data-action="collapse" aria-label="Collapse all branches">Reset</button><button type="button" data-action="plus" aria-label="Zoom in">+</button><button type="button" data-action="minus" aria-label="Zoom out">−</button></div><svg class="lfg__svg" aria-label="Expandable discipleship network diagram"><g class="scene"><g class="edges"></g><g class="nodes"></g></g></svg><div class="lfg__panel" hidden></div><div class="lfg__blank" hidden></div><span class="lfg__hint">Drag to pan · Scroll to zoom · Click nodes to expand</span></section>';
 const svg=target.querySelector('svg'),scene=svg.querySelector('.scene'),edgeLayer=svg.querySelector('.edges'),nodeLayer=svg.querySelector('.nodes'),panel=target.querySelector('.lfg__panel'),blank=target.querySelector('.lfg__blank');
 let k=1,panX=20,panY=20,drag=null,layout={nodes:[],lines:[],height:450,width:500},first=true;
 let previousPositions=new Map(),previousEdges=new Set(),previousNodeSpecs=new Map(),previousPairSpecs=new Map(),animationFrame=0,cameraFrame=0;
 let observer=null;
 const reducedMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 const updateTransform=()=>scene.setAttribute('transform','translate('+panX+','+panY+') scale('+k+')');
 function fit(fitAll=false){
  const width=svg.clientWidth||900,height=svg.clientHeight||550;
  if(fitAll){
   k=Math.max(.23,Math.min(1.13,(width-65)/layout.width,(height-78)/layout.height));
   panX=(width-layout.width*k)/2;
   panY=(height-layout.height*k)/2;
  }else{
   const root=layout.nodes.find(n=>n.kind==='network')||layout.nodes[0];
   k=width<700?.82:width<1024?1:1.08;
   panX=width/2-(root?.x||0)*k;
   panY=(width<700?170:192)-(root?.y||0)*k;
  }
  updateTransform();
 }
 function details(node){
  state.selected=node.key;
  const link=node.kind==='network'&&node.record?'#/networks/'+encodeURIComponent(node.record.id):
   node.kind==='group'?'#/lifegroups/'+encodeURIComponent(node.record.id):
   node.kind==='member'?'#/people/'+encodeURIComponent(node.record.id):'';
  panel.hidden=false;
  const socials=linksForNode(node);
  panel.innerHTML='<strong>'+esc(node.name)+'</strong><p>'+esc(node.subtitle)+(node.count?' · '+node.count+' connections':'')+'</p>'+
   (socials.length?'<nav class="lfg__socials" aria-label="Social media profiles">'+socials.map(item=>
     '<a href="'+esc(item.url)+'" aria-label="'+esc(item.label)+'" title="'+esc(item.label)+'" target="_blank" rel="noopener noreferrer">'+socialIcon(item.glyph,17)+'</a>').join('')+'</nav>':'')+
   (node.kind==='network'&&node.count===0?'<p>No Cell Leaders yet. Use Add Cell Leader to connect one.</p>':'')+(link?'<a href="'+link+'">Open details →</a>':'');
 }
 function focusNode(key){
  const n=layout.nodes.find(node=>node.key===key);
  if(!n)return;
  if(cameraFrame)cancelAnimationFrame(cameraFrame);
  const width=svg.clientWidth||900,height=svg.clientHeight||550,mobile=width<700;
  const targetK=mobile?.82:Math.max(.9,Math.min(k,1.12));
  // Put the selected leader near the top CENTER, with room for children below.
  const goalX=width/2-n.x*targetK;
  const goalY=(mobile?170:195)-n.y*targetK;
  if(reducedMotion){k=targetK;panX=goalX;panY=goalY;updateTransform();return;}
  const old={k,panX,panY},started=performance.now();
  function frame(now){
   if(!svg.isConnected)return;
   const t=hierarchyEasing((now-started)/470);
   k=old.k+(targetK-old.k)*t;panX=old.panX+(goalX-old.panX)*t;panY=old.panY+(goalY-old.panY)*t;
   updateTransform();
   if(t<1)cameraFrame=requestAnimationFrame(frame);else cameraFrame=0;
  }
  cameraFrame=requestAnimationFrame(frame);
 }
 function draw(shouldFit=false,focusKey=null){
  if(animationFrame){cancelAnimationFrame(animationFrame);animationFrame=0;}
  const oldPos=new Map(previousPositions);
  const oldEdges=new Set(previousEdges);
  const oldNodeSpecs=new Map(previousNodeSpecs);
  layout=arrangeLifegroupTree(buildLifegroupTree(networks,groups,filters,expanded,members,loading));
  const parents=new Map(layout.lines.map(([parent,child])=>[child.key,parent]));
  const edgePairs=layout.lines.map(([parent,child])=>({parent:parent.key,child:child.key,key:parent.key+'>'+child.key}));
  const newEdges=new Set(edgePairs.map(edge=>edge.key));
  const activeKeys=new Set(layout.nodes.map(n=>n.key));
  const exitingNodes=[...oldNodeSpecs.values()].filter(n=>!activeKeys.has(n.key));
  const exitingEdges=[...previousPairSpecs.values()].filter(edge=>!newEdges.has(edge.key));
  const allEdges=edgePairs.concat(exitingEdges);
  const allNodes=layout.nodes.concat(exitingNodes);
  edgeLayer.innerHTML=allEdges.map(edge=>'<path class="lfg__edge" data-edge="'+esc(edge.key)+'"'+(newEdges.has(edge.key)?'':' data-exit="true"')+'/>').join('');
  nodeLayer.innerHTML=allNodes.map(n=>{
   const opened=expanded.has(n.key),canExpand=n.kind!=='member'&&n.count>0;
   const action=n.kind==='member'?'Open profile':opened?'Collapse branch':'Expand branch';
   return '<g class="lfg__node" data-key="'+esc(n.key)+'" data-kind="'+esc(n.kind)+'" role="button" tabindex="0" aria-label="'+esc(action+': '+n.name)+'"'+
    (n.kind==='member'?'':' aria-expanded="'+(opened?'true':'false')+'"')+'>'+
    '<circle class="touch-hit" r="37"/>'+profileAvatar(n)+
    (canExpand?'<text class="symbol" text-anchor="middle" x="31" y="5">'+(opened?'−':'+')+'</text>':'')+
    '<text class="name-label" text-anchor="middle" x="0" y="49">'+esc(shorten(n.name,25))+'</text>'+
    '<text class="sub" text-anchor="middle" x="0" y="67">'+esc(shorten(n.subtitle,29))+'</text></g>';
  }).join('');
  const elements=new Map([...nodeLayer.querySelectorAll('[data-key]')].map(el=>[el.dataset.key,el]));
  const paths=new Map([...edgeLayer.querySelectorAll('[data-edge]')].map(el=>[el.dataset.edge,el]));
  for(const [key,el] of elements)if(!activeKeys.has(key)){el.setAttribute('data-exit','true');el.setAttribute('aria-hidden','true');el.setAttribute('pointer-events','none');}
  const origins=new Map();
  for(const n of layout.nodes){
   let origin=oldPos.get(n.key);
   if(!origin){
    const parent=parents.get(n.key);
    origin=parent&&(oldPos.get(parent.key)||{x:parent.x,y:parent.y});
   }
   origins.set(n.key,origin||{x:n.x,y:n.y});
  }
  function paint(progress){
   const ease=hierarchyEasing(progress);
   const current=new Map();
   for(const n of layout.nodes){
    const from=origins.get(n.key),exists=oldPos.has(n.key);
    const p={x:from.x+(n.x-from.x)*ease,y:from.y+(n.y-from.y)*ease};
    current.set(n.key,p);
    const el=elements.get(n.key);
    el.setAttribute('transform','translate('+p.x+','+p.y+')');
    el.setAttribute('opacity',String(exists?1:ease));
   }
   for(const n of exitingNodes){
    const from=oldPos.get(n.key)||{x:n.x,y:n.y};
    const anchor=layout.nodes.find(node=>node.key===n.parentKey)||oldNodeSpecs.get(n.parentKey)||n;
    const p={x:from.x+(anchor.x-from.x)*ease,y:from.y+(anchor.y-from.y)*ease};
    current.set(n.key,p);
    const el=elements.get(n.key);
    el.setAttribute('transform','translate('+p.x+','+p.y+')');
    el.setAttribute('opacity',String(1-ease));
   }
   for(const edge of allEdges){
    const from=current.get(edge.parent),to=current.get(edge.child);
    const isNew=!oldEdges.has(edge.key);
    const path=paths.get(edge.key);
    path.setAttribute('d',hierarchyCurve(from,to));
    // Reveal the whole curved line progressively, rather than snapping it in.
    if(newEdges.has(edge.key)&&isNew){
     const length=path.getTotalLength();
     path.style.strokeDasharray=String(length);
     path.style.strokeDashoffset=String(length*(1-ease));
     path.style.opacity=String(ease);
    }else{
     path.style.strokeDasharray='none';
     path.style.strokeDashoffset='0';
     path.style.opacity=newEdges.has(edge.key)?'1':String(1-ease);
    }
   }
   previousPositions=current;
  }
  if(state.selected){const found=layout.nodes.find(n=>n.key===state.selected);if(found)details(found);else panel.hidden=true;}
  if(!layout.nodes.length){panel.hidden=true;blank.hidden=false;blank.innerHTML='<b>No Network Leaders to display</b><p>Check the filters or create a Network above. Unassigned Cell Leaders are listed separately for assignment.</p>';}else blank.hidden=true;
  if(first||shouldFit){fit();first=false;}
  const animate=oldPos.size>0&&!reducedMotion;
  if(!animate){
   paint(1);
   for(const el of nodeLayer.querySelectorAll('[data-exit="true"]'))el.remove();
   for(const el of edgeLayer.querySelectorAll('[data-exit="true"]'))el.remove();
   previousPositions=new Map([...previousPositions].filter(([key])=>activeKeys.has(key)));
  }
  else{
   paint(0);
   const start=performance.now();
   const frame=now=>{
    if(!svg.isConnected)return;
    const t=Math.min(1,(now-start)/540);
    paint(t);
    if(t<1)animationFrame=requestAnimationFrame(frame);else{
     animationFrame=0;
     for(const el of nodeLayer.querySelectorAll('[data-exit="true"]'))el.remove();
     for(const el of edgeLayer.querySelectorAll('[data-exit="true"]'))el.remove();
     previousPositions=new Map([...previousPositions].filter(([key])=>activeKeys.has(key)));
    }
   };
   animationFrame=requestAnimationFrame(frame);
  }
  previousEdges=newEdges;
  previousNodeSpecs=new Map(layout.nodes.map(n=>[n.key,n]));
  previousPairSpecs=new Map(edgePairs.map(edge=>[edge.key,edge]));
  for(const [key,el] of elements){
   if(!activeKeys.has(key))continue;
   const activateNode=()=>{const node=layout.nodes.find(n=>n.key===key);if(node)activate(node);};
   el.addEventListener('click',activateNode);
   el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activateNode();}});
  }
  if(focusKey)focusNode(focusKey);
 }
 async function activate(node){
  details(node);
  if(node.kind==='member'){draw();return;}
  if(expanded.has(node.key)){expanded.delete(node.key);draw(false,node.key);return;}
  expanded.add(node.key);
  draw(false,node.key);
  if(node.kind==='group'&&!members.has(node.key)&&!loading.has(node.key)){
   loading.add(node.key);draw(false,node.key);
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
  if(target.__lifegenTree===state&&target.isConnected)draw(false,node.key);
 }
 target.querySelector('[data-action="fit"]').onclick=()=>fit(true);
 target.querySelector('[data-action="collapse"]').onclick=()=>{
  expanded.clear();state.selected=null;panel.hidden=true;
  draw(false,layout.nodes.find(n=>n.kind==='network')?.key);
 };
 const zoom=amount=>{if(cameraFrame)cancelAnimationFrame(cameraFrame);k=Math.max(.2,Math.min(3,k*amount));updateTransform();};
 target.querySelector('[data-action="plus"]').onclick=()=>zoom(1.25);
 target.querySelector('[data-action="minus"]').onclick=()=>zoom(.8);
 svg.addEventListener('wheel',e=>{
  e.preventDefault();
  if(cameraFrame)cancelAnimationFrame(cameraFrame);
  const rect=svg.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
  const next=Math.max(.2,Math.min(3,k*(e.deltaY<0?1.13:.88)));
  panX=x-(x-panX)*next/k;panY=y-(y-panY)*next/k;k=next;updateTransform();
 },{passive:false});
 svg.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('[data-key]'))return;
  if(cameraFrame)cancelAnimationFrame(cameraFrame);
  drag={x:e.clientX,y:e.clientY,px:panX,py:panY};svg.setPointerCapture(e.pointerId);svg.classList.add('panning');
 });
 svg.addEventListener('pointermove',e=>{if(drag){panX=drag.px+e.clientX-drag.x;panY=drag.py+e.clientY-drag.y;updateTransform();}});
 const stop=()=>{drag=null;svg.classList.remove('panning');};
 svg.addEventListener('pointerup',stop);svg.addEventListener('pointercancel',stop);
 state.cleanup=()=>{
  if(animationFrame)cancelAnimationFrame(animationFrame);
  if(cameraFrame)cancelAnimationFrame(cameraFrame);
  observer?.disconnect();
 };
 draw(true);
 if(typeof ResizeObserver!=='undefined'){
  let width=svg.clientWidth;
  observer=new ResizeObserver(()=>{
   if(!svg.isConnected)return;
   const next=svg.clientWidth;
   if(Math.abs(next-width)<20)return;
   width=next;
   if(cameraFrame)cancelAnimationFrame(cameraFrame);
   fit();
  });
  observer.observe(svg);
 }
}
