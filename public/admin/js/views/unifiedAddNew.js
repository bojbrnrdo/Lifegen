import {api} from '../api.js';
import {icon,openModal,closeModal,withLoading,toast} from '../ui.js';
import {fileToDataUrl,duplicateGuard} from './personForm.js';

const modes=['network','cell','member','vip'];
const sexOf={boys:'male',girls:'female'};
const headingOf={network:'Network Leader',cell:'Cell Leader',member:'Member',vip:'VIP'};
const svg=(key,size=18)=>icon(key,size).value;

function panel(mode,initial){
 const label=headingOf[mode];
 const gender=(mode==='network'||mode==='vip'||mode==='member')?'<fieldset class="unified-add__gender"><legend>Gender</legend><label><input type="radio" name="network_gender" value="boys" aria-label="Male">'+svg('mars',20)+'</label><label><input type="radio" name="network_gender" value="girls" aria-label="Female">'+svg('venus',20)+'</label></fieldset>':'';
 const network=mode==='network'||mode==='vip'?'':'<label class="unified-add__field">Network<select data-field="network" required><option value="">Choose Network</option></select></label>';
 const cell=mode==='member'?'<label class="unified-add__field">Cell Leader<select data-field="cell" required disabled><option value="">Choose Cell Leader</option></select></label>':'';
 const existingPerson='<label class="unified-add__field">Existing Person ID (optional)<input name="existing_person_id" type="number" min="1" placeholder="Reuse an existing profile"/><small>Find the Person ID in Lifegroups → All People. Leave blank to register someone new.</small></label>';
 const vipDetails=mode==='vip'?'<div class="unified-add__names"><label class="unified-add__field">Age<input name="age" type="number" min="1" max="120" required /></label><label class="unified-add__field">School / Institution<input name="school" maxlength="300" required /></label><label class="unified-add__field">Invited by<input name="inviter" maxlength="200" required /></label><label class="unified-add__field">Contact (optional)<input name="contact_number" type="tel" maxlength="40" /></label></div>':'';
 const social=['facebook_url','instagram_url','tiktok_url','x_url','youtube_url'].map(k=>'<label>'+k.replace('_url','').replace('_',' ')+'<input type="url" name="'+k+'" placeholder="HTTPS profile link"/></label>').join('');
 return '<section role="tabpanel" id="unified-'+mode+'" aria-labelledby="tab-'+mode+'" '+(mode===initial?'':'hidden')+'><form data-form="'+mode+'" novalidate>'+
 '<div class="alert alert--error" data-error role="alert" hidden></div>'+gender+network+cell+
 existingPerson+
 '<div class="unified-add__identity"><label class="unified-add__photo"><span data-photo-preview class="unified-add__photo-preview">'+svg('user',28)+'</span><span class="unified-add__photo-action">'+svg('camera',15)+' Upload photo</span><input type="file" data-photo accept="image/jpeg,image/png,image/webp" aria-label="'+label+' profile picture"/></label>'+
 '<div class="unified-add__names"><label class="unified-add__field">First name<input name="first_name" required maxlength="120" placeholder="First name"/></label><label class="unified-add__field">Last name<input name="last_name" required maxlength="120" placeholder="Last name"/></label></div></div>'+
 vipDetails+
 '<details class="unified-add__optional"><summary>'+svg('link',15)+' Social media (optional)</summary><div class="unified-add__socials">'+social+'</div></details>'+
 '<label class="unified-add__consent"><input type="checkbox" data-consent required/><span>I confirm this person agreed to their information being stored for church follow-up.</span></label>'+
 '<div class="alert alert--warn" data-duplicate hidden></div>'+
 '<button class="btn btn--primary unified-add__submit" type="submit">'+svg('plus',16)+' Add '+label+'</button></form></section>';
}

