(() => {
'use strict';
const KEY='lifegen.lifeide.workspace.v1';
const initial=[
{id:'welcome',parent:null,name:'README.md',type:'file',content:'# Welcome to LifeIDE!\n\nThis is a browser-local coding workspace.\nYour changes do not modify the deployed LIFEGEN website.\n',modified:Date.now()},
{id:'examples',parent:null,name:'examples',type:'folder',modified:Date.now()},
{id:'sample',parent:'examples',name:'hello.js',type:'file',content:'// LifeIDE example\nconsole.log("Hello LIFEGEN!");\n',modified:Date.now()}];
const $=id=>document.getElementById(id);
let items=load(),current=null,opened=[],sort='name',size=14,expanded=new Set(['examples']),selectedFolder=null,dialogAction=null;
function load(){try{const data=JSON.parse(localStorage.getItem(KEY));if(Array.isArray(data)&&data.every(x=>typeof x.id==='string'&&typeof x.name==='string'&&['file','folder'].includes(x.type)))return data;}catch{}return structuredClone(initial);}
function save(){try{localStorage.setItem(KEY,JSON.stringify(items));$('status').textContent='Saved locally';}catch{$('status').textContent='Storage full — copy your changes';}}
function node(id){return items.find(x=>x.id===id);}
function pathOf(x){let parts=[x.name],p=x.parent,steps=0;while(p&&steps++<30){const n=node(p);if(!n)break;parts.unshift(n.name);p=n.parent;}return parts.join('/');}
function siblings(parent){return items.filter(x=>x.parent===parent).sort((a,b)=>a.type===b.type?(sort==='name'?a.name.localeCompare(b.name):b.modified-a.modified):a.type==='folder'?-1:1);}
function renderTree(){const root=$('tree');const query=$('explorerSearch').value.trim().toLocaleLowerCase();const visible=f=>!query||pathOf(f).toLocaleLowerCase().includes(query)||(f.type==='folder'&&items.some(x=>pathOf(x).toLocaleLowerCase().includes(query)&&pathOf(x).startsWith(pathOf(f)+'/')));$('workspaceRoot').setAttribute('aria-pressed',String(selectedFolder===null));root.replaceChildren();function visit(parent,depth){for(const f of siblings(parent)){if(!visible(f))continue;const button=document.createElement('button');button.type='button';button.className='node'+(current===f.id||selectedFolder===f.id?' selected':'');button.dataset.entryId=f.id;button.setAttribute('aria-label',(f.type==='folder'?'Folder ':'File ')+pathOf(f));if(f.type==='folder')button.setAttribute('aria-expanded',String(expanded.has(f.id)));button.style.paddingLeft=(7+depth*15)+'px';const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent=f.type==='folder'?(expanded.has(f.id)?'▾':'▸'):' ';const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=f.type==='folder'?'📁':'▤';const name=document.createElement('span');name.className='name';name.textContent=f.name;button.append(arrow,glyph,name);button.title=pathOf(f);button.addEventListener('click',()=>{if(f.type==='folder'){selectedFolder=f.id;expanded.has(f.id)?expanded.delete(f.id):expanded.add(f.id);renderTree();root.querySelectorAll('.node').forEach(b=>{if(b.dataset.entryId===f.id)b.focus();});}else select(f.id);});button.addEventListener('contextmenu',ev=>{ev.preventDefault();if(confirm('Delete '+pathOf(f)+'? This cannot be undone.'))remove(f.id);});const entry=document.createElement('div');entry.className='explorer-entry';entry.append(button);if(f.type==='folder'&&!repoMode){const rename=document.createElement('button');rename.type='button';rename.className='folder-rename';rename.setAttribute('aria-label','Rename folder '+f.name);rename.textContent='✎';rename.addEventListener('click',()=>openDialog('Rename Folder','New folder name',async name=>renameLocal(f.id,name),f.name));entry.append(rename);}if(!repoMode){const del=document.createElement('button');del.type='button';del.className='entry-delete';del.setAttribute('aria-label','Delete '+f.type+' '+pathOf(f));del.title='Delete '+pathOf(f);del.textContent='×';del.addEventListener('click',()=>{if(confirm('Delete '+pathOf(f)+'? This cannot be undone.'))remove(f.id);});entry.append(del);}root.append(entry);if(f.type==='folder'&&(expanded.has(f.id)||query))visit(f.id,depth+1);}}visit(null,0);}
// Standard Explorer arrow keys, scoped to browser-local entries only.
$('tree').addEventListener('keydown',e=>{
 if(repoMode||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 const active=e.target.closest('button.node');
 if(!active||!$('tree').contains(active))return;
 const visible=[...$('tree').querySelectorAll('button.node')];
 const index=visible.indexOf(active);
 if(index<0)return;
 const selected=node(active.dataset.entryId);
 if(!selected)return;
 const focusId=id=>{const target=[...$('tree').querySelectorAll('button.node')].find(b=>b.dataset.entryId===id);target?.focus();};
 let target;
 if(e.key==='ArrowDown')target=visible[Math.min(index+1,visible.length-1)];
 else if(e.key==='ArrowUp')target=visible[Math.max(index-1,0)];
 else if(e.key==='Home')target=visible[0];
 else if(e.key==='End')target=visible.at(-1);
 else if(e.key==='ArrowRight'&&selected.type==='folder'){
  if(!expanded.has(selected.id)){expanded.add(selected.id);renderTree();focusId(selected.id);}
  else if(visible[index+1]&&node(visible[index+1].dataset.entryId)?.parent===selected.id)target=visible[index+1];
 }else if(e.key==='ArrowLeft'){
  if(selected.type==='folder'&&expanded.has(selected.id)){expanded.delete(selected.id);renderTree();focusId(selected.id);}
  else if(selected.parent)target=visible.find(b=>b.dataset.entryId===selected.parent);
 }
 e.preventDefault();
 target?.focus();
});
function select(id){const f=node(id);if(!f||f.type!=='file')return;current=id;selectedFolder=f.parent;$('renameFile').disabled=repoMode;if(!opened.includes(id))opened.push(id);$('editor').disabled=false;$('editor').value=f.content||'';$('fileTitle').textContent=pathOf(f);$('language').textContent=(f.name.split('.').pop()||'txt').toUpperCase();renderTabs();renderTree();if(document.activeElement===document.body||document.activeElement===$('tree')){const target=[...$('tree').querySelectorAll('button.node')].find(b=>b.dataset.entryId===id);target?.focus();}updateLines();}
function renderTabs(){const container=$('tabs');container.replaceChildren();for(const id of opened){const f=node(id);if(!f)continue;const tab=document.createElement('div');tab.className='tab'+(id===current?' active':'');const open=document.createElement('button');open.type='button';open.className='tab-open';open.textContent=f.name;open.addEventListener('click',()=>select(id));const close=document.createElement('button');close.type='button';close.className='close';close.textContent='×';close.setAttribute('aria-label','Close '+f.name);close.addEventListener('click',e=>{e.stopPropagation();opened=opened.filter(x=>x!==id);if(id===current){current=null;if(opened.length)select(opened[opened.length-1]);else emptyEditor();}renderTabs();renderTree();});tab.append(open,close);container.append(tab);}}
function emptyEditor(){$('renameFile').disabled=true;$('editor').value='# Welcome to LifeIDE!\n# Select a file to begin.';$('editor').disabled=true;$('fileTitle').textContent='No file selected';$('language').textContent='Plain text';updateLines();}
function updateLines(){const el=$('editor'),lines=el.value.split('\n').length;$('lineNumbers').textContent=Array.from({length:lines},(_,i)=>i+1).join('\n');const pos=el.selectionStart,preceding=el.value.slice(0,pos).split('\n');$('position').textContent='Ln '+preceding.length+', Col '+(preceding.at(-1).length+1);$('lineNumbers').scrollTop=el.scrollTop;}
function openDialog(title,label,action,prefill=''){dialogAction=action;$('dialogTitle').textContent=title;$('dialogLabel').textContent=label;$('dialogInput').value=prefill;$('dialogError').textContent='';$('dialog').hidden=false;$('dialogInput').focus();}
function closeDialog(){$('dialog').hidden=true;dialogAction=null;}
function chosenParent(){const folder=node(selectedFolder);return folder?.type==='folder'?folder.id:null;}
function create(type,name,parent){if(!/^[^\\/\x00-\x1f]+$/.test(name)||name==='.'||name==='..'||name.trim()!==name)throw Error('Use a valid file or folder name.');if(items.some(x=>x.parent===parent&&x.name.toLowerCase()===name.toLowerCase()))throw Error('A file or folder with that name already exists.');const id='item-'+crypto.randomUUID();items.push({id,parent,name,type,content:type==='file'?'':'',modified:Date.now()});if(parent)expanded.add(parent);save();renderTree();if(type==='file')select(id);}
function renameLocal(id,name){
 const f=node(id);
 if(!f||repoMode)throw Error('Select a browser-local file or folder to rename.');
 if(!name||name.trim()!==name||! /^[^\\/\x00-\x1f]+$/.test(name)||name==='.'||name==='..')throw Error('Use a valid file or folder name.');
 if(items.some(x=>x.id!==id&&x.parent===f.parent&&x.name.toLowerCase()===name.toLowerCase()))throw Error('A file or folder with that name already exists.');
 f.name=name;f.modified=Date.now();save();
 if(current&&node(current)){$('fileTitle').textContent=pathOf(node(current));if(current===id)$('language').textContent=(name.split('.').pop()||'txt').toUpperCase();}
 renderTabs();renderTree();
}
$('renameFile').addEventListener('click',()=>{if(repoMode||!node(current))return;const id=current;openDialog('Rename File','New file name',async name=>renameLocal(id,name),node(id).name);});
function remove(id){
 const tree=$('tree'),active=document.activeElement;
 const entries=[...tree.querySelectorAll('button.node')];
 const focusedEntry=active?.closest?.('.explorer-entry');
 const restoreFocus=Boolean(focusedEntry&&tree.contains(focusedEntry));
 const focusedIndex=entries.findIndex(b=>focusedEntry?.contains(b));
 const descendants=new Set([id]);let changed=true;while(changed){changed=false;for(const x of items)if(descendants.has(x.parent)&&!descendants.has(x.id)){descendants.add(x.id);changed=true;}}items=items.filter(x=>!descendants.has(x.id));if(descendants.has(selectedFolder))selectedFolder=null;opened=opened.filter(x=>!descendants.has(x));if(descendants.has(current)){current=null;if(opened.length)select(opened[opened.length-1]);else emptyEditor();}save();renderTabs();renderTree();if(restoreFocus){
 const remaining=[...tree.querySelectorAll('button.node')];
 (remaining[Math.min(Math.max(0,focusedIndex),remaining.length-1)]||$('workspaceRoot')).focus();
 }}
$('workspaceRoot').addEventListener('click',()=>{if(repoMode)return;selectedFolder=null;renderTree();$('status').textContent='New entries will be created at the workspace root';});
$('newFile').addEventListener('click',()=>openDialog('New File','File name',async name=>{if(repoMode)return createRepoEntry('file',name);create('file',name,chosenParent());}));
$('newFolder').addEventListener('click',()=>openDialog('New Folder','Folder name',async name=>{if(repoMode)return createRepoEntry('folder',name);create('folder',name,chosenParent());}));
$('dialogForm').addEventListener('submit',async e=>{e.preventDefault();try{await dialogAction($('dialogInput').value);closeDialog();}catch(error){$('dialogError').textContent=error.message;}});
$('cancel').addEventListener('click',closeDialog);
$('dialog').addEventListener('click',e=>{if(e.target===$('dialog'))closeDialog();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDialog();if(!repoMode&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();}});
$('editor').addEventListener('input',()=>{const f=repoMode?null:node(current);if(f){f.content=$('editor').value;f.modified=Date.now();save();}updateLines();});
$('editor').addEventListener('click',updateLines);
$('editor').addEventListener('keyup',updateLines);
$('editor').addEventListener('scroll',()=>{$('lineNumbers').scrollTop=$('editor').scrollTop;});
$('editor').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const el=e.target,start=el.selectionStart,end=el.selectionEnd;el.setRangeText('  ',start,end,'end');el.dispatchEvent(new Event('input'));}});
function filterRepoTree(){
 const term=$('explorerSearch').value.trim().toLowerCase();
 for(const el of $('tree').querySelectorAll('.node'))el.hidden=Boolean(term&&!el.title.toLowerCase().includes(term));
}
$('explorerSearch').addEventListener('input',()=>{if(repoMode)filterRepoTree();else renderTree();});
$('sortName').addEventListener('click',()=>{sort='name';$('sortName').classList.add('active');$('sortDate').classList.remove('active');if(!repoMode)renderTree();});
$('sortDate').addEventListener('click',()=>{sort='date';$('sortDate').classList.add('active');$('sortName').classList.remove('active');if(!repoMode)renderTree();});
$('collapse').addEventListener('click',()=>$('sidebar').classList.toggle('collapsed'));
$('smaller').addEventListener('click',()=>{size=Math.max(11,size-1);setSize();});
$('larger').addEventListener('click',()=>{size=Math.min(24,size+1);setSize();});
function setSize(){$('editor').style.fontSize=size+'px';$('lineNumbers').style.fontSize=size+'px';}
$('refresh').addEventListener('click',()=>{if(repoMode){if(saveBusy||commitBusy){$('status').textContent='Finish the pending save or commit before refreshing.';return;}if(repoDirty&&!confirm('Discard unsaved changes and reload repository?'))return;repoDirty=false;repoExpanded.clear();repoParent='';if(githubMode){githubTreeIndex=null;githubTreePending=null;}repoFiles.clear();selectedGit.clear();$('commit').disabled=true;current=null;$('tabs').replaceChildren();treeFolder().catch(e=>$('status').textContent=e.message);emptyEditor();return;}items=load();if(!node(selectedFolder)||node(selectedFolder)?.type!=='folder')selectedFolder=null;opened=opened.filter(x=>node(x));if(current&&node(current))select(current);else emptyEditor();renderTree();});

