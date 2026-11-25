/**
 * Client-side workspace command search. Never queries private records.
 * Permission-gated destinations; no access is gained by hiding navigation.
 */
const COMMANDS = [
  { title:'Dashboard', detail:'Overview and church statistics', route:'#/dashboard', permission:'dashboard:view', keywords:'home statistics overview' },
  { title:'People', detail:'Open the People directory', route:'#/people', permission:'people:view', keywords:'directory members records' },
  { title:'Add person', detail:'Create a new People record', route:'#/people/new', permission:'people:write', keywords:'register create member' },
  { title:'Lifegroups', detail:'Networks, leaders and Cells', route:'#/lifegroups', permission:'lifegroups:view', keywords:'network cell leaders groups' },
  { title:'Find within Lifegroups', detail:'Search the group hierarchy', route:'#/lifegroups?tab=find', permission:'lifegroups:view', keywords:'find cell leader network' },
  { title:'Registration', detail:'VIP registrations and review', route:'#/registrations', permission:'registrations:manage', keywords:'vip approval checkins' , hostedOnly:true},
  { title:'Check-in QR', detail:'Open service check-in QR', route:'#/checkin-qr', permission:'registrations:manage', keywords:'attendance checkin service qr', hostedOnly:true },
  { title:'Registration QR poster', detail:'Print or share registration QR', route:'#/qr-poster', permission:'registrations:manage', keywords:'vip signup poster print', hostedOnly:true },
  { title:'Calendar', detail:'View upcoming church events', route:'#/calendar', permission:'dashboard:view', keywords:'events schedule date' },
  { title:'Community board', detail:'Manage posts and messages', route:'#/community', permission:'settings:manage', keywords:'prayer testimony moderation messages' },
  { title:'VIP Designs', detail:'Create and manage VIP designs', route:'#/designs', permission:'settings:manage', keywords:'graphics design' },
  { title:'Settings', detail:'Church configuration and account', route:'#/settings', keywords:'profile password church staff' },
  { title:'Privacy & Terms', detail:'View the privacy notice', route:'#/privacy', keywords:'privacy legal terms' },
  { title:'Publish website', detail:'Manage website publishing', route:'#/deploy', permission:'settings:manage', deployOnly:true, keywords:'website publish deployment' },
];

export function availableCommands({ can, standalone=false, deployHelper=false }={}) {
  return COMMANDS.filter(command => (!command.permission || can(command.permission)) && (!command.hostedOnly || !standalone) && (!command.deployOnly || deployHelper));
}

export function matchCommands(commands, query) {
  const terms = String(query||'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return commands;
  return commands.filter(c => terms.every(term => `${c.title} ${c.detail} ${c.keywords}`.toLocaleLowerCase().includes(term)));
}

export function mountWorkspaceCommandSearch({ form, can, standalone, deployHelper, navigate }) {
  if (!form) return () => {};
  const input = form.querySelector('input');
  if (!input) return () => {};
  const commands = availableCommands({can, standalone, deployHelper});
  const popover = document.createElement('div');
  popover.className = 'workspace-command-results';
  popover.id = 'workspaceCommandResults';
  popover.setAttribute('role', 'listbox');
  popover.setAttribute('aria-label', 'Workspace destinations');
  popover.hidden = true;
  form.append(popover);
  input.setAttribute('role','combobox');
  input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-controls',popover.id);
  input.setAttribute('aria-expanded','false');
  let list = commands;
  let selected = 0;
  const hide = () => {
    popover.hidden = true;
    input.setAttribute('aria-expanded','false');
    input.removeAttribute('aria-activedescendant');
  };
  const choose = command => {
    if (!command) return;
    hide();
    input.value = '';
    navigate(command.route);
  };
  const render = () => {
    list = matchCommands(commands,input.value);
    selected = Math.min(selected,Math.max(0,list.length-1));
    popover.replaceChildren();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'workspace-command-empty';
      empty.textContent = 'No matching sections or actions';
      popover.append(empty);
    }
    list.forEach((command,index) => {
      const btn = document.createElement('button');
      btn.type='button';
      btn.className = 'workspace-command-option';
      btn.id = `workspaceCommand-${index}`;
      btn.dataset.index = String(index);
      btn.setAttribute('role','option');
      btn.setAttribute('aria-selected',String(index===selected));
      const labels=document.createElement('span');
      labels.className='workspace-command-option__labels';
      const strong=document.createElement('strong');strong.textContent=command.title;
      const hint=document.createElement('small');hint.textContent=command.detail;
      labels.append(strong,hint);
      const arrow=document.createElement('span');arrow.textContent='↵';arrow.setAttribute('aria-hidden','true');
      btn.append(labels,arrow);
      btn.addEventListener('pointerdown',event=>event.preventDefault());
      btn.addEventListener('click',()=>choose(command));
      popover.append(btn);
    });
    if(list.length)input.setAttribute('aria-activedescendant',`workspaceCommand-${selected}`);
    else input.removeAttribute('aria-activedescendant');
    popover.hidden=false;
    input.setAttribute('aria-expanded','true');
  };
  const onInput = () => {selected=0;render();};
  const onFocus = () => render();
  const onKeydown = event => {
    if (event.key==='Escape') {if(!popover.hidden){event.preventDefault();hide();input.blur();}return;}
    if (event.key==='ArrowDown'||event.key==='ArrowUp') {
      event.preventDefault();
      if(popover.hidden)render();
      if(list.length){selected=(selected+(event.key==='ArrowDown'?1:-1)+list.length)%list.length;render();}
    }
    if(event.key==='Enter') {
      event.preventDefault();
      if(popover.hidden)render();
      choose(list[selected]);
    }
  };
  const onGlobalKeydown=event=>{
    if((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='k') {
      event.preventDefault();input.focus();input.select();render();
    }
    if(event.key==='Escape' && !popover.hidden && document.activeElement!==input) hide();
  };
  const onOutside=event=>{if(!form.contains(event.target))hide();};
  const onRoute=()=>hide();
  form.addEventListener('submit', event=>{event.preventDefault();choose(list[selected]);});
  input.addEventListener('input',onInput);
  input.addEventListener('focus',onFocus);
  input.addEventListener('keydown',onKeydown);
  document.addEventListener('keydown',onGlobalKeydown);
  document.addEventListener('pointerdown',onOutside);
  window.addEventListener('hashchange',onRoute);
  return () => {
    document.removeEventListener('keydown',onGlobalKeydown);
    document.removeEventListener('pointerdown',onOutside);
    window.removeEventListener('hashchange',onRoute);
  };
}