/** Unified admin entry: children are People profiles, not login accounts. */
export function createAddNewModal({initialTab='network',networkId=null,onSaved=()=>{}}={}){
 if(!modes.includes(initialTab))initialTab='network';
 const tabs=modes.map((mode,i)=>'<button type="button" role="tab" id="tab-'+mode+'" aria-controls="unified-'+mode+'" aria-selected="'+(mode===initialTab)+'" tabindex="'+(mode===initialTab?0:-1)+'" data-tab="'+mode+'">'+svg(['network','users','user','user'][i],18)+' '+headingOf[mode]+'</button>').join('');
 const modal=openModal({title:'Add New',wide:true,body:'<div class="unified-add"><div class="unified-add__tabs" role="tablist" aria-label="Add to discipleship tree">'+tabs+'</div>'+modes.map(m=>panel(m,initialTab)).join('')+'</div>',footer:'<button type="button" class="btn" data-close>Close</button>'});
 modal.querySelector('[data-close]').onclick=closeModal;
 const state={networkId:networkId?Number(networkId):null,networks:[],photos:{network:null,cell:null,member:null,vip:null},busy:false,pending:{},keys:{vip:crypto.randomUUID().replaceAll('-','')}};
 const getForm=mode=>modal.querySelector('[data-form="'+mode+'"]');
 const error=(mode,message)=>{const target=getForm(mode).querySelector('[data-error]');target.textContent=message;target.hidden=false;};
 const clear=mode=>{getForm(mode).querySelector('[data-error]').hidden=true;};
 const setTab=mode=>{
  if(state.busy||!modes.includes(mode))return;
  modes.forEach(m=>{const active=m===mode;modal.querySelector('#unified-'+m).hidden=!active;const tab=modal.querySelector('#tab-'+m);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
 };
 modal.querySelectorAll('[data-tab]').forEach(button=>{
  button.onclick=()=>setTab(button.dataset.tab);
  button.onkeydown=e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const i=modes.indexOf(button.dataset.tab),j=e.key==='Home'?0:e.key==='End'?modes.length-1:(i+(e.key==='ArrowRight'?1:modes.length-1))%modes.length;setTab(modes[j]);modal.querySelector('#tab-'+modes[j]).focus();};
 });
 const findNetwork=id=>state.networks.find(n=>Number(n.id)===Number(id));
 async function loadCells(){
  const netId=Number(getForm('member').querySelector('[data-field=network]').value);
  const select=getForm('member').querySelector('[data-field=cell]'),previous=select.value;
  select.replaceChildren(new Option('Choose Cell Leader',''));select.disabled=true;
  if(!netId)return;
  try{
   const response=await api.lifegroups({network_id:netId,status:'active'});
   const groups=Array.isArray(response)?response:response?.groups||response?.lifegroups||[];
   const network=findNetwork(netId);
   groups.filter(g=>g.leader_person_id&&!g.leads_network&&Number(g.leader_person_id)!==Number(network?.leader_person_id)).forEach(g=>select.add(new Option(g.leader_name||g.name,String(g.id))));
   select.disabled=select.options.length<2;
   if([...select.options].some(o=>o.value===previous))select.value=previous;
  }catch(e){error('member',e.message||'Unable to load Cell Leaders.');}
 }
 async function loadNetworks(){
  const response=await api.networks({status:'active'});
  state.networks=Array.isArray(response)?response:response?.networks||[];
  for(const mode of ['cell','member']){
   const select=getForm(mode).querySelector('[data-field=network]'),previous=select.value||String(state.networkId||'');
   select.replaceChildren(new Option('Choose Network',''));
   state.networks.filter(n=>n.leader_person_id).forEach(n=>select.add(new Option((n.leader_name||n.name)+' '+(n.gender==='boys'?'♂':'♀'),String(n.id))));
   if([...select.options].some(o=>o.value===previous))select.value=previous;
  }
  await loadCells();
 }
 for(const mode of ['cell','member'])getForm(mode).querySelector('[data-field=network]').onchange=e=>{
  state.networkId=Number(e.target.value)||null;
  getForm(mode==='cell'?'member':'cell').querySelector('[data-field=network]').value=e.target.value;
  loadCells();
 };
 getForm('member').querySelector('[data-field=cell]').onchange=()=>clear('member');
 for(const mode of modes){
  const f=getForm(mode),input=f.querySelector('[data-photo]');
  input.onchange=async()=>{
   const file=input.files?.[0];if(!file)return;
   try{
    if(file.size>5*1024*1024)throw new Error('Photo must be under 5 MB.');
    const value=await fileToDataUrl(file,320);state.photos[mode]=value;
    const preview=f.querySelector('[data-photo-preview]');preview.replaceChildren();
    const img=document.createElement('img');img.src=value;img.alt='Profile photo preview';preview.append(img);clear(mode);
   }catch(e){error(mode,e.message||'Unable to upload photo.');}
   input.value='';
  };
  f.oninput=()=>{if(!state.pending[mode])clear(mode);};
  f.onsubmit=e=>{e.preventDefault();submit(mode);};
 }
 function reset(mode){
  getForm(mode).reset();state.photos[mode]=null;delete state.pending[mode];if(mode==='vip')state.keys.vip=crypto.randomUUID().replaceAll('-','');
  getForm(mode).querySelector('[data-photo-preview]').innerHTML=svg('user',28);
  const duplicates=getForm(mode).querySelector('[data-duplicate]');duplicates.hidden=true;delete duplicates.dataset.ack;
  if(mode!=='network'&&mode!=='vip'&&state.networkId)getForm(mode).querySelector('[data-field=network]').value=String(state.networkId);
 }
 async function submit(mode){
  if(state.busy)return;
  clear(mode);
  const f=getForm(mode);
  const first=f.querySelector('[name=first_name]').value.trim(),last=f.querySelector('[name=last_name]').value.trim();
  const existingId=Number(f.querySelector('[name=existing_person_id]').value)||null;
  if(!existingId&&(!first||!last))return error(mode,'Enter first and last name.');
  if(!f.querySelector('[data-consent]').checked)return error(mode,'Confirm consent before saving.');
  const network=mode==='network'||mode==='vip'?null:findNetwork(Number(f.querySelector('[data-field=network]').value));
  if(mode==='cell'&&!network)return error(mode,'Choose an existing Network.');
  const gender=(mode==='network'||mode==='vip'||(mode==='member'&&!network))?f.querySelector('[name=network_gender]:checked')?.value:network.gender;
  if(!gender)return error(mode,'Select Gender.');
  const cellId=mode==='member'?Number(f.querySelector('[data-field=cell]').value):null;
  // Members without an eligible Cell may be saved for Needs Cell follow-up.
  const person={first_name:first,last_name:last,...(gender?{sex:sexOf[gender]}:{}),photo:state.photos[mode],status:mode==='vip'?'first_timer':mode==='member'?'member':'leader',privacy_consent:true,registration_source:'staff'};
  for(const field of ['facebook_url','instagram_url','tiktok_url','x_url','youtube_url']){
   const value=f.querySelector('[name='+field+']').value.trim();if(value)person[field]=value;
  }
  const fingerprint=JSON.stringify({person,existingId,networkId:network?.id||null,cellId});
  const pending=state.pending[mode];
  if(pending&&pending.fingerprint!==fingerprint)return error(mode,'A profile was already saved. Retry its assignment before editing these details.');
  if(!pending&&!existingId&&!(await duplicateGuard(person,f.querySelector('[data-duplicate]'))))return;
  state.busy=true;
  try{
   await withLoading(f.querySelector('[type=submit]'),async()=>{
    if(mode==='vip'){
      const vipPayload={
        ...person,age:Number(f.querySelector('[name=age]').value),
        school:f.querySelector('[name=school]').value.trim(),
        inviter:f.querySelector('[name=inviter]').value.trim(),
        contact_number:f.querySelector('[name=contact_number]').value.trim()||null,
        idempotency_key:state.keys.vip,...(existingId?{existing_person_id:existingId}:{}) ,
      };
      if(!Number.isInteger(vipPayload.age)||vipPayload.age<1||vipPayload.age>120||!vipPayload.school||!vipPayload.inviter)
        return error(mode,'Enter a valid age, school and inviter.');
      const registration=state.pending.vip?.registration||await api.registerAdminVip(vipPayload);
      state.pending.vip={fingerprint,person:{id:Number(registration.person_id)},registration};
      let assignment;
      try{assignment=await api.autoAssignLifegroup(registration.person_id);}
      catch(e){assignment={assigned:false,reason:e.message||'Assignment unavailable',needs_manual_assignment:true};}
      const recovery=registration.recovery_code;
      reset(mode);
      const box=modal.querySelector('[data-form="vip"] [data-error]');
      box.className='alert alert--info';
      box.hidden=false;
      box.textContent=(assignment.assigned?'VIP saved and assigned to a Cell.':'VIP saved. Assign a Cell using People to connect.')+
        (recovery?' Recovery code (share privately): '+recovery:'');
      toast(assignment.assigned?'VIP registered and assigned.':'VIP registered; Cell follow-up required.');
      onSaved({mode,person:{id:Number(registration.person_id)},registration,assignment});
      return;
    }
    const created=pending?.person||(existingId?await api.person(existingId):await api.createPerson(person));
    if(!created?.id)throw new Error('Unable to save the person profile.');
    if(existingId&&created.sex&&created.sex!==person.sex)throw new Error('The existing person gender does not match this network or Cell.');
    state.pending[mode]=pending||{fingerprint,person:created};
    if(mode==='network'){
     const priorNetwork=state.networks.find(n=>Number(n.leader_person_id)===Number(created.id));
     const result=state.pending[mode].network||priorNetwork||await api.createNetworkStructure({leader_person_id:created.id,gender,cell_leaders:[]});
     state.pending[mode].network=result;
     await api.setDiscipleshipClassification(created.id,'network_leader','Registered or reconnected as Network Leader');
     state.networkId=Number(result.id);
     await loadNetworks();reset(mode);
     toast('Network Leader added. Add Cell Leaders when ready.');
     state.busy=false;setTab('cell');
     onSaved({mode,person:created,network:result});
    }else if(mode==='cell'){
     const groups=existingId?await api.lifegroups({status:'all'}):[];
     const priorCell=groups.find(g=>Number(g.leader_person_id)===Number(created.id)&&g.is_active);
     if(priorCell&&Number(priorCell.network_id)!==Number(network.id))throw new Error('This Cell Leader already leads a Cell in another Network. Reassign them using Edit / Reassign.');
     const result=state.pending[mode].group||priorCell||await api.createLifegroup({name:((created.first_name||first)+' '+(created.last_name||last)+' Cell').slice(0,120),gender,network_id:network.id,network_manual:true,leader_person_id:created.id,capacity:12});
     state.pending[mode].group=result;
     // Link this Cell Leader to the Network Leader team for existing reports.
     const team=await api.ensureNetworkLeaderGroup(network.id);
     await api.assignLifegroup(team.lifegroup_id,created.id,{role:'leader',sex:sexOf[gender]});
     await api.setDiscipleshipClassification(created.id,'cell_leader','Registered or reconnected as Cell Leader');
     state.networkId=Number(network.id);
     reset(mode);
     getForm('member').querySelector('[data-field=network]').value=String(state.networkId);
     await loadCells();
     getForm('member').querySelector('[data-field=cell]').value=String(result.id);
     toast('Cell Leader added. Add Members when ready.');
     state.busy=false;setTab('member');onSaved({mode,person:created,group:result});
    }else{
     if(!cellId){await api.setDiscipleshipClassification(created.id,'member','Member awaiting Cell assignment');reset(mode);toast('Member saved to People to connect. Assign a Cell through Needs Cell.');onSaved({mode,person:created,needsAssignment:true});return;}
     const assigned=state.pending[mode].membership||await api.assignLifegroup(cellId,created.id,{role:'member',sex:sexOf[gender]});
     state.pending[mode].membership=assigned;
     await api.setDiscipleshipClassification(created.id,'member','Member assigned to Cell');
     reset(mode);toast('Member added.');onSaved({mode,person:created,membership:assigned});
    }
   });
  }catch(e){error(mode,(state.pending[mode]?'Profile saved. Assignment not completed: ':'')+(e.message||'Unable to add person.'));}
  finally{state.busy=false;}
 }
 loadNetworks().catch(e=>{error('cell',e.message||'Could not load Networks.');error('member',e.message||'Could not load Networks.');});
 return modal;
}