// Repository mode uses authenticated same-origin APIs and explicit saves.
let repoMode=false,githubMode=false,githubEditing=false,repoFiles=new Map(),csrf='',selectedGit=new Set(),repoDirty=false,commitBusy=false,saveBusy=false;
const draftKey=path=>'lifegen.lifeide.github-draft.v1:'+path;
function githubEditControls(open=false){
 $('editGithub').hidden=!githubMode||!open;
 $('saveGithubDraft').hidden=!githubMode||!open;
 $('publishGithub').hidden=!githubMode||!open;
 $('githubNative').hidden=!githubMode||!open;
 $('editGithub').textContent=githubEditing?'Stop editing':'Edit source';
 $('saveGithubDraft').disabled=!githubEditing;
 $('publishGithub').disabled=!githubEditing;
}
$('editGithub').addEventListener('click',()=>{
 if(!githubMode||!current)return;
 if(githubEditing){
  if(repoDirty&&!confirm('Discard unsaved edits? Save a draft first if you want to keep them.'))return;
  githubEditing=false;repoDirty=false;
  $('editor').value=repoFiles.get(current)?.content||'';
  $('editor').disabled=true;
 }else{
  githubEditing=true;$('editor').disabled=false;$('editor').focus();
 }
 githubEditControls(true);updateLines();
 $('status').textContent=githubEditing?'Editing draft — no changes have been committed to GitHub':'GitHub source is read-only';
});
$('saveGithubDraft').addEventListener('click',()=>{
 if(!githubMode||!githubEditing||!current)return;
 try{
  localStorage.setItem(draftKey(current),JSON.stringify({content:$('editor').value,base:repoFiles.get(current)?.version,updated:Date.now()}));
  repoDirty=false;$('status').textContent='Draft saved in this browser. Not committed to GitHub.';
 }catch(error){$('status').textContent='Unable to save draft: '+error.message;}
});
$('publishGithub').addEventListener('click',async()=>{
 if(!githubMode||!githubEditing||!current)return;
 const file=current,content=$('editor').value;
 if(!confirm('Continue editing '+file+' on GitHub? Your draft will be copied. Paste it into GitHub and commit to a NEW branch, not main.'))return;
 try{
  localStorage.setItem(draftKey(file),JSON.stringify({content,base:repoFiles.get(file)?.version,updated:Date.now()}));
  const url='https://github.com/bojbrnrdo/Lifegen/edit/main/'+file.split('/').map(encodeURIComponent).join('/');
  window.open(url,'_blank','noopener,noreferrer');
  try{
   await navigator.clipboard.writeText(content);
   repoDirty=false;$('status').textContent='Draft copied. Paste into GitHub editor, commit to a NEW branch, and create a pull request.';
  }catch(error){$('status').textContent='GitHub opened, but clipboard permission was blocked. Copy your draft from the editor manually.';}
 }catch(error){$('status').textContent='Could not prepare the GitHub handoff: '+error.message;}
});

