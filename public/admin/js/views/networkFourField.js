
import { api } from '../api.js';
import { openModal, closeModal, icon, withLoading, toast } from '../ui.js';
import { networkLeaderRegistrationHtml, bindNetworkLeaderRegistration } from './networkLeaderRegistration.js';

const LIMIT=12;
const sexOf={boys:'male',girls:'female'};

function picker(host, {gender, used, initial=null, label, select}) {
  const wrap=document.createElement('div');
  wrap.className='gsearch network-four__search';
  const symbol=document.createElement('span');symbol.innerHTML=icon('search',16).value;
  const input=document.createElement('input');
  const avatar=document.createElement('span');avatar.className='network-four__picker-avatar';
  const setAvatar=person=>{avatar.innerHTML='';const img=person?.photo;if(typeof img==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)&&img.length<400000){const image=document.createElement('img');image.src=img;image.alt='';avatar.append(image);}else avatar.innerHTML=icon('user',17).value;};
  setAvatar(initial);
  input.type='search';input.autocomplete='off';input.placeholder='Find registered person…';
  input.setAttribute('aria-label',label);
  input.value=initial?.name||'';
  const results=document.createElement('div');results.className='gsearch__results';results.hidden=true;
  wrap.append(avatar,input,results);host.append(wrap);
  let timer,version=0,selection=initial;
  const hide=()=>{results.hidden=true;results.replaceChildren();};
  const set=person=>{selection=person;input.value=person?.name||'';setAvatar(person);hide();};
  input.addEventListener('input',()=>{
    version++;clearTimeout(timer);selection=null;setAvatar(null);select(null);hide();
    const seq=version,q=input.value.trim();
    if(q.length<2)return;
    timer=setTimeout(async()=>{
      try{
        const {people=[]}=await api.search(q);
        if(version!==seq||!wrap.isConnected||input.value.trim()!==q)return;
        const matches=people.filter(p=>(!gender()||!p.sex||p.sex===sexOf[gender()])&&!used().has(Number(p.id))).slice(0,12);
        results.replaceChildren();
        if(!matches.length){
          const none=document.createElement('div');none.className='gsearch__empty';
          none.textContent='No eligible registered people found.';results.append(none);
        }
        for(const p of matches){
          const name=p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||p.person_code;
          const b=document.createElement('button');b.type='button';b.className='gsearch__item';
          b.classList.add('network-four__person-result');
          const preview=document.createElement('span');preview.className='network-four__result-avatar';
          if(p.photo&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo)&&p.photo.length<400000){const image=document.createElement('img');image.src=p.photo;image.alt='';preview.append(image);}else preview.innerHTML=icon('user',16).value;
          const text=document.createElement('span');text.textContent=name+(p.person_code?' · '+p.person_code:'');b.append(preview,text);
          const choose=()=>{const person={id:Number(p.id),name,sex:p.sex||null,photo:p.photo||null};set(person);select(person);};
          b.addEventListener('pointerdown',e=>{e.preventDefault();choose();});
          b.addEventListener('click',choose);
          results.append(b);
        }
        results.hidden=false;
      }catch(e){results.textContent=e.message||'Search failed';results.hidden=false;}
    },220);
  });
  input.addEventListener('blur',()=>setTimeout(hide,180));
  return {input,set};
}

