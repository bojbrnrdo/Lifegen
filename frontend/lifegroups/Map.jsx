import React,{useState,useEffect,useMemo,useCallback,useRef,memo} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlow,ReactFlowProvider,Background,Controls,Handle,Position,MarkerType,useReactFlow} from '@xyflow/react';
import dagre from 'dagre';
import {Users,UserRound,Network,CalendarClock,AlertTriangle,Plus,ArrowRightLeft,CalendarDays,
 Search,X,Maximize2,Trash2} from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './map.css';

const W=190,H=202;
const profiles=new WeakMap();
function safePhoto(src){
 if(typeof src!=='string')return '';
 if(/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src)&&src.length<3e6)return src;
 if(src.startsWith('/brand/')||src.startsWith('/uploads/'))return src;
 return '';
}
function name(person){return person?.full_name||person?.leader_name||(person?.first_name&&[person.first_name,person.last_name].filter(Boolean).join(' '))||person?.name||'Unnamed';}
function stamp(when){return when?String(when).slice(0,10):'';}
function nodeAvatar({person}){
 const src=safePhoto(person.photo||person.leader_photo);
 return src?<img src={src} alt="" className="lg-r-avatar"/>:<span className="lg-r-avatar lg-r-initial">{name(person).slice(0,1).toUpperCase()}</span>;
}
const Avatar=({person})=>nodeAvatar({person});
const TreeNode=memo(({data})=>{
 const {entry,expanded,expandable,selected,activate,alert}=data;
 const label=entry.role==='network'?'Network Leader':entry.role==='cell'?'Cell Leader':'Member';
 const title=name(entry.person);
 const onKeyDown=e=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  e.preventDefault();
  e.stopPropagation();
  activate(entry);
 };
 return <div
   className={'lg-r-node lg-r-node--'+entry.role+(selected?' lg-r-selected':'')}
   data-role={entry.role}
   role="button"
   tabIndex={0}
   aria-label={title+', '+label+(expandable?', '+(expanded?'expanded':'collapsed'):'')+'. Click to view details'+(expandable?' and '+(expanded?'collapse':'expand')+' connections':'')}
   aria-expanded={expandable?expanded:undefined}
   onClick={e=>{e.stopPropagation();activate(entry)}}
   onKeyDown={onKeyDown}>
   <Handle type="target" position={Position.Top} isConnectable={false} className="lg-r-handle"/>
   <div className="lg-r-circle">
    <Avatar person={entry.person}/>
    <span className={'lg-r-status-dot '+(entry.active?'lg-r-status-dot--active':'lg-r-status-dot--inactive')} title={entry.active?'Active':'Inactive'}/>
    {expandable&&<span className="lg-r-expand-indicator" aria-hidden="true">{expanded?'−':'+'}</span>}
   </div>
   <div className="lg-r-identity"><strong title={title}>{title}</strong><span>{label}</span></div>
   <div className="lg-r-badges">
    {entry.role!=='member'&&<span><Users size={12}/>{entry.count} {entry.role==='network'?'people':'members'}</span>}
    {alert===true&&<span className="lg-r-warning" title="No submitted attendance report for this week"><AlertTriangle size={12}/> Report due</span>}
   </div>
   <Handle type="source" position={Position.Bottom} isConnectable={false} className="lg-r-handle"/>
 </div>;
});
const nodeTypes={person:TreeNode};
function buildRows(networks,groups,members,expanded,filters){
 const rows=[],edges=[];
 const add=(id,parent,role,person,active,count,groupId)=>{
  const row={id,role,person,active:!!active,count:Number(count||0),parent,groupId};
  rows.push(row);
  if(parent)edges.push({source:parent,target:id,id:parent+'--'+id,type:'smoothstep',animated:true,
    style:{stroke:'#74aa88',strokeWidth:2},markerEnd:{type:MarkerType.ArrowClosed,color:'#74aa88'}});
 };
 const q=filters.q?.toLowerCase().trim()||'';
 const netSet=networks.filter(n=>(!filters.gender||n.gender===filters.gender)&&
  (filters.status==='all'||(filters.status==='inactive'?!n.is_active:!!n.is_active)));
 const groupSet=groups.filter(g=>g.network_id!=null&&
  (filters.status==='all'||(filters.status==='inactive'?!g.is_active:!!g.is_active)));
 const matching=new Set();
 if(q)for(const n of netSet)if((name(n)+' '+n.name).toLowerCase().includes(q))matching.add('n'+n.id);
 if(q)for(const g of groupSet)if((name(g)+' '+g.name).toLowerCase().includes(q)){
  matching.add('c'+g.id);matching.add('n'+g.network_id);
 }
 for(const n of netSet){
  const nc='n'+n.id;
  const own=groupSet.filter(g=>Number(g.network_id)===Number(n.id)&&Number(g.leader_person_id)!==Number(n.leader_person_id));
  if(q&&!matching.has(nc))continue;
  add(nc,null,'network',n,n.is_active,n.people_count||own.reduce((a,g)=>a+Number(g.member_count||0),0));
  if(!expanded.has(nc)&&!q)continue;
  for(const g of own){
   const cid='c'+g.id;
   if(q&&!matching.has(cid)&&!matching.has(nc))continue;
   add(cid,nc,'cell',g,g.is_active,g.member_count,g.id);
   if(!expanded.has(cid)&&!q)continue;
   for(const m of members.get(g.id)||[])if(!m.left_at&&(!q||(name(m)+' '+m.id).toLowerCase().includes(q)||matching.has(cid))){
    add('m'+g.id+'-'+m.id,cid,'member',m,m.status!=='inactive',0,g.id);
   }
  }
 }
 return {rows,edges};
}
function getLayout(rows,edges){
 const graph=new dagre.graphlib.Graph();
 graph.setGraph({rankdir:'TB',ranksep:115,nodesep:38,marginx:40,marginy:35});
 graph.setDefaultEdgeLabel(()=>({}));
 rows.forEach(r=>graph.setNode(r.id,{width:W,height:H}));
 edges.forEach(e=>graph.setEdge(e.source,e.target));
 dagre.layout(graph);
 return rows.map(r=>{const p=graph.node(r.id);return{id:r.id,type:'person',position:{x:p.x-W/2,y:p.y-H/2},data:{entry:r}};});
}
/** Compact relationship-focused details drawer for the selected tree node.
 * Only show information that helps administrators navigate the hierarchy;
 * personal contact fields remain in the dedicated People profile.
 */