// Native GitHub writes require the existing isolated-preview developer API.
// Production never obtains write privileges or uses browser-stored tokens.
let devWriteAvailable=false,devBusy=false;
function nativeStatus(message){$('githubWorkflowStatus').textContent=message;}
async function devRequest(route,{method='GET',body}={}){
 const response=await fetch('/api/admin/dev/'+route,{
  method,credentials:'same-origin',cache:'no-store',
  headers:body===undefined?{}:{'content-type':'application/json','x-csrf-token':csrf},
  body:body===undefined?undefined:JSON.stringify(body)
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||result.message||'GitHub developer request failed.');
 return result;
}
$('githubNative').addEventListener('click',async()=>{
 if(!githubMode||!githubEditing||!current||devBusy)return;
 $('githubWorkflow').hidden=false;
 nativeStatus('Checking whether isolated GitHub developer writes are enabled...');
 try{
  const info=await devRequest('status');
  devWriteAvailable=Boolean(info.writesEnabled);
  if(!devWriteAvailable){
   nativeStatus('Direct commits are disabled on this deployment. Use Commit via GitHub to submit the draft safely; production does not have repository write access.');
   return;
  }
  const auth=await fetch('/api/auth/status',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json());
  if(!auth.csrf_token)throw Error('Administrator session is missing a CSRF token. Sign in again.');
  csrf=auth.csrf_token;
  nativeStatus('Connected to isolated development GitHub writes. Create or select a feature/fix branch before committing.');
 }catch(error){devWriteAvailable=false;nativeStatus('GitHub write access unavailable: '+error.message);}
});
$('closeGithubWorkflow').addEventListener('click',()=>{$('githubWorkflow').hidden=true;});
function validWorkingBranch(value){return /^(?:feature|fix)\/[a-zA-Z0-9._-]{1,90}$/.test(value);}
$('createGithubBranch').addEventListener('click',async()=>{
 if(!devWriteAvailable||devBusy){nativeStatus('GitHub writes are not enabled in this environment.');return;}
 const name=$('githubBranch').value.trim();
 if(!validWorkingBranch(name)){nativeStatus('Branch name must begin with feature/ or fix/.');return;}
 if(!confirm('Create branch '+name+' from develop?'))return;
 devBusy=true;$('createGithubBranch').disabled=true;
 try{
  const result=await devRequest('branch',{method:'POST',body:{name}});
  nativeStatus('Created '+result.name+' from develop. Review the file before committing.');
 }catch(error){nativeStatus('Branch creation failed: '+error.message);}
 finally{devBusy=false;$('createGithubBranch').disabled=false;}
});
$('commitGithubDraft').addEventListener('click',async()=>{
 if(!devWriteAvailable||devBusy||!githubMode||!githubEditing||!current){nativeStatus('Open and edit a GitHub source file in an isolated development environment first.');return;}
 const branch=$('githubBranch').value.trim(),message=$('githubCommitMessage').value.trim();
 if(!validWorkingBranch(branch)||message.length<8||message.length>160){nativeStatus('Use a feature/fix branch and a descriptive commit message of 8–160 characters.');return;}
 const file=current,content=$('editor').value;
 if(!confirm('Commit '+file+' to '+branch+'? This will NOT modify main.'))return;
 devBusy=true;$('commitGithubDraft').disabled=true;
 try{
  const remote=await devRequest('file?branch='+encodeURIComponent(branch)+'&path='+encodeURIComponent(file));
  if(!remote.editable)throw Error('This path or branch is protected and cannot be edited.');
  if(content===remote.content)throw Error('No changes compared with the target branch.');
  if(remote.content!==repoFiles.get(file)?.content&&!confirm('This branch has different content from main. Commit your draft over the current branch version?'))return;
  if(file!==current)throw Error('File selection changed while preparing the commit.');
  const result=await devRequest('file',{method:'PUT',body:{branch,path:file,sha:remote.sha,content,message}});
  if(!result.ok)throw Error('GitHub did not acknowledge the commit.');
  try{localStorage.setItem(draftKey(file),JSON.stringify({content,base:repoFiles.get(file)?.version,updated:Date.now()}));}catch{}
  repoDirty=false;nativeStatus('Committed to '+branch+' ('+String(result.commit||'').slice(0,8)+'). Create a draft pull request to request review.');
 }catch(error){nativeStatus('Commit failed: '+error.message);}
 finally{devBusy=false;$('commitGithubDraft').disabled=false;}
});
$('submitGithubPr').addEventListener('click',async()=>{
 if(!devWriteAvailable||devBusy){nativeStatus('Direct GitHub PR creation is available only in an isolated development environment.');return;}
 const branch=$('githubBranch').value.trim(),title=$('githubPrTitle').value.trim();
 if(!validWorkingBranch(branch)||title.length<8||title.length>120){nativeStatus('Select a feature/fix branch and a title of 8–120 characters.');return;}
 if(!confirm('Create a DRAFT pull request from '+branch+' into develop?'))return;
 devBusy=true;$('submitGithubPr').disabled=true;
 try{
  const result=await devRequest('pull-request',{method:'POST',body:{branch,title,description:'Prepared in LifeIDE for review. Source file: '+(current||'unspecified')+'. Please validate changes before merging.'}});
  nativeStatus('Draft pull request created: '+result.url+' — review before merging.');
  if(result.url&&new URL(result.url).hostname==='github.com')window.open(result.url,'_blank','noopener,noreferrer');
 }catch(error){nativeStatus('Pull request creation failed: '+error.message);}
 finally{devBusy=false;$('submitGithubPr').disabled=false;}
});
async function repoApi(url,options={}){
 const response=await fetch('/api/lifeide'+(githubMode?'/remote':'')+url,{credentials:'same-origin',...options,headers:{...(options.body?{'content-type':'application/json','x-csrf-token':csrf}:{}),...(options.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.message||'Repository request failed.');
 return data;
}
let repoExpanded=new Set(),repoParent='';
let githubTreeIndex=null,githubTreePending=null;
async function loadGithubTree(){
 if(githubTreeIndex)return githubTreeIndex;
 if(githubTreePending)return githubTreePending;
 githubTreePending=(async()=>{
  const result=await repoApi('/index');
  if(!Array.isArray(result.paths))throw Error('Invalid GitHub repository tree response.');
  const children=new Map();
  for(const entry of result.paths){
   if(typeof entry.path!=='string'||!['file','folder'].includes(entry.type))continue;
   const parts=entry.path.split('/'),name=parts.pop(),parent=parts.join('/');
   if(!name)continue;
   if(!children.has(parent))children.set(parent,[]);
   children.get(parent).push({name,type:entry.type});
  }
  for(const items of children.values())items.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='folder'?-1:1);
  githubTreeIndex=children;
  return children;
 })();
 try{return await githubTreePending;}finally{githubTreePending=null;}
}
async function treeFolder(){
 const tree=$('tree');
 // Fetch the complete GitHub tree once, before rebuilding any visible rows.
 // Folder toggles thereafter only touch cached browser elements.
 const indexed=githubMode?await loadGithubTree():null;
 tree.replaceChildren();
 async function appendFolder(prefix,depth,container){
  const result=githubMode?{items:indexed.get(prefix)||[]}:
   await repoApi('/tree'+(prefix?'?path='+encodeURIComponent(prefix):''));
  const fragment=document.createDocumentFragment();
  for(const entry of result.items){
   const rel=prefix?prefix+'/'+entry.name:entry.name;
   const wrapper=document.createElement('div');wrapper.className='repo-tree-entry';
   const el=document.createElement('button');el.type='button';el.className='node';
   el.style.paddingLeft=(8+depth*15)+'px';el.title=rel;
   el.setAttribute('aria-label',entry.type+' '+rel);
   const arrow=document.createElement('span');arrow.className='arrow';
   arrow.textContent=entry.type==='folder'?'▸':' ';
   const name=document.createElement('span');name.className='name';
   name.textContent=(entry.type==='folder'?'📁 ':'▤ ')+entry.name;
   el.append(arrow,name);wrapper.append(el);
   if(entry.type==='folder'){
    const children=document.createElement('div');children.className='repo-children';children.hidden=true;
    el.setAttribute('aria-expanded','false');
    wrapper.append(children);
    let loaded=false,loading=false;
    const toggle=async()=>{
     if(loading)return;
     repoParent=rel;
     if(repoExpanded.has(rel)){
      repoExpanded.delete(rel);
      children.hidden=true;
      arrow.textContent='▸';el.setAttribute('aria-expanded','false');
      return;
     }
     loading=true;arrow.textContent='…';el.setAttribute('aria-busy','true');
     try{
      if(!loaded){await appendFolder(rel,depth+1,children);loaded=true;}
      repoExpanded.add(rel);
      children.hidden=false;arrow.textContent='▾';el.setAttribute('aria-expanded','true');
      filterRepoTree();
     }catch(error){
      children.hidden=true;arrow.textContent='▸';
      $('status').textContent='Unable to open '+rel+': '+error.message;
     }finally{loading=false;el.removeAttribute('aria-busy');}
    };
    el.addEventListener('click',toggle);
    if(repoExpanded.has(rel)){
     // Restore open folders after explicit Explorer refresh without changing the other rows.
     try{
      await appendFolder(rel,depth+1,children);loaded=true;
      children.hidden=false;arrow.textContent='▾';el.setAttribute('aria-expanded','true');
     }catch(error){repoExpanded.delete(rel);$('status').textContent=error.message;}
    }
   }else{
    el.addEventListener('click',async()=>{
     try{
      await openRepoFile(rel);
      tree.querySelectorAll('.node.selected').forEach(n=>n.classList.remove('selected'));
      el.classList.add('selected');
     }catch(error){$('status').textContent=error.message;}
    });
   }
   fragment.append(wrapper);
  }
  container.append(fragment);
 }
 await appendFolder('',0,tree);
 filterRepoTree();
}
async function createRepoEntry(type,name){
 if(githubMode)throw Error('GitHub files are read-only. Switch to Local Workspace to create files.');
 if(saveBusy||commitBusy)throw Error('Finish the pending save or commit before creating files.');
 if(repoDirty)throw Error('Save or discard your current repository edits before creating another entry.');
 if(!name||name.startsWith('.')||name==='..'||name.includes('/')||name.includes('\\')||name.trim()!==name)throw Error('Invalid name');
 const rel=repoParent?repoParent+'/'+name:name;
 await repoApi('/entry',{method:'POST',body:JSON.stringify({path:rel,type})});
 if(type==='folder')repoExpanded.add(rel);
 await treeFolder();
 if(type==='file')await openRepoFile(rel);
 $('status').textContent=type+' created in local repository';
}
async function openRepoFile(rel){
 if(saveBusy||commitBusy){$('status').textContent='Finish the pending save or commit before changing files.';return;}
 if(repoMode&&repoDirty&&!confirm('Discard unsaved changes to the current repository file?'))return;
 const file=await repoApi('/file?path='+encodeURIComponent(rel));
 selectedGit.clear();$('commit').disabled=true;
 repoFiles.set(rel,file);current=rel;repoDirty=false;
 githubEditing=false;githubEditControls(true);
 $('editor').disabled=githubMode;$('editor').value=file.content;
 if(githubMode){
  try{
   const saved=JSON.parse(localStorage.getItem(draftKey(rel))||'null');
   if(saved&&typeof saved.content==='string'&&saved.content!==file.content&&saved.base===file.version&&confirm('A browser draft exists for '+rel+'. Restore it?')){
    githubEditing=true;$('editor').disabled=false;$('editor').value=saved.content;
    githubEditControls(true);
   }
  }catch{}
 }
 $('fileTitle').textContent=rel;$('language').textContent=(rel.split('.').pop()||'txt').toUpperCase();
 $('tabs').replaceChildren();updateLines();
 $('status').textContent=githubMode?(githubEditing?'Draft restored; not committed to GitHub':'GitHub main · choose Edit source to change a draft'):'Repository file opened • Cmd/Ctrl+S to save';
}
async function connectGithubSource(){
 if(repoMode||githubMode)return;
 const response=await fetch('/api/auth/status',{credentials:'same-origin'});
 const auth=await response.json().catch(()=>({}));
 if(!response.ok||auth.user?.role_id!=='admin')throw Error('Sign into LIFEGEN Admin as an administrator to view project files.');
 githubMode=true;
 try{
  await treeFolder();
  repoMode=true;
  current=null;opened=[];repoFiles.clear();emptyEditor();githubEditing=false;githubEditControls(false);
  $('workspaceRoot').hidden=true;
  $('modeLabel').textContent='GITHUB · MAIN';
  $('storageInfo').textContent='bojbrnrdo/Lifegen · main · read-only';
  $('repositoryMode').textContent='Local Workspace';
  $('newFile').disabled=true;$('newFolder').disabled=true;
  $('renameFile').disabled=true;$('commit').disabled=true;$('gitChanges').disabled=true;
  $('status').textContent='Connected to LIFEGEN GitHub files · read-only';
 }catch(error){githubMode=false;renderTree();throw error;}
}
async function repositoryConnect(){
 if(saveBusy||commitBusy){$('status').textContent='Finish the pending save or commit before switching workspaces.';return;}
 if(repoMode){if(repoDirty&&!confirm('Discard unsaved repository changes and switch workspace?'))return;repoMode=false;githubMode=false;githubEditing=false;githubEditControls(false);githubTreeIndex=null;githubTreePending=null;$('githubWorkflow').hidden=true;devWriteAvailable=false;repoDirty=false;repoFiles.clear();selectedFolder=null;$('workspaceRoot').hidden=false;$('renameFile').disabled=!node(current);repoExpanded.clear();repoParent='';$('tabs').replaceChildren();selectedGit.clear();$('commit').disabled=true;current=null;opened=[];renderTree();emptyEditor();$('modeLabel').textContent='LOCAL WORKSPACE';$('storageInfo').textContent='Files are saved in this browser only.';$('repositoryMode').textContent=new URLSearchParams(location.search).get('source')==='github'?'GitHub Files':'Repository';$('newFile').disabled=false;$('newFolder').disabled=false;$('gitChanges').disabled=false;return;}
 if(new URLSearchParams(location.search).get('source')==='github'){try{await connectGithubSource();}catch(error){$('status').textContent=error.message;}return;}
 try{
  const r=await fetch('/api/auth/status',{credentials:'same-origin'});const auth=await r.json();
  if(!auth.user||auth.user.role_id!=='admin')throw Error('Sign into LIFEGEN Admin with an administrator account.');
  csrf=auth.csrf_token;
  $('tree').replaceChildren();
  try{await treeFolder();}catch(error){renderTree();throw error;}
  repoMode=true;$('workspaceRoot').hidden=true;current=null;emptyEditor();$('modeLabel').textContent='REPOSITORY';$('storageInfo').textContent='Real files • Save explicitly (Cmd/Ctrl+S).';$('repositoryMode').textContent='Local Workspace';$('newFile').disabled=false;$('newFolder').disabled=false;
 }catch(e){$('status').textContent=e.message;}
}
$('repositoryMode').addEventListener('click',repositoryConnect);
$('gitChanges').addEventListener('click',async()=>{
 if(githubMode){$('status').textContent='GitHub main is read-only. Git changes require a local development workspace.';return;}
 if(!repoMode){$('status').textContent='Switch to Repository mode to view Git changes.';return;}
 if(saveBusy||commitBusy){$('status').textContent='Finish the pending save or commit before reviewing Git changes.';return;}
 try{
  if(repoDirty&&!confirm('Discard unsaved changes to review Git status?'))return;
  repoDirty=false;current=null;repoFiles.clear();emptyEditor();
  const result=await repoApi('/git/status');
  const entries=result.entries.filter(x=>!x.path.includes('.env')&&!x.path.startsWith('.git'));
  const view=$('tabs');view.replaceChildren();selectedGit.clear();$('commit').disabled=true;
  if(!entries.length){$('status').textContent='Git working tree is clean';return;}
  for(const entry of entries){
   const check=document.createElement('input');check.type='checkbox';check.title='Include '+entry.path+' in commit';check.setAttribute('aria-label','Stage '+entry.path);check.onchange=()=>{check.checked?selectedGit.add(entry.path):selectedGit.delete(entry.path);$('commit').disabled=selectedGit.size===0;};view.append(check);
   const b=document.createElement('button');b.className='tab';b.type='button';b.textContent=entry.status+' '+entry.path;
   b.onclick=async()=>{try{
    const response=await repoApi('/git/diff?path='+encodeURIComponent(entry.path));
    $('editor').value=response.diff||'No unstaged diff for this file (it may be staged or untracked).';
    $('editor').disabled=true;$('fileTitle').textContent='Diff: '+entry.path;current=null;updateLines();
   }catch(e){$('status').textContent=e.message;}};
   view.append(b);
  }
  $('status').textContent=entries.length+' changed file(s) in Git. Select files to commit.';
 }catch(e){$('status').textContent=e.message;}
});
$('commit').addEventListener('click',async()=>{
 if(commitBusy||!repoMode||githubMode||!selectedGit.size)return;
 if(saveBusy){$('status').textContent='Wait for the current save to finish before committing.';return;}
 if(repoDirty){$('status').textContent='Save or discard unsaved changes before committing.';return;}
 const paths=[...selectedGit];
 const message=prompt('Commit message for '+paths.length+' selected file(s):');
 if(message===null)return;
 if(!confirm('Commit ONLY these files locally?\n'+paths.join('\n')))return;
 commitBusy=true;$('commit').disabled=true;
 try{
  const result=await repoApi('/git/commit',{method:'POST',body:JSON.stringify({paths,message})});
  selectedGit.clear();$('commit').disabled=true;$('status').textContent='Created local commit '+result.commit+' on '+result.branch;
  $('gitChanges').click();
 }catch(e){$('status').textContent='Commit rejected: '+e.message;}
 finally{commitBusy=false;$('commit').disabled=!repoMode||selectedGit.size===0;}
});
$('editor').addEventListener('input',()=>{if(repoMode){repoDirty=true;$('status').textContent=githubMode?'Unsaved GitHub draft — Save draft before switching files':'Unsaved repository changes';}});
document.addEventListener('keydown',async e=>{
 if(!repoMode||githubMode||!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='s')return;
 e.preventDefault();
 if(saveBusy)return;
 const path=current,f=repoFiles.get(path);if(!f)return;
 const content=$('editor').value;
 saveBusy=true;
 try{
  const result=await repoApi('/file',{method:'PUT',body:JSON.stringify({path,content,version:f.version})});
  f.version=result.version;f.content=content;
  if(current===path&&$('editor').value===content){repoDirty=false;$('status').textContent='Saved to local repository';}
  else $('status').textContent='File saved; newer edits remain unsaved.';
 }catch(err){$('status').textContent='Save failed: '+err.message;}
 finally{saveBusy=false;}
},true);
renderTree();emptyEditor();
if(new URLSearchParams(location.search).get('source')==='github')connectGithubSource().catch(error=>{$('status').textContent='GitHub connection failed: '+error.message;});
})();