export function createFourFieldNetwork(onSaved,{allowRegistration=false}={}){
  const radio=(gender,kind,name)=>'<label class="choice__opt choice__opt--gender">'+
    '<input type="radio" name="gender" value="'+gender+'" aria-label="'+name+'"/>'+
    '<span title="'+name+'">'+icon(kind,23).value+'</span></label>';
  const modal=openModal({
    title:'New Network',wide:true,
    body:'<div class="network-four">'+
      '<nav class="network-four__steps" aria-label="Registration progress">'+
        '<button type="button" data-step="1" aria-label="Network Leader and Gender">'+icon('user',17).value+'<span>Leader</span></button>'+
        '<button type="button" data-step="2" aria-label="Cell Leaders">'+icon('group',17).value+'<span>Cell Leaders</span></button>'+
        '<button type="button" data-step="3" aria-label="Members">'+icon('people',17).value+'<span>Members</span></button></nav>'+
      '<div class="alert alert--error" id="netFourError" role="alert" hidden></div>'+
      '<section class="network-four__section"><label class="network-four__label">Network Leader</label>'+
        '<div id="netFourLeader"></div>'+
        (allowRegistration?'<button type="button" class="btn btn--sm network-four__register" id="netLeaderRegister" aria-expanded="false">'+icon('plus',14).value+' Register new leader</button>':'')+'</section>'+
      '<section class="network-four__section"><label class="network-four__label">Gender</label>'+
        '<div class="choice choice--gender" role="group" aria-label="Gender">'+radio('boys','mars','Male')+radio('girls','venus','Female')+'</div></section>'+
      '<section class="network-four__section"><div class="network-four__heading"><label class="network-four__label">Cell Leader</label>'+
        '<span id="netCellCount" class="network-four__count">0 / 12</span></div>'+
        '<div id="netCells"></div><button class="btn btn--sm" type="button" id="netAddCell">'+icon('plus',14).value+' Add Cell Leader</button></section>'+
      '<section class="network-four__section"><label class="network-four__label">Member</label>'+
        '<div id="netMembers"></div></section></div>'+(allowRegistration?networkLeaderRegistrationHtml():''),
    footer:'<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn btn--primary" id="saveNetFour">Create Network</button>'
  });
  modal.querySelector('[data-close]').onclick=closeModal;
  const state={gender:null,leader:null,cells:[]};let serial=0;
  const sections=[...modal.querySelectorAll('.network-four__section')];
  const progress=[...modal.querySelectorAll('[data-step]')];
  let activeStep=1;
  function showStep(wanted){
    const max=state.leader&&state.gender?(state.cells.some(c=>c.person)?3:2):1;
    activeStep=Math.min(Math.max(1,wanted),max);
    sections.forEach((section,index)=>{section.hidden=activeStep===1?index>=2:activeStep===2?index!==2:index!==3;section.classList.toggle('is-revealed',!section.hidden);});
    progress.forEach(button=>{const step=Number(button.dataset.step);button.disabled=step>max;button.setAttribute('aria-current',step===activeStep?'step':'false');button.classList.toggle('is-complete',step<activeStep);});
  }
  progress.forEach(button=>button.addEventListener('click',()=>showStep(Number(button.dataset.step))));
  const error=modal.querySelector('#netFourError');
  const fail=message=>{error.textContent=message;error.hidden=false;};
  const clear=()=>{error.hidden=true;};
  const ids=(except=null)=>{
    const set=new Set(),add=p=>{if(p?.id&&p!==except)set.add(Number(p.id));};
    add(state.leader);
    for(const cell of state.cells){add(cell.person);cell.members.forEach(add);}
    return set;
  };
  const leaderPicker=picker(modal.querySelector('#netFourLeader'),{
    gender:()=>state.gender,label:'Network Leader',
    used:()=>ids(state.leader),select:p=>{
      state.leader=p;
      if(p?.sex&&!state.gender){
        state.gender=p.sex==='male'?'boys':'girls';
        modal.querySelector('input[name=gender][value='+state.gender+']').checked=true;
      }
      clear();
      if(p&&state.gender)showStep(2);
    }
  });
  if(allowRegistration)bindNetworkLeaderRegistration(modal,{
    genderNow:()=>state.gender,onError:fail,
    onRegistered:p=>{
      const person={id:Number(p.id),name:p.name};
      if(ids().has(person.id))return fail('Person already selected.');
      state.leader=person;leaderPicker.set(person);clear();
      if(state.gender)showStep(2);
    }
  });
  function render(){
    const list=modal.querySelector('#netCells'),members=modal.querySelector('#netMembers');
    list.replaceChildren();members.replaceChildren();
    modal.querySelector('#netCellCount').textContent=state.cells.length+' / '+LIMIT;
    modal.querySelector('#netAddCell').disabled=state.cells.length>=LIMIT;
    if(!state.cells.length)members.textContent='Add a Cell Leader to assign Members.';
    state.cells.forEach((cell,index)=>{
      const card=document.createElement('div');card.className='network-four__cell';
      const heading=document.createElement('div');heading.className='network-four__cell-heading';
      const label=document.createElement('strong');label.textContent='Cell Leader '+(index+1);
      const remove=document.createElement('button');remove.type='button';remove.className='btn btn--sm';
      remove.textContent='Remove';remove.onclick=()=>{state.cells=state.cells.filter(c=>c!==cell);render();};
      heading.append(label,remove);card.append(heading);
      picker(card,{
        label:'Cell Leader '+(index+1),gender:()=>state.gender,initial:cell.person,
        used:()=>ids(cell.person),
        select:p=>{
          const different=cell.person?.id!==p?.id;
          cell.person=p;
          if(different)cell.members=[];
          if(p){render();showStep(3);}else showStep(2);
          clear();
        }
      });
      list.append(card);
      if(!cell.person)return;
      const box=document.createElement('div');box.className='network-four__member-block';
      const title=document.createElement('div');title.className='network-four__member-label';
      title.textContent=cell.person.name+' · '+cell.members.length+' / '+LIMIT;
      box.append(title);
      const chips=document.createElement('div');chips.className='network-four__chips';
      for(const member of cell.members){
        const chip=document.createElement('span');chip.className='network-four__chip';
        chip.append(document.createTextNode(member.name));
        const removeMember=document.createElement('button');removeMember.type='button';
        removeMember.textContent='×';removeMember.setAttribute('aria-label','Remove '+member.name);
        removeMember.onclick=()=>{cell.members=cell.members.filter(p=>p!==member);render();};
        chip.append(removeMember);chips.append(chip);
      }
      box.append(chips);
      if(cell.members.length<LIMIT)picker(box,{
        label:'Member under '+cell.person.name,gender:()=>state.gender,used:()=>ids(),
        select:p=>{if(!p)return;cell.members.push(p);render();clear();}
      });
      members.append(box);
    });
    showStep(activeStep);
  }
  modal.querySelectorAll('input[name=gender]').forEach(radio=>radio.addEventListener('change',()=>{
    const had=Boolean(state.leader||state.cells.length);
    const next=radio.value;
    const incompatible=state.leader?.sex&&state.leader.sex!==sexOf[next];
    state.gender=next;
    if(incompatible){state.leader=null;leaderPicker.set(null);}
    const hadCells=state.cells.length>0;
    if(hadCells){state.cells=[];}
    render();
    showStep(state.leader?2:1);
    if(incompatible)fail('That leader does not match the selected Gender. Choose a matching person.');
    else if(hadCells)fail('Gender changed. Select the Cell Leaders again.');
    else clear();
  }));
  modal.querySelector('#netAddCell').onclick=()=>{
    if(!state.gender)return fail('Select Gender first.');
    if(state.cells.length===LIMIT)return fail('Maximum of 12 Cell Leaders.');
    state.cells.push({key:++serial,person:null,members:[]});render();showStep(2);clear();
    modal.querySelector('#netCells .network-four__cell:last-child input')?.focus();
  };
  modal.querySelector('#saveNetFour').onclick=()=>{
    clear();
    if(!state.gender)return fail('Select Gender.');
    if(!state.leader)return fail('Choose a registered Network Leader.');
    if(state.cells.some(c=>!c.person))return fail('Choose each Cell Leader or remove the empty row.');
    const payload={gender:state.gender,leader_person_id:state.leader.id,
      cell_leaders:state.cells.map(c=>({person_id:c.person.id,members:c.members.map(m=>m.id)}))};
    return withLoading(modal.querySelector('#saveNetFour'),async()=>{
      try{
        const saved=await api.createNetworkStructure(payload);
        closeModal();toast('Network created.');onSaved(saved);
      }catch(e){fail(e.message||'Could not create Network.');}
    });
  };
  render();showStep(1);
  return modal;
}
