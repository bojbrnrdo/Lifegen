import React,{useState,useEffect,useMemo,useCallback,useRef,memo} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlow,ReactFlowProvider,Background,Controls,Handle,Position,MarkerType,useReactFlow} from '@xyflow/react';
import dagre from 'dagre';
import {Users,UserRound,Network,CalendarClock,AlertTriangle,Plus,ArrowRightLeft,CalendarDays,
 Search,X,ChevronDown,ChevronRight,Maximize2,Trash2,Phone,Mail,MapPin,Video,Clock} from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './map.css';

const W=246,H=128;
const profiles=new WeakMap();
function safePhoto(src){
 if(typeof src!=='string')return '';
 if(/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src)&&src.length<3e6)return src;
 if(src.startsWith('/brand/')||src.startsWith('/uploads/'))return src;
 return '';
}
function name(person){return person?.leader_name||person?.first_name&&[person.first_name,person.last_name].filter(Boolean).join(' ')||person?.name||'Unnamed';}
function stamp(when){return when?String(when).slice(0,10):'';}
function nodeAvatar({person}){
 const src=safePhoto(person.photo||person.leader_photo);
 return src?<img src={src} alt="" className="lg-r-avatar"/>:<span className="lg-r-avatar lg-r-initial">{name(person).slice(0,1).toUpperCase()}</span>;
}
const Avatar=({person})=>nodeAvatar({person});
const TreeNode=memo(({data})=>{
 const {entry,expanded,expandable,selected,toggle,alert}=data;
 const label=entry.role==='network'?'Network Leader':entry.role==='cell'?'Cell Leader':'Member';
 return <div className={'lg-r-node '+(selected?'lg-r-selected':'')} data-role={entry.role} aria-label={name(entry.person)+', '+label}>
   <Handle type="target" position={Position.Top} isConnectable={false} className="lg-r-handle"/>
   <div className="lg-r-node-head"><Avatar person={entry.person}/><div className="lg-r-identity"><strong title={name(entry.person)}>{name(entry.person)}</strong><span>{label}</span></div>
    {expandable&&<button className="lg-r-toggle nodrag nopan" type="button" aria-label={(expanded?'Collapse ':'Expand ')+name(entry.person)} aria-expanded={expanded} onClick={e=>{e.stopPropagation();toggle(entry.id)}}>{expanded?<ChevronDown size={17}/>:<ChevronRight size={17}/>}</button>}</div>
   <div className="lg-r-badges">
    {entry.role!=='member'&&<span><Users size={12}/>{entry.count} {entry.role==='network'?'people':'members'}</span>}
    <span className={entry.active?'lg-r-active':'lg-r-inactive'}><i/>{entry.active?'Active':'Inactive'}</span>
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
function Panel({selection,profile,progress,onClose,onAdd,onReassign,onRemove,manage}){
 if(!selection)return null;
 const {person,role,groupId,active}=selection;
 const details=profile?.person||profile||person;
 const phone=details.phone||details.mobile||details.contact_number;
 const email=details.email;
 const schedule=[person.schedule_day,person.schedule_time].filter(Boolean).join(' · ');
 const attendance=role==='cell'?progress:null;
 return <aside className="lg-r-panel" role="dialog" aria-label={name(person)+' details'}>
  <div className="lg-r-panel-head"><span>Profile details</span><button onClick={onClose} aria-label="Close details"><X size={19}/></button></div>
  <div className="lg-r-panel-person"><Avatar person={person}/><div><strong>{name(person)}</strong><small>{role==='network'?'Network Leader':role==='cell'?'Cell Leader':'Member'} · {active?'Active':'Inactive'}</small></div></div>
  <div className="lg-r-info">
   <p><Phone size={15}/>{phone||'Phone not recorded'}</p>
   <p><Mail size={15}/>{email||'Email not recorded'}</p>
   <p><Clock size={15}/>{schedule||'Schedule not recorded'}</p>
   <p><MapPin size={15}/>{person.venue||person.area||'Venue not recorded'}</p>
   <p><Video size={15}/>{person.meeting_type||'Meeting type not recorded'}</p>
   <p><Users size={15}/>{person.apprentice_name||'Apprentice not recorded'}</p>
   {attendance&&<p><CalendarClock size={15}/>{attendance.met_this_week?'Attendance submitted this week':'Attendance not submitted this week'}</p>}
  </div>
  <div className="lg-r-panel-actions">
   {manage&&role==='cell'&&<button onClick={()=>onAdd(selection)}><Plus size={15}/> Add Member</button>}
   {manage&&role!=='member'&&<button onClick={()=>onReassign(selection)}><ArrowRightLeft size={15}/> Edit / Reassign</button>}
   {groupId&&<a href={'#/lifegroups/'+groupId}><CalendarDays size={15}/> View Attendance</a>}
   {role==='network'&&<a href={'#/networks/'+person.id}><Network size={15}/> Open Network</a>}
   {role==='member'&&<a href={'#/people/'+person.id}><UserRound size={15}/> Open Person</a>}
   {manage&&active&&<button className="lg-r-danger" onClick={()=>onRemove(selection)}><Trash2 size={15}/> Remove from Lifegroups</button>}
  </div>
 </aside>;
}
function Dashboard({data,callbacks}){
 const rf=useReactFlow();
 const [expanded,setExpanded]=useState(()=>new Set());
 const [members,setMembers]=useState(()=>new Map());
 const [reports,setReports]=useState(()=>new Map());
 const [selected,setSelected]=useState(null),[profile,setProfile]=useState(null);
 const [search,setSearch]=useState(''),[matches,setMatches]=useState([]);
 const [loading,setLoading]=useState(new Set());
 const run=useRef(0);
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
 const nodes=useMemo(()=>getLayout(rows,edges).map(n=>({
  ...n,data:{...n.data,expanded:expanded.has(n.id),expandable:n.data.entry.role!=='member',
    selected:selected?.id===n.id,toggle,alert:n.data.entry.role==='cell'&&reports.has(n.data.entry.groupId)?!reports.get(n.data.entry.groupId)?.met_this_week:null}
 })),[rows,edges,expanded,selected,toggle,reports]);
 const fit=useCallback(()=>requestAnimationFrame(()=>rf.fitView({padding:.18,duration:320,maxZoom:1.1})),[rf]);
 useEffect(()=>{fit()},[nodes.length,fit,data.filters.gender,data.filters.status]);
 useEffect(()=>{if(!search)return;const found=rows.find(r=>name(r.person).toLowerCase().includes(search.toLowerCase())&&r.role!=='member');if(!found)return;const n=nodes.find(n=>n.id===found.id);if(n)rf.setCenter(n.position.x+W/2,n.position.y+H/2,{zoom:.95,duration:350});},[search,rows,nodes,rf]);
 const select=useCallback(async row=>{
  setSelected(row);setProfile(null);
  if(row.person.leader_person_id||row.role==='member'){
   const id=row.role==='member'?row.person.id:row.person.leader_person_id;
   if(id)callbacks.loadProfile(id).then(result=>setProfile(result)).catch(()=>{});
  }
  if(row.role==='cell'&&!reports.has(row.groupId))callbacks.loadProgress(row.groupId)
   .then(report=>setReports(prev=>new Map(prev).set(row.groupId,report))).catch(()=>{});
 },[callbacks,reports]);
 const onNodeClick=useCallback((_evt,node)=>select(node.data.entry),[select]);
 return <div className="lg-r-shell">
  <div className="lg-r-tools"><div className="lg-r-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find Network or Cell Leader" aria-label="Search Lifegroups network"/></div>
   <span className="lg-r-count">{rows.filter(r=>r.role==='network').length} networks · {rows.filter(r=>r.role==='cell').length} cells · {rows.filter(r=>r.role==='member').length} visible members</span>
   <button onClick={fit} title="Center all visible people"><Maximize2 size={16}/> Fit map</button></div>
  <div className="lg-r-main">
   <div className="lg-r-canvas">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} proOptions={{hideAttribution:true}}
     fitView minZoom={.03} maxZoom={2.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable
     onPaneClick={()=>{setSelected(null);setProfile(null)}} >
     <Background color="#c9e4d2" gap={22} size={1}/>
     <Controls showInteractive={false} fitViewOptions={{padding:.18,maxZoom:1.1}}/>
    </ReactFlow>
    {rows.length===0&&<div className="lg-r-empty">No Networks match these filters.</div>}
   </div>
   <Panel selection={selected} profile={profile} progress={reports.get(selected?.groupId)} manage={callbacks.manage}
    onClose={()=>setSelected(null)} onAdd={callbacks.onAdd} onReassign={callbacks.onReassign} onRemove={callbacks.onRemove}/>
  </div>
  <p className="lg-r-caption">Click a node for details · Use the chevron to expand · Drag to pan · Scroll to zoom</p>
 </div>;
}
export function mount(el,data,callbacks){
 let entry=profiles.get(el);
 if(!entry){entry={root:createRoot(el)};profiles.set(el,entry)}
 entry.root.render(<ReactFlowProvider><Dashboard key={data.version||0} data={data} callbacks={callbacks}/></ReactFlowProvider>);
 return()=>{const v=profiles.get(el);if(v){v.root.unmount();profiles.delete(el)}};
}
