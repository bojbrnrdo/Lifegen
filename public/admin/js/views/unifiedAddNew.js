import {api} from '../api.js';
import {icon,openModal,closeModal,withLoading,toast} from '../ui.js';
import {fileToDataUrl,duplicateGuard} from './personForm.js';

const modes=['pastor','network','cell','member','vip'];
const sexOf={boys:'male',girls:'female'};
// Plain, task-shaped labels: a volunteer should not have to know our data model
// to pick the right tab.
const tabLabel={pastor:'Start a pastor Network',network:'Start a Network',cell:'Start a Cell',member:'Add a person',vip:'Add a VIP guest'};
const purposeOf={
 pastor:'The top level: the Bishop (boys) or the Pastora (girls). Their cell holds the Network Leaders who report to them.',
 network:'A Network groups several Cells — all boys or all girls — under one Network Leader.',
 cell:'A Cell is one weekly small group with its own Cell Leader, inside a Network.',
 member:'Add someone who is already registered, or register a new person and put them straight into a Cell.',
 vip:'Register a first-time guest who has not joined a Cell yet.',
};
const svg=(key,size=18)=>icon(key,size).value;

function panel(mode,initial){
 // What the button says, in the user's words rather than the record's.
 const submitOf={pastor:'Create the pastor Network',network:'Create the Network',cell:'Create the Cell',member:'Add this person',vip:'Register the VIP guest'};
 const gender=(mode==='pastor'||mode==='network'||mode==='vip'||mode==='member')?'<fieldset class="unified-add__gender"><legend>Boy or girl?</legend><label><input type="radio" name="network_gender" value="boys" aria-label="Boy">'+svg('mars',20)+'</label><label><input type="radio" name="network_gender" value="girls" aria-label="Girl">'+svg('venus',20)+'</label></fieldset>':'';
 const network=mode==='pastor'||mode==='network'||mode==='vip'?'':'<label class="unified-add__field">Which Network?<select data-field="network" required><option value="">Choose the Network first</option></select><small>Only Networks of the gender you picked are listed.</small></label>'+
 (mode==='network'?'<label class="unified-add__field">Under which pastor? <select data-field="parent"><option value="">On its own (no pastor above it)</option></select><small>Choose the Bishop or Pastora whose cell this Network Leader will join.</small></label>':'');
 const cell=mode==='member'?'<label class="unified-add__field">Which Cell?<select data-field="cell" required disabled><option value="">Choose the Cell first</option></select><small>Choose a Network above and its Cells appear here.</small></label>':'';
 const membershipTier=mode==='member'?'<fieldset class="unified-add__tier" aria-label="How well do we know this person?"><legend>How well do we know them?</legend><label><input type="radio" name="member_tier" value="new" checked/><span><b>New</b> — just joined, still getting to know the group</span></label><label><input type="radio" name="member_tier" value="solid"/><span><b>Settled</b> — attends regularly and is committed</span></label><small>Most new people start as New. You can switch to Settled at any time from the Cell page.</small></fieldset>':'';
 const pastorNote=mode==='pastor'?'<p class="unified-add__hint">A pastor Network sits at the top. Network Leaders are added under it afterwards, and they become members of this pastor’s cell.</p>':'';
 const existingPerson='<details class="unified-add__optional" data-existing-wrap><summary>'+svg('user',15)+' They are already registered</summary><div class="unified-add__socials"><label class="unified-add__field">Their Person ID<input name="existing_person_id" type="number" min="1" placeholder="e.g. 0042"/><small>Look it up under “Everyone registered” on the Lifegroups page. Leave this closed to register a brand-new person.</small></label></div></details>';
 const vipDetails=mode==='vip'?'<div class="unified-add__names"><label class="unified-add__field">Age<input name="age" type="number" min="1" max="120" required /></label><label class="unified-add__field">School / Institution<input name="school" maxlength="300" required /></label><label class="unified-add__field">Invited by<input name="inviter" maxlength="200" required /></label><label class="unified-add__field">Contact (optional)<input name="contact_number" type="tel" maxlength="40" /></label></div>':'';
 const social=['facebook_url','instagram_url','tiktok_url','x_url','youtube_url'].map(k=>'<label>'+k.replace('_url','').replace('_',' ')+'<input type="url" name="'+k+'" placeholder="HTTPS profile link"/></label>').join('');
 return '<section role="tabpanel" id="unified-'+mode+'" aria-labelledby="tab-'+mode+'" '+(mode===initial?'':'hidden')+'><form data-form="'+mode+'" novalidate>'+
 '<p class="unified-add__purpose">'+purposeOf[mode]+'</p>'+
 '<div class="alert alert--error" data-error role="alert" hidden></div>'+pastorNote+gender+network+cell+membershipTier+
 existingPerson+
 '<div class="unified-add__identity"><label class="unified-add__photo"><span data-photo-preview class="unified-add__photo-preview">'+svg('user',28)+'</span><span class="unified-add__photo-action">'+svg('camera',15)+' Upload photo</span><input type="file" data-photo accept="image/jpeg,image/png,image/webp" aria-label="Photo of the new '+tabLabel[mode]+'"/></label>'+
 '<div class="unified-add__names"><label class="unified-add__field">First name<input name="first_name" required maxlength="120" placeholder="First name"/></label><label class="unified-add__field">Last name<input name="last_name" required maxlength="120" placeholder="Last name"/></label></div></div>'+
 '<p class="unified-add__hint">Only the name is needed. Everything else on this form is optional.</p>'+
 vipDetails+
 '<details class="unified-add__optional"><summary>'+svg('link',15)+' Social media (optional)</summary><div class="unified-add__socials">'+social+'</div></details>'+
 '<label class="unified-add__consent"><input type="checkbox" data-consent required/><span>I confirm this person agreed to their information being stored for church follow-up.</span></label>'+
 '<div class="alert alert--warn" data-duplicate hidden></div>'+
 '<button class="btn btn--primary unified-add__submit" type="submit">'+svg('plus',16)+' '+submitOf[mode]+'</button></form></section>';
}

