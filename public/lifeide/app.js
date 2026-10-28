(() => {
'use strict';
const KEY='lifegen.lifeide.workspace.v1';
const initial=[
{id:'welcome',parent:null,name:'README.md',type:'file',content:'# Welcome to LifeIDE!\n\nThis is a browser-local coding workspace.\nYour changes do not modify the deployed LIFEGEN website.\n',modified:Date.now()},
{id:'examples',parent:null,name:'examples',type:'folder',modified:Date.now()},
{id:'sample',parent:'examples',name:'hello.js',type:'file',content:'// LifeIDE example\nconsole.log("Hello LIFEGEN!");\n',modified:Date.now()}];
const $=id=>document.getElementById(id);
let items=load(),current=null,opened=[],sort='name',size=14,expanded=new Set(['examples']),dialogAction=null;
function load(){try{const data=JSON.parse(localStorage.getItem(KEY));if(Array.isArray(data)&&data.every(x=>typeof x.id==='string'&&typeof x.name==='string'&&['file','folder'].includes(x.type)))return data;}catch{}return structuredClone(initial);}
function save(){try{localStorage.setItem(KEY,JSON.stringify(items));$('status').textContent='Saved locally';}catch{$('status').textContent='Storage full — copy your changes';}}
function node(id){return items.find(x=>x.id===id);}
function pathOf(x){let parts=[x.name],p=x.parent,steps=0;while(p&&steps++<30){const n=node(p);if(!n)break;parts.unshift(n.name);p=n.parent;}return parts.join('/');}
function siblings(parent){return items.filter(x=>x.parent===parent).sort((a,b)=>a.type===b.type?(sort==='name'?a.name.localeCompare(b.name):b.modified-a.modified):a.type==='folder'?-1:1);}
function renderTree(){const root=$('tree');root.replaceChildren();function visit(parent,depth){for(const f of siblings(parent)){const button=document.createElement('button');button.type='button';button.className='node'+(current===f.id?' selected':'');button.style.paddingLeft=(7+depth*15)+'px';const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent=f.type==='folder'?(expanded.has(f.id)?'▾':'▸'):' ';const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=f.type==='folder'?'📁':'▤';const name=document.createElement('span');name.className='name';name.textContent=f.name;button.append(arrow,glyph,name);button.title=pathOf(f);button.addEventListener('click',()=>{if(f.type==='folder'){expanded.has(f.id)?expanded.delete(f.id):expanded.add(f.id);renderTree();}else select(f.id);});button.addEventListener('contextmenu',ev=>{ev.preventDefault();if(confirm('Delete '+pathOf(f)+'? This cannot be undone.'))remove(f.id);});root.append(button);if(f.type==='folder'&&expanded.has(f.id))visit(f.id,depth+1);}}visit(null,0);}
function select(id){const f=node(id);if(!f||f.type!=='file')return;current=id;if(!opened.includes(id))opened.push(id);$('editor').disabled=false;$('editor').value=f.content||'';$('fileTitle').textContent=pathOf(f);$('language').textContent=(f.name.split('.').pop()||'txt').toUpperCase();renderTabs();renderTree();updateLines();}
function renderTabs(){const container=$('tabs');container.replaceChildren();for(const id of opened){const f=node(id);if(!f)continue;const tab=document.createElement('button');tab.type='button';tab.className='tab'+(id===current?' active':'');tab.textContent=f.name;tab.addEventListener('click',()=>select(id));const close=document.createElement('button');close.type='button';close.className='close';close.textContent='×';close.setAttribute('aria-label','Close '+f.name);close.addEventListener('click',e=>{e.stopPropagation();opened=opened.filter(x=>x!==id);if(id===current){current=null;if(opened.length)select(opened[opened.length-1]);else emptyEditor();}renderTabs();renderTree();});tab.append(close);container.append(tab);}}
function emptyEditor(){$('editor').value='# Welcome to LifeIDE!\n# Select a file to begin.';$('editor').disabled=true;$('fileTitle').textContent='No file selected';$('language').textContent='Plain text';updateLines();}
function updateLines(){const el=$('editor'),lines=el.value.split('\n').length;$('lineNumbers').textContent=Array.from({length:lines},(_,i)=>i+1).join('\n');const pos=el.selectionStart,preceding=el.value.slice(0,pos).split('\n');$('position').textContent='Ln '+preceding.length+', Col '+(preceding.at(-1).length+1);$('lineNumbers').scrollTop=el.scrollTop;}
function openDialog(title,label,action,prefill=''){dialogAction=action;$('dialogTitle').textContent=title;$('dialogLabel').textContent=label;$('dialogInput').value=prefill;$('dialogError').textContent='';$('dialog').hidden=false;$('dialogInput').focus();}
function closeDialog(){$('dialog').hidden=true;dialogAction=null;}
function chosenParent(){const f=node(current);return f?f.parent:null;}
function create(type,name,parent){if(!/^[^\\/\x00-\x1f]+$/.test(name)||name==='.'||name==='..'||name.trim()!==name)throw Error('Use a valid file or folder name.');if(items.some(x=>x.parent===parent&&x.name.toLowerCase()===name.toLowerCase()))throw Error('A file or folder with that name already exists.');const id='item-'+crypto.randomUUID();items.push({id,parent,name,type,content:type==='file'?'':'',modified:Date.now()});if(parent)expanded.add(parent);save();renderTree();if(type==='file')select(id);}
function remove(id){const descendants=new Set([id]);let changed=true;while(changed){changed=false;for(const x of items)if(descendants.has(x.parent)&&!descendants.has(x.id)){descendants.add(x.id);changed=true;}}items=items.filter(x=>!descendants.has(x.id));opened=opened.filter(x=>!descendants.has(x));if(descendants.has(current)){current=null;if(opened.length)select(opened[opened.length-1]);else emptyEditor();}save();renderTabs();renderTree();}
$('newFile').addEventListener('click',()=>openDialog('New File','File name',name=>create('file',name,chosenParent())));
$('newFolder').addEventListener('click',()=>openDialog('New Folder','Folder name',name=>create('folder',name,null)));
$('dialogForm').addEventListener('submit',e=>{e.preventDefault();try{dialogAction($('dialogInput').value);closeDialog();}catch(error){$('dialogError').textContent=error.message;}});
$('cancel').addEventListener('click',closeDialog);
$('dialog').addEventListener('click',e=>{if(e.target===$('dialog'))closeDialog();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDialog();if(!repoMode&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();}});
$('editor').addEventListener('input',()=>{const f=repoMode?null:node(current);if(f){f.content=$('editor').value;f.modified=Date.now();save();}updateLines();});
$('editor').addEventListener('click',updateLines);
$('editor').addEventListener('keyup',updateLines);
$('editor').addEventListener('scroll',()=>{$('lineNumbers').scrollTop=$('editor').scrollTop;});
$('editor').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const el=e.target,start=el.selectionStart,end=el.selectionEnd;el.setRangeText('  ',start,end,'end');el.dispatchEvent(new Event('input'));}});
$('sortName').addEventListener('click',()=>{sort='name';$('sortName').classList.add('active');$('sortDate').classList.remove('active');renderTree();});
$('sortDate').addEventListener('click',()=>{sort='date';$('sortDate').classList.add('active');$('sortName').classList.remove('active');renderTree();});
$('collapse').addEventListener('click',()=>$('sidebar').classList.toggle('collapsed'));
$('smaller').addEventListener('click',()=>{size=Math.max(11,size-1);setSize();});
$('larger').addEventListener('click',()=>{size=Math.min(24,size+1);setSize();});
function setSize(){$('editor').style.fontSize=size+'px';$('lineNumbers').style.fontSize=size+'px';}
$('refresh').addEventListener('click',()=>{if(repoMode){repositoryConnect().then(repositoryConnect);return;}items=load();opened=opened.filter(x=>node(x));if(current&&node(current))select(current);else emptyEditor();renderTree();});

