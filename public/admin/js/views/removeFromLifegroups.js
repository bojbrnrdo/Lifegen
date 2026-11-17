import { api } from '../api.js';
import { icon, openModal, closeModal, withLoading, toast, confirmDialog } from '../ui.js';

// Talk about people and Cells, not record types.
const labels={network:'A whole Network',cell:'A Cell Leader and their Cell',member:'One person'};
const modes=Object.keys(labels);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameOf=p=>p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||p.name||'Member';

/**
 * One guarded removal entry point for Lifegroups: Network → Cell Leader → Member.
 * Only associations and active tree placement are ended. No People record,
 * meeting or attendance history is physically deleted.
 */
export function openRemoveFromLifegroups({
  initialTab='network',networkId=null,groupId=null,personId=null,onRemoved=()=>{},initialError=null,
}={}) {
  if(!modes.includes(initialTab))initialTab='network';
  const svg=(name,size=17)=>icon(name,size).value;
  const tabs=modes.map((mode,i)=>
    '<button role="tab" type="button" data-remove-tab="'+mode+'" id="remove-tab-'+mode+'" '+
    'aria-selected="'+(mode===initialTab)+'" aria-controls="remove-panel-'+mode+'" '+
    'tabindex="'+(mode===initialTab?0:-1)+'">'+svg(['group','user','people'][i],18)+' '+labels[mode]+'</button>'
  ).join('');
  const panel=mode=>{
    const network='<label class="lf-remove__field">Which Network?<select data-select="network" required><option value="">Choose a Network</option></select></label>';
    const cell='<label class="lf-remove__field">Which Cell?<select data-select="cell" required disabled><option value="">Choose a Cell Leader</option></select></label>';
    const member='<label class="lf-remove__field">Which person?<select data-select="member" required disabled><option value="">Choose a person</option></select></label>';
    const fields=mode==='network'?network:mode==='cell'?network+cell:network+cell+member;
    return '<section id="remove-panel-'+mode+'" role="tabpanel" aria-labelledby="remove-tab-'+mode+'" '+
      (mode===initialTab?'':'hidden')+'>'+
      '<form data-remove-form="'+mode+'" novalidate><div class="lf-remove__fields">'+fields+'</div>'+
      '<div class="lf-remove__impact" data-impact role="status"></div>'+
      '<div class="alert alert--error" data-error role="alert" hidden></div>'+
      '<button class="btn lf-remove__submit" type="submit">'+svg('trash',16)+' Remove '+(mode==='network'?'this Network':mode==='cell'?'this Cell':'this person')+'</button>'+
      '</form></section>';
  };
  const modal=openModal({title:'Remove someone from Lifegroups',wide:true,
    body:'<div class="lf-remove"><div class="lf-remove__tabs" role="tablist" aria-label="Choose what to remove">'+
      tabs+'</div>'+modes.map(panel).join('')+
      '<p class="lf-remove__footer-note">'+svg('check',15)+' People profiles and attendance records are preserved.</p></div>',
    footer:'<button class="btn" type="button" data-close>Cancel</button>',
  });
  modal.querySelector('[data-close]').onclick=closeModal;
  const state={nets:[],groups:[],memberSeq:0,busy:false};
  const form=mode=>modal.querySelector('[data-remove-form="'+mode+'"]');
  const sel=(mode,key)=>form(mode).querySelector('[data-select="'+key+'"]');
  const net=id=>Number(id)===0?{id:0,name:'Unassigned Cells',leader_name:'Unassigned Cells',leader_person_id:null}:state.nets.find(n=>Number(n.id)===Number(id));
  const cell=id=>state.groups.find(g=>Number(g.id)===Number(id));
  const error=(mode,msg)=>{
    const element=form(mode).querySelector('[data-error]');
    element.textContent=msg;element.hidden=false;
  };
  const clear=mode=>{form(mode).querySelector('[data-error]').hidden=true;};
  const assignOptions=(select,entries,placeholder,chosen)=>{
    select.replaceChildren(new Option(placeholder,''));
    for(const entry of entries)select.add(new Option(entry.name,String(entry.id)));
    if([...select.options].some(o=>o.value===String(chosen)))select.value=String(chosen);
    select.disabled=entries.length===0;
  };
  function details(mode){
    clear(mode);
    const impact=form(mode).querySelector('[data-impact]');
    const selection=sel(mode,'network').value;
    const network=selection===''?null:net(Number(selection));
    const selectedCell=mode==='network'?null:cell(Number(sel(mode,'cell').value));
    const selectedMember=mode==='member'?
      [...sel(mode,'member').options].find(o=>o.value===sel(mode,'member').value):null;
    if(mode==='network'&&network){
      impact.innerHTML='<strong>'+escapeHTML(network.leader_name||network.name)+'</strong>'+
        '<p>Takes this Network and its Cells off the list. Nobody stays linked to it, but every person, every past meeting and all history is kept.</p>'+
        '<small>'+Number(network.group_count||0)+' Cells · '+Number(network.people_count||0)+' people</small>';
    }else if(mode==='cell'&&selectedCell){
      impact.innerHTML='<strong>'+escapeHTML(selectedCell.leader_name||selectedCell.name)+'</strong>'+
        '<p>Takes this Cell and its Cell Leader off the list. The people in it become “not in a Cell yet”. Their profiles and past meetings are kept.</p>'+
        '<small>'+Number(selectedCell.member_count||0)+' people in this Cell</small>';
    }else if(mode==='member'&&selectedCell&&selectedMember?.value){
      impact.innerHTML='<strong>'+escapeHTML(selectedMember.textContent)+'</strong>'+
        '<p>Only takes this person out of the Cell. Their profile, attendance and past Cell history are kept.</p>';
    }else{
      impact.innerHTML='<p>Choose '+(mode==='network'?'a Network':mode==='cell'?'a Network, then a Cell':'a Network, then a Cell, then a person')+' to continue.</p>';
    }
  }
  function chooseTab(mode){
    if(state.busy||!modes.includes(mode))return;
    modes.forEach(m=>{
      const active=m===mode,tab=modal.querySelector('#remove-tab-'+m);
      tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
      modal.querySelector('#remove-panel-'+m).hidden=!active;
    });
  }
  modal.querySelectorAll('[data-remove-tab]').forEach(button=>{
    button.onclick=()=>chooseTab(button.dataset.removeTab);
    button.onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const i=modes.indexOf(button.dataset.removeTab);
      const j=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;
      chooseTab(modes[j]);modal.querySelector('#remove-tab-'+modes[j]).focus();
    };
  });
  const cellsFor=network=>state.groups.filter(g=>g.is_active && network &&
    (network.id===0?g.network_id==null:Number(g.network_id)===Number(network.id)) &&
    g.leader_person_id &&
    Number(g.leader_person_id)!==Number(network.leader_person_id));
  function loadCells(mode,requestedGroup=0){
    const selection=sel(mode,'network').value;
    const network=selection===''?null:net(Number(selection));
    const chosen=Number(requestedGroup)||Number(sel(mode,'cell').value);
    assignOptions(sel(mode,'cell'),network?cellsFor(network).map(g=>({
      id:g.id,name:(g.leader_name||g.name)+' · '+Number(g.member_count||0)+' Members',
    })):[],'Choose Cell Leader',chosen);
    if(mode==='member')loadMembers(Number(personId)||0);
    details(mode);
  }
  async function loadMembers(requestedPerson=0){
    const id=Number(sel('member','cell').value),select=sel('member','member'),seq=++state.memberSeq;
    assignOptions(select,[],'Choose Member','');
    if(!id){details('member');return;}
    select.replaceChildren(new Option('Loading Members…',''));select.disabled=true;
    try{
      const g=await api.lifegroup(id);
      if(seq!==state.memberSeq||!modal.isConnected||id!==Number(sel('member','cell').value))return;
      const people=(g.members||[]).filter(p=>!p.left_at&&Number(p.id)!==Number(g.leader_person_id));
      assignOptions(select,people.map(p=>({id:p.id,name:nameOf(p)})),
        'Choose Member',requestedPerson);
      details('member');
    }catch(ex){if(seq===state.memberSeq)error('member',ex.message||'Unable to load Members.');}
  }
  for(const mode of modes){
    sel(mode,'network').onchange=()=>{
      if(mode!=='network')loadCells(mode);
      else details(mode);
    };
    if(mode!=='network')sel(mode,'cell').onchange=()=>{
      if(mode==='member')loadMembers();
      else details(mode);
    };
    if(mode==='member')sel(mode,'member').onchange=()=>details('member');
    form(mode).onsubmit=e=>{e.preventDefault();submit(mode);};
  }
  async function submit(mode){
    if(state.busy)return;
    clear(mode);
    const selection=sel(mode,'network').value;
    const network=selection===''?null:net(Number(selection));
    const group=mode==='network'?null:cell(Number(sel(mode,'cell').value));
    const member=mode==='member'?Number(sel(mode,'member').value):0;
    if(!network)return error(mode,'Choose a Network first.');
    if(mode!=='network'&&(!group||!cellsFor(network).some(g=>g.id===group.id)))
      return error(mode,'Choose a Cell Leader in that Network.');
    if(mode==='member'&&(!Number.isSafeInteger(member)||member<1||
       ![...sel('member','member').options].some(o=>Number(o.value)===member)))
      return error(mode,'Choose a person in that Cell.');
    const target=mode==='network'?(network.leader_name||network.name):
      mode==='cell'?(group.leader_name||group.name):
      sel('member','member').selectedOptions[0].textContent;
    const message=mode==='network'?
      'This takes <strong>'+escapeHTML(target)+'</strong> and every Cell and person under it off the list. Nothing is deleted: profiles, meetings and history all stay in People and Attendance.':
      mode==='cell'?'This takes <strong>'+escapeHTML(target)+'</strong> and their Cell off the list. The people in it become “not in a Cell yet”, but their profiles, meetings and history stay.':
      'This takes <strong>'+escapeHTML(target)+'</strong> out of their Cell. Their profile and history stay.';
    const confirmed=await confirmDialog({
      title:'Remove '+(mode==='network'?'this Network':mode==='cell'?'this Cell':'this person')+'?',message,confirmText:'Remove',danger:true,
      confirmWord:mode==='network'?'REMOVE':undefined,
    });
    // confirmDialog has its own modal and closes this selector first.
    // Restore the selections on cancel or failure rather than silently
    // losing the user's context or showing an error in a detached dialog.
    const restore=(message=null)=>openRemoveFromLifegroups({
      initialTab:mode,networkId:network.id,groupId:group?.id||null,
      personId:member||null,onRemoved,initialError:message,
    });
    if(!confirmed){restore();return;}
    state.busy=true;
    const button=form(mode).querySelector('[type=submit]');
    try{
      await withLoading(button,async()=>{
        if(mode==='network')await api.removeNetworkFromTree(network.id);
        else if(mode==='cell')await api.removeCellLeaderFromTree(group.id);
        else await api.removeMemberFromTree(group.id,member);
        closeModal();
        toast(labels[mode]+' removed from Lifegroups. History is kept.','info');
        onRemoved({mode,networkId:network.id,groupId:group?.id||null,personId:member||null});
      });
    }catch(ex){restore(ex.message||'Removal failed. Please try again.');}
    finally{state.busy=false;}
  }
  (async()=>{
    try{
      const [nets,groups]=await Promise.all([api.networks({status:'active'}),api.lifegroups({status:'active'})]);
      if(!modal.isConnected)return;
      state.nets=nets||[];state.groups=groups||[];
      for(const mode of modes){
        const options=state.nets.map(n=>({
          id:n.id,name:(n.leader_name||n.name)+' · '+(n.gender==='boys'?'♂':'♀'),
        }));
        if(mode!=='network')options.push({id:0,name:'Unassigned Cells (no Network yet)'});
        const preset=networkId==null&&mode!=='network'&&
          state.groups.some(g=>Number(g.id)===Number(groupId)&&g.network_id==null)?0:networkId;
        assignOptions(sel(mode,'network'),options,'Choose Network',preset);
      }
      loadCells('cell',groupId);
      loadCells('member',groupId);
      modes.forEach(details);
      if(initialError)error(initialTab,initialError);
    }catch(ex){for(const mode of modes)error(mode,ex.message||'Could not load Lifegroups.');}
  })();
  return modal;
}
