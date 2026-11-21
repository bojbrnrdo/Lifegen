/**
 * Shared, framework-free helpers for the Lifegroups pages.
 *
 * The interactive network map (React Flow + an SVG fallback) has been removed:
 * it cost 510 KB of JavaScript, felt slow on phones and could not be panned or
 * zoomed below 780 px. The pages now use the plain-DOM directory, the
 * "Find a person" search and the Network/Cell detail pages instead.
 *
 * What is left here are the pure functions those pages rely on, so they stay
 * easy to unit-test without a DOM.
 */

const personName = (p) => p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
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
/**
 * The headline numbers at the top of the Lifegroups page.
 *
 * Kept pure so the "needs attention" count can be pinned by tests: a leader
 * opening the page should see what is wrong as a number, not have to read a
 * page to discover it. `attention` counts Networks with nobody leading them
 * plus Cells that do not sit under any Network.
 */
export function lifegroupHeadline(networks,groups,filters={}){
 const {networks:nets}=filterTrackerView(networks,groups,filters);
 // Counted straight from the Cell list, not from the Networks above them:
 //  - a Cell with no Network still holds people who meet every week, so it counts
 //  - a leader-team Cell (Network Leaders in their pastor's Cell, Cell Leaders in
 //    their Network Leader's) holds real people too — leaving those out would
 //    understate the church by everyone who leads it
 const cells=(groups||[]).filter(g=>
  (!filters.gender||g.gender===filters.gender)&&
  ((filters.status||'active')==='all'||((filters.status||'active')==='inactive'?!isActiveRecord(g):isActiveRecord(g))));
 const memberTotal=cells.reduce((total,g)=>total+Number(g.member_count||0),0);
 // A leader-team Cell is the pastor's or Network Leader's own Cell; it is not a
 // Cell Leader's Cell, so it must not inflate the "Cell Leaders" number.
 const cellLeaders=cells.filter(g=>!g.leads_network).length;
 const pastors=nets.filter(n=>n.parent_network_id==null&&nets.some(c=>String(c.parent_network_id)===String(n.id)));
 const loose=nets.filter(n=>n.parent_network_id==null&&!pastors.includes(n));
 const withoutLeader=nets.filter(n=>!n.leader_name).length;
 const unconnected=findUnassignedGroups(networks,groups,filters).length;
 return {
  pastors:pastors.length, networks:nets.length, cells:cells.length, cellLeaders,
  members:memberTotal, looseNetworks:loose.length,
  withoutLeader, unconnected, attention:withoutLeader+unconnected,
 };
}
const isActiveRecord=record=>record.is_active!==false&&record.is_active!==0;
/**
 * Networks and Cells visible for a status filter. An inactive Cell Leader can
 * be removed while their Network stays active, so the Inactive view has to keep
 * such a Network (and its matching Cells) visible; without this, a removed Cell
 * appears in no view at all. The Active and All views keep their rule that the
 * Network itself must match.
 */
export function filterTrackerView(networks,groups,filters={}){
 const gender=filters.gender||'',status=filters.status||'active';
 const inGender=record=>!gender||record.gender===gender;
 const statusOk=record=>status==='all'||(status==='inactive'?!isActiveRecord(record):isActiveRecord(record));
 const nets=(networks||[]).filter(net=>inGender(net)&&(statusOk(net)||(status==='inactive'&&
  (groups||[]).some(g=>String(g.network_id)===String(net.id)&&!g.leads_network&&!isActiveRecord(g)))));
 const ids=new Set(nets.map(n=>String(n.id)));
 const cells=(groups||[]).filter(g=>ids.has(String(g.network_id))&&!g.leads_network&&statusOk(g));
 return {networks:nets,cells};
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
  // A Network Leader may also lead a Cell in their Network; do not hide that Cell or its People.
  const selected=all.filter(allowed);
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