// Repository mode uses authenticated same-origin APIs and explicit saves.
let repoMode=false,repoFiles=new Map(),csrf='';
async function repoApi(url,options={}){
 const response=await fetch('/api/lifeide'+url,{credentials:'same-origin',...options,headers:{...(options.body?{'content-type':'application/json','x-csrf-token':csrf}:{}),...(options.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.message||'Repository request failed.');
 return data;
}
async function treeFolder(prefix='',depth=0){
 const result=await repoApi('/tree'+(prefix?'?path='+encodeURIComponent(prefix):''));
 for(const item of result.items){
  const rel=prefix?prefix+'/'+item.name:item.name;
  const button=document.createElement('button');
  button.type='button';button.className='node';
  button.style.paddingLeft=(8+depth*15)+'px';
  const label=document.createElement('span');label.className='name';label.textContent=(item.type==='folder'?'📁 ':'▤ ')+item.name;
  button.append(label);
  button.onclick=async()=>{try{if(item.type==='folder'){const existing=button.nextElementSibling;if(button.dataset.expanded==='yes'){while(button.nextElementSibling?.dataset.parent===rel)button.nextElementSibling.remove();button.dataset.expanded='no';}else{const entries=await repoApi('/tree?path='+encodeURIComponent(rel));let after=button;for(const entry of entries.items){const child=document.createElement('button');child.type='button';child.className='node';child.dataset.parent=rel;child.style.paddingLeft=(23+depth*15)+'px';child.textContent=(entry.type==='folder'?'📁 ':'▤ ')+entry.name;child.onclick=()=>entry.type==='file'?openRepoFile(rel+'/'+entry.name):$('status').textContent='Open nested folders from repository root';after.after(child);after=child;}button.dataset.expanded='yes';}}else await openRepoFile(rel);}catch(e){$('status').textContent=e.message;}};
  $('tree').append(button);
 }
}
async function openRepoFile(rel){
 const file=await repoApi('/file?path='+encodeURIComponent(rel));
 repoFiles.set(rel,file);current=rel;
 $('editor').disabled=false;$('editor').value=file.content;
 $('fileTitle').textContent=rel;$('language').textContent=(rel.split('.').pop()||'txt').toUpperCase();
 $('tabs').replaceChildren();updateLines();
 $('status').textContent='Repository file opened • Cmd/Ctrl+S to save';
}
async function repositoryConnect(){
 if(repoMode){repoMode=false;current=null;opened=[];renderTree();emptyEditor();$('modeLabel').textContent='LOCAL WORKSPACE';$('storageInfo').textContent='Files are saved in this browser only.';$('repositoryMode').textContent='Repository';$('newFile').disabled=false;$('newFolder').disabled=false;return;}
 try{
  const r=await fetch('/api/auth/status',{credentials:'same-origin'});const auth=await r.json();
  if(!auth.user||auth.user.role_id!=='admin')throw Error('Sign into LIFEGEN Admin with an administrator account.');
  csrf=auth.csrf_token;
  $('tree').replaceChildren();await treeFolder();
  repoMode=true;current=null;emptyEditor();$('modeLabel').textContent='REPOSITORY';$('storageInfo').textContent='Real files • Save explicitly (Cmd/Ctrl+S).';$('repositoryMode').textContent='Local Workspace';$('newFile').disabled=true;$('newFolder').disabled=true;
 }catch(e){$('status').textContent=e.message;}
}
$('repositoryMode').addEventListener('click',repositoryConnect);
$('editor').addEventListener('input',()=>{if(repoMode)$('status').textContent='Unsaved repository changes';});
document.addEventListener('keydown',async e=>{
 if(!repoMode||!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='s')return;
 e.preventDefault();
 const f=repoFiles.get(current);if(!f)return;
 try{
  const result=await repoApi('/file',{method:'PUT',body:JSON.stringify({path:current,content:$('editor').value,version:f.version})});
  f.version=result.version;f.content=$('editor').value;$('status').textContent='Saved to local repository';
 }catch(err){$('status').textContent='Save failed: '+err.message;}
},true);
renderTree();emptyEditor();
})();
