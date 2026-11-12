import {esc} from '../ui.js';
import {devRequest} from '../api.js';

const api=devRequest;
const heading=(title,subtitle)=>`<div class="page-header"><div><h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p></div></div>`;
const offline=(data)=>!data.connected?'<div class="alert alert--info">GitHub integration is not yet configured on the server. Ask the administrator to configure LIFEGEN_GITHUB_DEV_TOKEN with repository Contents and Actions permissions. Never enter tokens in this page.</div>':'';
const writeNotice=data=>data.connected&&!data.writesEnabled?'<div class="alert alert--info">GitHub is connected read-only. Git writes require an isolated development deployment and LIFEGEN_DEV_WRITES_ENABLED=true. Production always blocks Git writes.</div>':'';
const field=`<label for="devBranch">Working branch</label><input id="devBranch" class="input" value="develop" autocomplete="off" spellcheck="false"/><span class="help">Use develop, feature/* or fix/* branches. Main is protected.</span>`;

export async function renderDevGit({main}){
 const repoUrl='https://github.com/bojbrnrdo/Lifegen';
 main.innerHTML=heading('Git Version Control','LIFEGEN repository management')+'<div class="card"><div class="card__body">Loading GitHub connection…</div></div>';
 let info;
 try{info=await api('status');}catch(e){main.innerHTML='<div class="alert alert--info">'+esc(e.message)+'</div>';return;}
 const connected=Boolean(info.connected),writable=Boolean(info.writesEnabled);
 main.innerHTML=heading('Git Version Control','Manage source control and development branches')+
 `<div class="devgit">
  <section class="card devgit__section"><div class="card__header"><h2>GitHub Cloud Sync</h2></div><div class="card__body">
   <p><b>Remote Repository:</b> <a href="${repoUrl}" rel="noopener noreferrer" target="_blank">${repoUrl}</a></p>
   <p><b>Sync Status:</b> <span id="gitSync">${connected?'Connected':'Disconnected'}</span></p>
   <p><b>Current Branch:</b> <strong id="gitBranchLabel">develop</strong></p>
   <div class="devgit__buttons">
    <button class="btn" id="gitPull" ${connected?'':'disabled'}>↻ Refresh Remote</button>
    <button class="btn" id="gitOpenBranchFile" ${connected?'':'disabled'}>Open Branch File</button>
    <button class="btn" id="gitPush" ${writable?'':'disabled'}>Open IDE to Commit</button>
    <button class="btn" id="gitCreateBranch" ${writable?'':'disabled'}>Create Branch</button>
    <label>Change Branch <select class="input" id="gitBranchSelect" ${connected?'':'disabled'}><option>develop</option></select></label>
    <button class="btn" id="gitCreatePr" ${writable?'':'disabled'}>Create Pull Request</button>
   </div>
   <p class="small muted">Refresh retrieves GitHub branch data; no persistent local Git checkout exists on Vercel. Open IDE to Commit uses the separate protected LifeIDE workflow. Neither button performs a Git pull or push. ${writable?'Feature/fix branch writes are enabled.':'Remote writes are disabled.'} Main is protected.</p>
   <p id="gitMessage" role="status" class="small muted"></p>
  </div></section>
  <section class="card devgit__section"><div class="card__header"><h2>Branch Status</h2><button class="btn btn--sm" id="gitCheck" ${connected?'':'disabled'}>✓ Check Status</button></div>
   <div class="card__body"><p class="small muted">Compare remote branch changes against develop.</p>
    <div class="devgit__status" id="gitStatus" role="status">Click Check Status to inspect the selected branch.</div>
   </div></section>
  <section class="card devgit__section"><div class="card__header"><h2>Commit History</h2><button class="btn btn--sm" id="gitReloadHistory" ${connected?'':'disabled'}>Refresh</button></div>
   <div class="card__body"><p class="small muted" id="gitHistoryMessage">Loading commit history…</p><div class="devgit__history" id="gitHistory"></div></div>
  </section>
  <section class="card devgit__section" id="gitPrPanel" hidden><div class="card__header"><h2>Create Draft Pull Request</h2></div>
   <div class="card__body stack"><p class="small muted">Review before merging feature/fix branches into develop. No automatic deployment.</p>
    <label for="gitPrTitle">Title</label><input id="gitPrTitle" class="input" maxlength="120" placeholder="fix: describe the change">
    <label for="gitPrBody">Review notes</label><textarea id="gitPrBody" class="input" rows="3" maxlength="4000"></textarea>
    <div class="row"><button class="btn btn--primary" id="gitSubmitPr">Create draft PR</button><button class="btn" id="gitCancelPr">Cancel</button></div>
    <p class="small muted" role="status" id="gitPrStatus"></p>
   </div></section></div>`;
 const el=id=>main.querySelector('#'+id);
 let branch='develop',revision=0,statusRequest=0,historyRequest=0,refreshRequest=0;
 const note=message=>{el('gitMessage').textContent=message;};
 const check=async()=>{
  const seq=revision,which=branch,request=++statusRequest;
  const host=el('gitStatus');host.textContent='Comparing '+which+' with develop…';
  try{
   const result=await api('branch-status?branch='+encodeURIComponent(which));
   if(seq!==revision||request!==statusRequest)return false;
   host.replaceChildren();
   const text=document.createElement('p');text.textContent=result.branch+' vs develop — '+result.ahead+' ahead, '+result.behind+' behind';host.append(text);
   const status=document.createElement('p');status.className='small muted';status.textContent=result.files.length+' changed files'+(result.truncated?' (first 100 shown)':'');host.append(status);
   for(const file of result.files){
    const row=document.createElement('div');row.className='devgit__file';
    const name=document.createElement('span');name.textContent=file.status+' · '+file.path;
    const counts=document.createElement('span');counts.className='small muted';counts.textContent='+'+file.additions+' / -'+file.deletions;
    row.append(name,counts);host.append(row);
   }
   el('gitSync').textContent=result.behind?'Behind develop':result.ahead?'Ahead of develop':'Up to date with develop';
   return true;
  }catch(e){if(seq===revision&&request===statusRequest){host.textContent=e.message;el('gitSync').textContent='Status unavailable';}return false;}
 };
 const loadHistory=async()=>{
  const seq=revision,which=branch,request=++historyRequest;
  el('gitHistoryMessage').textContent='Loading '+which+' history…';el('gitHistory').replaceChildren();
  try{
   const result=await api('history?branch='+encodeURIComponent(which));
   if(seq!==revision||request!==historyRequest)return false;
   el('gitHistoryMessage').textContent=result.commits.length+' recent commits on '+which;
   for(const c of result.commits){
    const row=document.createElement('div');row.className='devgit__commit';
    const desc=document.createElement('div');desc.className='devgit__detail';
    const hash=document.createElement('a');hash.href=c.url;hash.target='_blank';hash.rel='noopener noreferrer';hash.textContent=c.sha.slice(0,7);
    const title=document.createElement('p');title.textContent=c.subject;
    const author=document.createElement('small');author.className='muted';author.textContent=c.author+' · '+(c.date?new Date(c.date).toLocaleString():'');
    desc.append(hash,title,author);
    const buttons=document.createElement('div');buttons.className='devgit__commit-buttons';
    const diff=document.createElement('a');diff.className='btn btn--sm';diff.textContent='Diff';diff.href=c.url;diff.target='_blank';diff.rel='noopener noreferrer';
    const revert=document.createElement('button');revert.className='btn btn--sm';revert.textContent='Revert';revert.disabled=true;revert.title='Reverts require a reviewed fix branch; direct revert is not yet supported.';
    buttons.append(diff,revert);row.append(desc,buttons);el('gitHistory').append(row);
   }
   return true;
  }catch(e){if(seq===revision&&request===historyRequest)el('gitHistoryMessage').textContent=e.message;return false;}
 };
 const choose=async(value)=>{
  branch=value;revision++;el('gitBranchLabel').textContent=value;
  return Promise.all([check(),loadHistory()]);
 };
 el('gitPull').onclick=async()=>{const request=++refreshRequest;note('Refreshing remote GitHub data…');const seq=revision+1;const results=await choose(branch);if(seq!==revision||request!==refreshRequest)return;note(results.every(Boolean)?'Branch status and history refreshed. No local files were changed.':'Remote refresh incomplete. Review the Branch Status and Commit History errors; no local files were changed.');};
 el('gitCheck').onclick=check;el('gitReloadHistory').onclick=loadHistory;
 el('gitBranchSelect').onchange=e=>choose(e.target.value);
 el('gitOpenBranchFile').onclick=()=>{
  if(!connected)return;
  const selected=branch;
  const path=window.prompt('Open file from '+selected+' (repository-relative path)', 'README.md');
  if(path===null)return;
  const file=path.trim();
  if(!file||file.startsWith('/')||file.includes('\\\\')||file.split('/').some(part=>!part||part==='.'||part==='..')){note('Enter a valid repository-relative file path.');return;}
  note('Opening '+file+' from '+selected+' in LifeIDE…');
  window.location.hash='#/dev/ide?branch='+encodeURIComponent(selected)+'&path='+encodeURIComponent(file);
 };
 el('gitPush').onclick=()=>{if(!writable)return;note('Opening LifeIDE. Saving a draft does not push to GitHub; publishing requires the protected branch workflow.');window.location.hash='#/dev/ide';};
 el('gitCreateBranch').onclick=async()=>{
  if(!writable)return;
  const proposed=window.prompt('Create development branch from develop (feature/name or fix/name)','feature/my-change');
  if(proposed===null)return;
  const name=proposed.trim();
  if(!/^(feature|fix)\/[A-Za-z0-9._-]{1,90}$/.test(name)){note('Use feature/name or fix/name.');return;}
  if(!window.confirm('Create '+name+' from develop?'))return;
  note('Creating branch…');
  try{
   const result=await api('branch',{method:'POST',body:{name}});
   const option=document.createElement('option');option.value=result.name;option.textContent=result.name;
   el('gitBranchSelect').append(option);el('gitBranchSelect').value=result.name;
   await choose(result.name);note('Created '+result.name+' from develop.');
  }catch(e){note('Branch creation failed: '+e.message);}
 };
 el('gitCreatePr').onclick=()=>{
  if(!writable)return;
  if(!/^(feature|fix)\//.test(branch)){note('Choose a feature/fix branch first.');return;}
  el('gitPrPanel').hidden=false;el('gitPrTitle').focus();
 };
 el('gitCancelPr').onclick=()=>{el('gitPrPanel').hidden=true;};
 el('gitSubmitPr').onclick=async()=>{
  if(!writable||!/^(feature|fix)\//.test(branch))return;
  const button=el('gitSubmitPr');button.disabled=true;el('gitPrStatus').textContent='Creating draft pull request…';
  try{
   const pr=await api('pull-request',{method:'POST',body:{branch,title:el('gitPrTitle').value.trim(),description:el('gitPrBody').value.trim()}});
   const link=document.createElement('a');link.href=pr.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open draft PR #'+pr.number;
   el('gitPrStatus').replaceChildren(link);
  }catch(e){el('gitPrStatus').textContent=e.message;}finally{button.disabled=false;}
 };
 if(!connected){el('gitHistoryMessage').textContent='GitHub App connection unavailable. Verify server-side configuration.';return;}
 try{
  const result=await api('branches');el('gitBranchSelect').replaceChildren();
  if(!result.branches.some(b=>b.name==='develop'))result.branches.unshift({name:'develop'});
  for(const item of result.branches){
   const option=document.createElement('option');option.value=item.name;option.textContent=item.name;el('gitBranchSelect').append(option);
  }
  el('gitBranchSelect').value='develop';await choose('develop');
 }catch(e){note('Cannot load GitHub branches: '+e.message);}
}

// Show the full IDE inside the existing Admin navigation. The legacy GitHub
// editor remains accessible separately and retains its original write guards.
export async function renderDevIDE({main,query={}}){
 // Deep links from the Git page must still open the requested repository file.
 if(query.path)return renderDevIDEGitHub({main,query});
 // Keep Admin navigation visible, but let the IDE consume every remaining pixel.
 main.classList.add('main--lifeide');
 main.innerHTML=`<section class="admin-lifeide" aria-label="LifeIDE developer workspace">
  <iframe class="admin-lifeide__frame" title="LifeIDE file explorer and code editor" src="/lifeide/?source=github"></iframe>
 </section>`;
 return ()=>{main.classList.remove('main--lifeide');};
}

async function renderDevIDEGitHub({main,query={}}){
 main.innerHTML=heading('LifeIDE','Edit and commit repository source files from LIFEGEN — no production branch edits')+'<div class="card"><div class="card__body">Loading…</div></div>';
 const data=await api('status');
 main.innerHTML=heading('LifeIDE','Browse develop; edit only feature/* or fix/* branches. Each save creates a commit.')+offline(data)+
 `<div class="card"><div class="card__body stack">
 <div class="form-grid"><div class="field"><label for="ideBranch">Branch</label><input id="ideBranch" value="${esc(query.branch||'develop')}" spellcheck="false"/></div>
 <div class="field"><label for="idePath">Repository file path</label><input id="idePath" value="${esc(query.path||'')}" placeholder="src/example.js" spellcheck="false"/></div></div>
 <button type="button" class="btn" id="ideOpen" ${data.connected?'':'disabled'}>Open file</button>
 <p id="ideMessage" role="status" class="small muted">Choose a file from Git or enter its repository path.</p>
 <textarea id="ideEditor" rows="22" spellcheck="false" style="width:100%;font-family:monospace;tab-size:2" disabled aria-label="Source code editor"></textarea>
 <div class="field"><label for="ideCommit">Commit message</label><input id="ideCommit" placeholder="feat: describe change" maxlength="160" disabled/></div>
 <button type="button" class="btn btn--primary" id="ideSave" disabled>Commit changes</button>
 </div></div>`;
 let sha='',loadedBranch='',loadedPath='',savedContent='',canEdit=false,committing=false,loading=false,loadSequence=0;
 const dirty=()=>committing||(canEdit&&document.getElementById('ideEditor')?.value!==savedContent);
 const beforeUnload=e=>{if(dirty()){e.preventDefault();e.returnValue='';}};
 window.addEventListener('beforeunload',beforeUnload);
 window.__lifegenCanLeaveEditor=()=>!dirty()||window.confirm('Discard unsaved LifeIDE changes?');

 const updateSave=()=>{const message=el('ideCommit').value.trim();el('ideSave').disabled=committing||loading||!canEdit||!sha||el('ideEditor').value===savedContent||message.length<8||loadedBranch!==el('ideBranch').value.trim()||loadedPath!==el('idePath').value.trim();};
 const el=id=>main.querySelector('#'+id);
 el('ideOpen').onclick=async()=>{
  if(committing||loading)return;
  if(dirty()&&!confirm('Discard unsaved changes and open another file?'))return;
  const branch=el('ideBranch').value.trim(),path=el('idePath').value.trim(),sequence=++loadSequence;
  loading=true;sha='';loadedBranch='';loadedPath='';savedContent='';canEdit=false;
  el('ideEditor').value='';el('ideCommit').value='';
  el('ideMessage').textContent='Loading '+path+'…';
  el('ideOpen').disabled=true;el('ideSave').disabled=true;el('ideEditor').disabled=true;el('ideCommit').disabled=true;
  el('ideBranch').disabled=true;el('idePath').disabled=true;
  try{
   const file=await api('file?branch='+encodeURIComponent(branch)+'&path='+encodeURIComponent(path));
   if(sequence!==loadSequence)return;
   sha=file.sha;loadedBranch=branch;loadedPath=path;savedContent=file.content;
   canEdit=Boolean(file.editable)&&Boolean(data.writesEnabled);
   el('ideEditor').value=file.content;
   el('ideMessage').textContent='Loaded '+path+' from '+branch+(canEdit?' · ready to edit':' · read-only');
  }catch(error){if(sequence===loadSequence)el('ideMessage').textContent='Unable to load file: '+error.message;}
  finally{
   if(sequence===loadSequence){
    loading=false;el('ideOpen').disabled=!data.connected;
    el('ideBranch').disabled=false;el('idePath').disabled=false;
    el('ideEditor').disabled=!canEdit;el('ideCommit').disabled=!canEdit;updateSave();
   }
  }
 };
 for(const id of ['ideEditor','ideCommit','ideBranch','idePath'])el(id).addEventListener('input',updateSave);
 el('ideSave').onclick=async()=>{
  if(loadedBranch!==el('ideBranch').value.trim()||loadedPath!==el('idePath').value.trim()){el('ideMessage').textContent='Reopen the file after changing branch or path.';return;}
  if(!canEdit||el('ideEditor').value===savedContent){el('ideMessage').textContent='No changes to commit.';return;}
  if(el('ideCommit').value.trim().length<8){el('ideMessage').textContent='Enter a descriptive commit message of at least 8 characters.';return;}
  if(!confirm('Commit the edits to '+loadedBranch+'?'))return;
  const snapshot={branch:loadedBranch,path:loadedPath,sha,content:el('ideEditor').value,message:el('ideCommit').value.trim()};
  committing=true;el('ideSave').disabled=true;el('ideOpen').disabled=true;
  for(const id of ['ideBranch','idePath','ideEditor','ideCommit'])el(id).disabled=true;
  el('ideMessage').textContent='Committing…';
  try{const result=await api('file',{method:'PUT',body:snapshot});
   sha=result.sha;savedContent=snapshot.content;el('ideCommit').value='';el('ideMessage').textContent='Committed: '+result.commit.slice(0,12);
  }catch(e){el('ideMessage').textContent=e.message;}finally{
   committing=false;el('ideOpen').disabled=!data.connected;
   for(const id of ['ideBranch','idePath'])el(id).disabled=false;
   el('ideEditor').disabled=!canEdit;el('ideCommit').disabled=!canEdit;updateSave();
  }
 };
 if(query.path&&data.connected)el('ideOpen').click();
 return ()=>{window.removeEventListener('beforeunload',beforeUnload);delete window.__lifegenCanLeaveEditor;};
}

export async function renderDevPackaging({main}){
 main.innerHTML=heading('Packaging','Build and package a development branch')+'<div class="card"><div class="card__body">Loading…</div></div>';
 const data=await api('status');
 main.innerHTML=heading('Packaging','Run the hosted CI build and download validated artifacts from GitHub Actions')+offline(data)+
 `<div class="card"><div class="card__body stack">
 <div class="field">${field}</div>
 <button type="button" class="btn btn--primary" id="runPackage" ${data.writesEnabled?'':'disabled'}>Start packaging</button>
 <p id="packageStatus" class="small muted" role="status">Packaging runs in GitHub Actions, not on the production web server.</p>
 <a class="btn" href="https://github.com/bojbrnrdo/Lifegen/actions/workflows/lifegen-package.yml" target="_blank" rel="noopener noreferrer">View runs and download ZIP ↗</a>
 <div class="row row--between"><strong>Recent package builds</strong><button type="button" class="btn btn--sm" id="refreshPackageRuns" ${data.connected?'':'disabled'}>Refresh</button></div>
 <p class="small muted" id="packageRunsStatus" role="status"></p>
 <p class="small muted">Successful runs contain downloadable artifacts on their GitHub run page. Verify SHA256SUMS.txt against LIFEGEN-source.zip before using a package when the integrity files are available.</p>
 <div id="packageRunsList" class="stack"></div>
 </div></div>`;
 const refreshRuns=async()=>{const status=main.querySelector('#packageRunsStatus'),list=main.querySelector('#packageRunsList');status.textContent='Loading package runs…';list.replaceChildren();
  try{const result=await api('package-runs');status.textContent=result.runs.length+' recent package runs';
   result.runs.forEach(run=>{const row=document.createElement('div');row.className='row row--between';const a=document.createElement('a');a.href=run.url;a.target='_blank';a.rel='noopener noreferrer';const resultLabel=run.conclusion||run.status||'Unknown';a.textContent=(run.branch||'Unknown branch')+' · '+resultLabel+(run.conclusion==='success'?' · Open artifacts ↗':' · View run ↗');const when=document.createElement('span');when.className='small muted';when.textContent=run.created_at?new Date(run.created_at).toLocaleString():'';row.append(a,when);list.append(row);});
  }catch(error){status.textContent=error.message;}
 };
 main.querySelector('#refreshPackageRuns').onclick=refreshRuns;
 if(data.connected)refreshRuns();
 let packagePending=false;
 main.querySelector('#runPackage').onclick=async()=>{
  if(packagePending)return;
  const button=main.querySelector('#runPackage'),status=main.querySelector('#packageStatus');
  const branch=main.querySelector('#devBranch').value.trim();
  if(!confirm('Start a package build for '+branch+'?'))return;
  packagePending=true;button.disabled=true;status.textContent='Requesting package build for '+branch+'…';
  try{
   const result=await api('package',{method:'POST',body:{branch}});
   status.textContent=result.message+' The run may take a moment to appear.';
   await refreshRuns();
  }catch(e){status.textContent=e.message;}
  finally{packagePending=false;button.disabled=!data.writesEnabled;}
 };
}