/** Unified admin entry: children are People profiles, not login accounts. */
export function createAddNewModal({initialTab='network',networkId=null,personId=null,onSaved=()=>{}}={}){
 if(!modes.includes(initialTab))initialTab='network';
 const tabs=modes.map((mode,i)=>'<button type="button" role="tab" id="tab-'+mode+'" aria-controls="unified-'+mode+'" aria-selected="'+(mode===initialTab)+'" tabindex="'+(mode===initialTab?0:-1)+'" data-tab="'+mode+'" title="'+purposeOf[mode]+'">'+svg(['star','network','people','user','user'][i],18)+' '+tabLabel[mode]+'</button>').join('');
 const modal=openModal({title:'Add something new',wide:true,body:'<div class="unified-add"><div class="unified-add__tabs" role="tablist" aria-label="What would you like to add?">'+tabs+'</div>'+modes.map(m=>panel(m,initialTab)).join('')+'</div>',footer:'<button type="button" class="btn" data-close>Close</button>'});
 modal.querySelector('[data-close]').onclick=closeModal;
 const state={networkId:networkId?Number(networkId):null,networks:[],photos:{pastor:null,network:null,cell:null,member:null,vip:null},busy:false,pending:{},keys:{vip:crypto.randomUUID().replaceAll('-','')}};
 const getForm=mode=>modal.querySelector('[data-form="'+mode+'"]');
 if(personId){
   const form=getForm(initialTab);
   form.querySelector('[name=existing_person_id]').value=String(personId);
   api.person(personId).then(p=>{
     form.querySelector('[name=first_name]').value=p.first_name||'';
     form.querySelector('[name=last_name]').value=p.last_name||'';
     if(p.sex==='male'||p.sex==='female'){
       const opt=form.querySelector('[name=network_gender][value="'+(p.sex==='male'?'boys':'girls')+'"]');
       if(opt)opt.checked=true;
     }
     if(initialTab==='vip')for(const field of ['age','school','inviter','contact_number']){
       const input=form.querySelector('[name='+field+']');
       if(input&&p[field]!=null)input.value=String(p[field]);
     }
   }).catch(e=>{const box=form.querySelector('[data-error]');box.textContent=e.message;box.hidden=false;});
 }

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
  }catch(e){error('member',e.message||'Could not load the Cells for this Network.');}
 }
 async function loadNetworks(){
  const response=await api.networks({status:'active'});
  state.networks=Array.isArray(response)?response:response?.networks||[];
  {
   const parentSelect=getForm('network').querySelector('[data-field=parent]');
   if(parentSelect){
    const keep=parentSelect.value;
    parentSelect.replaceChildren(new Option('On its own (no pastor above it)',''));
    state.networks.filter(n=>Number(n.child_count||0)>0||(!n.parent_network_id&&state.networks.some(c=>String(c.parent_network_id)===String(n.id))))
     .forEach(n=>parentSelect.add(new Option((n.leader_name?n.leader_name+' — ':'')+n.name,String(n.id))));
    if([...parentSelect.options].some(o=>o.value===keep))parentSelect.value=keep;
   }
  }
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
   }catch(e){error(mode,e.message||'That photo could not be used. Try another one.');}
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
  if(!existingId&&(!first||!last))return error(mode,'Type the first and last name.');
  if(!f.querySelector('[data-consent]').checked)return error(mode,'Please tick the consent box before saving.');
  const network=mode==='network'||mode==='vip'?null:findNetwork(Number(f.querySelector('[data-field=network]').value));
  if(mode==='cell'&&!network)return error(mode,'Choose which Network this Cell belongs to.');
  const gender=(mode==='network'||mode==='vip'||(mode==='member'&&!network))?f.querySelector('[name=network_gender]:checked')?.value:network.gender;
  if(!gender)return error(mode,'Choose whether this is for boys or for girls.');
  const cellId=mode==='member'?Number(f.querySelector('[data-field=cell]').value):null;
  const memberTier=mode==='member'?f.querySelector('[name=member_tier]:checked')?.value:null;
  // Members without an eligible Cell may be saved for Needs Cell follow-up.
  const person={first_name:first,last_name:last,...(gender?{sex:sexOf[gender]}:{}),photo:state.photos[mode],status:mode==='vip'?'first_timer':mode==='member'?'member':'leader',privacy_consent:true,registration_source:'staff'};
  for(const field of ['facebook_url','instagram_url','tiktok_url','x_url','youtube_url']){
   const value=f.querySelector('[name='+field+']').value.trim();if(value)person[field]=value;
  }
  const fingerprint=JSON.stringify({person,existingId,networkId:network?.id||null,cellId,memberTier});
  const pending=state.pending[mode];
  if(pending&&pending.fingerprint!==fingerprint)return error(mode,'This person was already saved. Finish the earlier step before changing their details.');
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
        return error(mode,'Fill in a valid age, school and who invited them.');
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
      toast(assignment.assigned?'VIP guest added and placed in a Cell.':'VIP guest added. Someone needs to place them in a Cell.');
      onSaved({mode,person:{id:Number(registration.person_id)},registration,assignment});
      return;
    }
    const created=pending?.person||(existingId?await api.person(existingId):await api.createPerson(person));
    if(!created?.id)throw new Error('That did not save. Please try again.');
    if(existingId&&created.sex&&created.sex!==person.sex)throw new Error('That person is a different gender from this Network or Cell.');
    state.pending[mode]=pending||{fingerprint,person:created};
    if(mode==='pastor'){
     // Top of the hierarchy: a pastor Network (Bishop / Pastora) plus the cell
     // that will hold their Network Leaders.
     const priorNetwork=state.networks.find(n=>Number(n.leader_person_id)===Number(created.id));
     const result=state.pending[mode].network||priorNetwork||await api.createNetwork({
       name:((created.first_name||first)+' '+(created.last_name||last)).slice(0,120),
       gender, leader_person_id:created.id, is_active:true,
     });
     state.pending[mode].network=result;
     await api.ensureNetworkLeaderGroup(result.id);
     await api.setDiscipleshipClassification(created.id,gender==='girls'?'pastora':'bishop',gender==='girls'?'Pastora':'Bishop');
     state.networkId=Number(result.id);
     await loadNetworks();reset(mode);
     toast('Pastor Network created. Next, add the Network Leaders under them.');
     state.busy=false;setTab('network');
     onSaved({mode,person:created,network:result});
    }else if(mode==='network'){
     const priorNetwork=state.networks.find(n=>Number(n.leader_person_id)===Number(created.id));
     const result=state.pending[mode].network||priorNetwork||await api.createNetworkStructure({leader_person_id:created.id,gender,cell_leaders:[]});
     state.pending[mode].network=result;
     await api.setDiscipleshipClassification(created.id,'network_leader','Network Leader');
     state.networkId=Number(result.id);
     await loadNetworks();reset(mode);
     toast('Network created. Next, add the Cell Leaders.');
     state.busy=false;setTab('cell');
     onSaved({mode,person:created,network:result});
    }else if(mode==='cell'){
     const groups=existingId?await api.lifegroups({status:'all'}):[];
     const priorCell=groups.find(g=>Number(g.leader_person_id)===Number(created.id)&&g.is_active);
     if(priorCell&&Number(priorCell.network_id)!==Number(network.id))throw new Error('This person already leads a Cell in another Network. Move that Cell here first, or choose someone else.');
     const result=state.pending[mode].group||priorCell||await api.createLifegroup({name:((created.first_name||first)+' '+(created.last_name||last)+' Cell').slice(0,120),gender,network_id:network.id,network_manual:true,leader_person_id:created.id,capacity:12});
     state.pending[mode].group=result;
     // In this hierarchy the Cell Leader is a *member* of the Network Leader's
     // cell, just as the Network Leader is a member of their pastor's cell.
     // Their own Cell above is what makes them a Cell Leader.
     const team=await api.ensureNetworkLeaderGroup(network.id);
     await api.assignLifegroup(team.lifegroup_id,created.id,{role:'member',sex:sexOf[gender]});
     await api.setDiscipleshipClassification(created.id,'cell_leader','Cell Leader');
     state.networkId=Number(network.id);
     reset(mode);
     getForm('member').querySelector('[data-field=network]').value=String(state.networkId);
     await loadCells();
     getForm('member').querySelector('[data-field=cell]').value=String(result.id);
     toast('Cell created. Next, add the people who meet in it.');
     state.busy=false;setTab('member');onSaved({mode,person:created,group:result});
    }else{
     if(!cellId){await api.setDiscipleshipClassification(created.id,'member','Saved, waiting for a Cell');reset(mode);toast('Person saved. They are under “Not in a Cell yet” until you add them to one.');onSaved({mode,person:created,needsAssignment:true});return;}
     const assigned=state.pending[mode].membership||await api.assignLifegroup(cellId,created.id,{role:'member',tier:memberTier,sex:sexOf[gender]});
     state.pending[mode].membership=assigned;
     await api.setDiscipleshipClassification(created.id,'member','Added to a Cell');
     reset(mode);toast('Person added to the Cell.');onSaved({mode,person:created,membership:assigned});
    }
   });
  }catch(e){error(mode,(state.pending[mode]?'The person was saved, but adding them to the Cell did not finish: ':'')+(e.message||'That did not save. Please try again.'));}
  finally{state.busy=false;}
 }
 loadNetworks().catch(e=>{error('cell',e.message||'Could not load the Networks. Refresh the page and try again.');error('member',e.message||'Could not load the Networks. Refresh the page and try again.');});
 return modal;
}