function Panel({selection,progress,onClose,onAdd,onReassign,onRemove,manage,relations,onChoose,relationsLoading}){
 if(!selection)return null;
 const {person,role,groupId,active,count}=selection;
 const label=role==='network'?'Network Leader':role==='cell'?'Cell Leader':'Member';
 const relationTitle=role==='network'?'Cell Leaders':role==='cell'?'Members':'Cell Leader';
 const emptyText=role==='network'?'No Cell Leaders assigned yet.':role==='cell'?'No Members in this Cell yet.':'No Cell Leader linked to this Member.';
 return <aside className="lg-r-panel" role="region" aria-label={name(person)+' details'}>
  <div className="lg-r-panel-head"><span>Lifegroup relationships</span><button type="button" onClick={onClose} aria-label="Close details"><X size={19}/></button></div>
  <div className="lg-r-panel-person"><Avatar person={person}/><div><strong>{name(person)}</strong><small>{label}</small></div></div>
  <div className="lg-r-panel-summary">
   <span className={'lg-r-panel-status '+(active?'is-active':'is-inactive')}><i/>{active?'Active':'Inactive'}</span>
   {role!=='member'&&<span className="lg-r-panel-count"><Users size={14}/>{count} {role==='network'?'people':'members'}</span>}
  </div>
  {role==='cell'&&progress&&<p className="lg-r-panel-attendance"><CalendarClock size={15}/>{progress.met_this_week?'Attendance submitted this week':'Weekly attendance not submitted'}</p>}
  <div className="lg-r-panel-actions">
   {manage&&role==='cell'&&<button type="button" onClick={()=>onAdd(selection)}><Plus size={15}/> Add Member</button>}
   {manage&&role!=='member'&&<button type="button" onClick={()=>onReassign(selection)}><ArrowRightLeft size={15}/> Edit / Reassign</button>}
   {groupId&&<a href={'#/lifegroups/'+groupId}><CalendarDays size={15}/> View Attendance</a>}
   {(role==='member'?person.id:person.leader_person_id)&&<a href={'#/people/'+(role==='member'?person.id:person.leader_person_id)}><UserRound size={15}/> View Full Profile</a>}
   {manage&&active&&<button className="lg-r-danger" type="button" onClick={()=>onRemove(selection)}><Trash2 size={15}/> Remove from Lifegroups</button>}
  </div>
 </aside>;
}
function Dashboard({data,callbacks}){
 const rf=useReactFlow();
 const [expanded,setExpanded]=useState(()=>new Set());
 const [members,setMembers]=useState(()=>new Map());
 const [reports,setReports]=useState(()=>new Map());
 const [selected,setSelected]=useState(null);
 const [search,setSearch]=useState('');
 const [loading,setLoading]=useState(new Set());
 const allFilters={...data.filters,q:search||data.filters.q||''};
 const toggle=useCallback(id=>setExpanded(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next}),[]);
 const addMembers=useCallback(async g=>{
  if(members.has(g.id)||loading.has(g.id))return;
  setLoading(prev=>new Set([...prev,g.id]));
  try{
   const result=await callbacks.loadMembers(g.id);
   setMembers(prev=>new Map(prev).set(g.id,(result.members||[])));
   callbacks.loadProgress(g.id).then(report=>setReports(prev=>new Map(prev).set(g.id,report))).catch(()=>{});
  }catch(e){callbacks.onError(e);}
  finally{setLoading(prev=>{const next=new Set(prev);next.delete(g.id);return next})}
 },[members,loading,callbacks]);
 useEffect(()=>{const opened=new Set([...expanded].filter(id=>id.startsWith('c')));
  for(const id of opened){const g=data.groups.find(g=>'c'+g.id===id);if(g&&!members.has(g.id))addMembers(g);}
 },[expanded,data.groups,addMembers,members]);
 const {rows,edges}=useMemo(()=>buildRows(data.networks,data.groups,members,expanded,allFilters),[data,members,expanded,search]);
 const rowsById=useMemo(()=>new Map(rows.map(r=>[r.id,r])),[rows]);
 const select=useCallback(row=>{
  setSelected(row);
  if(row.role==='cell'&&!reports.has(row.groupId))
   callbacks.loadProgress(row.groupId).then(report=>
     setReports(prev=>new Map(prev).set(row.groupId,report))).catch(()=>{});
 },[callbacks,reports]);
 const activate=useCallback(row=>{
  // A single click on the circle opens leader details AND reveals their
  // connected Cells/Members. Clicking it again collapses that branch.
  if(row.role!=='member')toggle(row.id);
  select(row);
 },[select,toggle]);
 // Relationships come from authorized LIFEGEN data, not mock nodes.
 // Network Leader panels show all connected Cell Leaders, including those
 // whose tree branches are currently collapsed.
 const relations=useMemo(()=>{
  if(!selected)return [];
  if(selected.role==='network')return data.groups
   .filter(g=>Number(g.network_id)===Number(selected.person.id)&&
    Number(g.leader_person_id)!==Number(selected.person.leader_person_id)&&
    (data.filters.status==='all'||(data.filters.status==='inactive'?!g.is_active:!!g.is_active)))
   .map(g=>({id:'c'+g.id,role:'cell',person:g,active:!!g.is_active,groupId:g.id,count:Number(g.member_count||0),parent:selected.id}));
  if(selected.role==='cell')return (members.get(selected.groupId)||[])
   .filter(m=>!m.left_at)
   .map(m=>({id:'m'+selected.groupId+'-'+m.id,role:'member',person:m,active:m.status!=='inactive',groupId:selected.groupId,count:0,parent:selected.id}));
  if(selected.role==='member'){
   const parent=data.groups.find(g=>Number(g.id)===Number(selected.groupId));
   return parent?[{id:'c'+parent.id,role:'cell',person:parent,active:!!parent.is_active,groupId:parent.id,count:Number(parent.member_count||0),parent:'n'+parent.network_id}]:[];
  }
  return [];
 },[selected,data.groups,data.filters.status,members]);
 const chooseRelation=useCallback(item=>{
  // Reveal the selected relationship in the graph without toggling it
  // closed when navigating via an avatar in the details panel.
  const networkId=item.role==='cell'?item.person.network_id:
   data.groups.find(g=>Number(g.id)===Number(item.groupId))?.network_id;
  setExpanded(prev=>{
   const next=new Set(prev);
   if(networkId!=null)next.add('n'+networkId);
   if(item.role==='member'||item.role==='cell')next.add('c'+item.groupId);
   return next;
  });
  // A detail photo click should navigate even if the current search
  // is hiding the destination node.
  setSearch('');
  select(item);
 },[data.groups,select]);
 const nodes=useMemo(()=>getLayout(rows,edges).map(n=>({
  ...n,data:{...n.data,expanded:expanded.has(n.id),expandable:n.data.entry.role!=='member',
    selected:selected?.id===n.id,activate,alert:n.data.entry.role==='cell'&&reports.has(n.data.entry.groupId)?!reports.get(n.data.entry.groupId)?.met_this_week:null}
 })),[rows,edges,expanded,selected,activate,reports]);
 const fit=useCallback(()=>requestAnimationFrame(()=>rf.fitView({padding:.18,duration:320,maxZoom:1.1})),[rf]);
 useEffect(()=>{fit()},[nodes.length,fit,data.filters.gender,data.filters.status]);
 useEffect(()=>{if(!search)return;const found=rows.find(r=>name(r.person).toLowerCase().includes(search.toLowerCase())&&r.role!=='member');if(!found)return;const n=nodes.find(n=>n.id===found.id);if(n)rf.setCenter(n.position.x+W/2,n.position.y+H/2,{zoom:.95,duration:350});},[search,rows,nodes,rf]);

 return <div className="lg-r-shell">
  <div className="lg-r-tools"><div className="lg-r-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find Network or Cell Leader" aria-label="Search Lifegroups network"/></div>
   <span className="lg-r-count">{rows.filter(r=>r.role==='network').length} networks · {rows.filter(r=>r.role==='cell').length} cells · {rows.filter(r=>r.role==='member').length} visible members</span>
   <button onClick={fit} title="Center all visible people"><Maximize2 size={16}/> Fit map</button></div>
  <div className="lg-r-main">
   <div className="lg-r-canvas">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} proOptions={{hideAttribution:true}}
     fitView minZoom={.03} maxZoom={2.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable
     onPaneClick={()=>setSelected(null)} >
     <Background color="#c9e4d2" gap={22} size={1}/>
     <Controls showInteractive={false} fitViewOptions={{padding:.18,maxZoom:1.1}}/>
    </ReactFlow>
    {rows.length===0&&<div className="lg-r-empty">No Networks match these filters.</div>}
   </div>
   <Panel selection={selected} progress={reports.get(selected?.groupId)} manage={callbacks.manage}
    relations={relations} onChoose={chooseRelation}
    relationsLoading={selected?.role==='cell'&&loading.has(selected.groupId)}
    onClose={()=>setSelected(null)} onAdd={callbacks.onAdd} onReassign={callbacks.onReassign} onRemove={callbacks.onRemove}/>
  </div>
  <p className="lg-r-caption">Click a profile circle to expand or collapse · Drag to pan · Scroll to zoom</p>
 </div>;
}
export function mount(el,data,callbacks){
 let entry=profiles.get(el);
 if(!entry){entry={root:createRoot(el)};profiles.set(el,entry)}
 entry.root.render(<ReactFlowProvider><Dashboard key={data.version||0} data={data} callbacks={callbacks}/></ReactFlowProvider>);
 return()=>{const v=profiles.get(el);if(v){v.root.unmount();profiles.delete(el)}};
}
