import {esc} from '../ui.js';
import {devRequest} from '../api.js';
import {verifyPackageFiles} from '../packageVerification.js';

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
  <section class="card devgit__section" id="gitDiffPanel" hidden><div class="card__header"><h2 id="gitDiffTitle">File Changes</h2><button class="btn btn--sm" type="button" id="gitCloseDiff">Close</button></div>
   <div class="card__body"><p id="gitDiffMessage" role="status" class="small muted"></p><pre id="gitDiffContent" class="devgit__patch" tabindex="0" aria-label="File differences"></pre></div>
  </section>
  <section class="card devgit__section"><div class="card__header"><h2>Commit History</h2><button class="btn btn--sm" id="gitReloadHistory" ${connected?'':'disabled'}>Refresh</button></div>
   <div class="card__body"><p class="small muted" id="gitHistoryMessage">Loading commit history…</p><div class="devgit__history" id="gitHistory"></div>
    <section id="gitCommitDetail" hidden aria-label="Selected commit changes">
     <div class="row row--between"><strong id="gitCommitDetailTitle">Commit details</strong><button class="btn btn--sm" type="button" id="gitCloseCommitDetail">Close</button></div>
     <p id="gitCommitDetailStatus" class="small muted" role="status"></p><div class="stack" id="gitCommitFiles"></div>
    </section>
   </div>
  </section>
  <section class="card devgit__section" id="gitPrPanel" hidden><div class="card__header"><h2>Create Draft Pull Request</h2></div>
   <div class="card__body stack"><p class="small muted">Review before merging feature/fix branches into develop. No automatic deployment.</p>
    <label for="gitPrTitle">Title</label><input id="gitPrTitle" class="input" maxlength="120" placeholder="fix: describe the change">
    <label for="gitPrBody">Review notes</label><textarea id="gitPrBody" class="input" rows="3" maxlength="4000"></textarea>
    <div class="row"><button class="btn btn--primary" id="gitSubmitPr">Create draft PR</button><button class="btn" id="gitCancelPr">Cancel</button></div>
    <p class="small muted" role="status" id="gitPrStatus"></p>
   </div></section></div>`;
 const el=id=>main.querySelector('#'+id);
 let branch='develop',revision=0,statusRequest=0,historyRequest=0,refreshRequest=0,diffRequest=0,commitDetailRequest=0;
 const note=message=>{el('gitMessage').textContent=message;};
 const openBranchFile=(selected,file)=>{
  if(!connected||!file||file.startsWith('/')||file.includes('\\\\')||
     file.split('/').some(part=>!part||part==='.'||part==='..')){
   note('Enter a valid repository-relative file path.');return;
  }
  window.location.hash='#/dev/ide?branch='+encodeURIComponent(selected)+'&path='+encodeURIComponent(file);
 };
 const showFileDiff=async(selected,file)=>{
  const request=++diffRequest,seq=revision;
  el('gitDiffPanel').hidden=false;
  el('gitDiffTitle').textContent='File Changes · '+file;
  el('gitDiffContent').textContent='';
  el('gitDiffMessage').textContent='Loading changes from '+selected+' against develop…';
  try{
   const result=await api('file-diff?branch='+encodeURIComponent(selected)+'&path='+encodeURIComponent(file));
   if(request!==diffRequest||seq!==revision||selected!==branch)return;
   el('gitDiffMessage').textContent=result.status+' · +'+result.additions+' / -'+result.deletions+
    (result.truncated?' · patch truncated':'');
   el('gitDiffContent').textContent=result.unavailable?'Inline patch unavailable for this file. Open the file in LifeIDE or review it on GitHub.':result.patch;
  }catch(error){
   if(request!==diffRequest||seq!==revision||selected!==branch)return;
   el('gitDiffMessage').textContent='Unable to load changes: '+error.message;
  }
 };
 el('gitCloseDiff').onclick=()=>{++diffRequest;el('gitDiffPanel').hidden=true;};
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
    row.append(name,counts);
    const view=document.createElement('button');view.type='button';view.className='btn btn--sm devgit__view-diff';
    view.textContent='View Diff';view.setAttribute('aria-label','View changes for '+file.path+' on '+which);
    view.onclick=()=>showFileDiff(which,file.path);row.append(view);
    if(file.status!=='removed'){
     const open=document.createElement('button');open.type='button';open.className='btn btn--sm devgit__open-file';
     open.textContent='Open';open.setAttribute('aria-label','Open '+file.path+' from '+which);
     open.onclick=()=>openBranchFile(which,file.path);
     row.append(open);
    }
    host.append(row);
   }
   el('gitSync').textContent=result.behind?'Behind develop':result.ahead?'Ahead of develop':'Up to date with develop';
   return true;
  }catch(e){if(seq===revision&&request===statusRequest){host.textContent=e.message;el('gitSync').textContent='Status unavailable';}return false;}
 };
 const inspectCommit=async(selected,sha)=>{
  const request=++commitDetailRequest,seq=revision;
  el('gitCommitDetail').hidden=false;
  el('gitCommitDetailTitle').textContent='Commit '+sha.slice(0,12);
  el('gitCommitFiles').replaceChildren();
  el('gitCommitDetailStatus').textContent='Loading commit changes…';
  try{
   const result=await api('commit-detail?branch='+encodeURIComponent(selected)+'&sha='+encodeURIComponent(sha));
   if(request!==commitDetailRequest||seq!==revision||selected!==branch)return;
   el('gitCommitDetailTitle').textContent=result.subject||'Commit '+sha.slice(0,12);
   el('gitCommitDetailStatus').textContent=result.files.length+' reviewable files'+(result.truncated?' · additional files not shown':'');
   for(const file of result.files){
    const details=document.createElement('details');details.className='devgit__commit-file';
    const summary=document.createElement('summary');summary.textContent=file.status+' · '+file.path+' (+'+file.additions+' / -'+file.deletions+')';
    details.append(summary);
    if(file.status!=='removed'){
     const open=document.createElement('button');open.type='button';open.className='btn btn--sm';
     open.textContent='Open in LifeIDE';open.onclick=()=>openBranchFile(selected,file.path);
     details.append(open);
    }
    const patch=document.createElement('pre');patch.className='devgit__patch';
    patch.textContent=file.unavailable?'Inline patch unavailable for this file. Review it on GitHub.':file.patch+(file.truncated?'\n… patch truncated':'');
    details.append(patch);el('gitCommitFiles').append(details);
   }
  }catch(error){if(request===commitDetailRequest&&seq===revision&&selected===branch)el('gitCommitDetailStatus').textContent='Unable to inspect commit: '+error.message;}
 };
 el('gitCloseCommitDetail').onclick=()=>{++commitDetailRequest;el('gitCommitDetail').hidden=true;};
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
    const diff=document.createElement('a');diff.className='btn btn--sm';diff.textContent='GitHub';diff.href=c.url;diff.target='_blank';diff.rel='noopener noreferrer';
    const inspect=document.createElement('button');inspect.type='button';inspect.className='btn btn--sm devgit__inspect-commit';
    inspect.textContent='Inspect';inspect.setAttribute('aria-label','Inspect commit '+c.sha.slice(0,12));
    inspect.onclick=()=>inspectCommit(which,c.sha);
    const revert=document.createElement('button');revert.className='btn btn--sm';revert.textContent='Revert';revert.disabled=true;revert.title='Reverts require a reviewed fix branch; direct revert is not yet supported.';
    buttons.append(inspect,diff,revert);row.append(desc,buttons);el('gitHistory').append(row);
   }
   return true;
  }catch(e){if(seq===revision&&request===historyRequest)el('gitHistoryMessage').textContent=e.message;return false;}
 };
 const choose=async(value)=>{
  branch=value;revision++;diffRequest++;commitDetailRequest++;el('gitCommitDetail').hidden=true;el('gitDiffPanel').hidden=true;el('gitBranchLabel').textContent=value;
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
  openBranchFile(selected,file);
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
 main.innerHTML=heading('Packaging','Review changed files and export validated ZIP archives through GitHub Actions')+offline(data)+
 `<div class="card"><div class="card__body stack">
 <div class="field">${field}</div>
 <div class="row"><button type="button" class="btn" id="findPackageFiles" ${data.connected?'':'disabled'}>Find Changed Files</button>
 <label><input type="checkbox" id="packageSelectedOnly" disabled> Export selected files only</label></div>
 <p class="small muted">Compare a feature/fix branch with develop to stage its changed files. A full-source package remains available without staging.</p>
 <p id="packageStageStatus" role="status" class="small muted">Choose a branch and find changed files to stage.</p>
 <div id="packageStage" class="stack" aria-label="Files available for packaging"></div>
 <button type="button" class="btn btn--primary" id="runPackage" ${data.writesEnabled?'':'disabled'}>Start packaging</button>
 <p id="packageStatus" class="small muted" role="status">Packaging runs in GitHub Actions, not on the production web server.</p>
 <a class="btn" href="https://github.com/bojbrnrdo/Lifegen/actions/workflows/lifegen-package.yml" target="_blank" rel="noopener noreferrer">View runs and download ZIP ↗</a>
 <div class="row row--between"><strong>Recent package builds</strong><button type="button" class="btn btn--sm" id="refreshPackageRuns" ${data.connected?'':'disabled'}>Refresh</button></div>
 <p class="small muted" id="packageRunsStatus" role="status"></p>
 <p class="small muted">Successful runs provide LIFEGEN-source.zip, SHA256SUMS.txt and PACKAGE-MANIFEST.json together in the GitHub artifact. The manifest records the source branch, commit and selected paths. After extracting the artifact, verify the ZIP with sha256sum -c SHA256SUMS.txt on a system with sha256sum installed. Matching checksums verify integrity, not deployment safety.</p>
 <div id="packageRunsList" class="stack"></div>
 <section class="card" aria-label="Verify downloaded package">
  <div class="card__header"><h2>Import · Verify Package</h2></div>
  <div class="card__body stack">
   <p class="small muted">Choose the three extracted package files. Verification happens locally in your browser; files are not uploaded or deployed.</p>
   <label>LIFEGEN-source.zip <input id="verifyPackageZip" type="file" accept=".zip,application/zip"></label>
   <label>SHA256SUMS.txt <input id="verifyPackageChecksum" type="file" accept=".txt,text/plain"></label>
   <label>PACKAGE-MANIFEST.json <input id="verifyPackageManifest" type="file" accept=".json,application/json"></label>
   <button id="verifyPackage" type="button" class="btn">Verify Package Integrity</button>
   <p id="verifyPackageStatus" class="small muted" role="status">No package verified.</p>
   <div id="verifyPackageDetails" class="stack"></div>
   <p class="small muted">Integrity verification does not establish that package contents are safe to deploy. Import/deployment is disabled until separate reviewed safeguards are implemented.</p>
  </div>
 </section>
 <section id="packageArtifactsPanel" hidden aria-label="Package build artifacts">
  <div class="row row--between"><strong id="packageArtifactsTitle">Package artifacts</strong><button id="closePackageArtifacts" type="button" class="btn btn--sm">Close</button></div>
  <p id="packageArtifactsStatus" class="small muted" role="status"></p>
  <div id="packageArtifactsList" class="stack"></div>
 </section>
 </div></div>`;
 const el=id=>main.querySelector('#'+id);
 const branchInput=el('devBranch'),stage=el('packageStage'),stageStatus=el('packageStageStatus'),selectedOnly=el('packageSelectedOnly');
 let verificationRequest=0;
 for(const id of ['verifyPackageZip','verifyPackageChecksum','verifyPackageManifest']){
  el(id).addEventListener('change',()=>{verificationRequest++;el('verifyPackageStatus').textContent='Package selection changed. Verify again.';el('verifyPackageDetails').replaceChildren();});
 }
 el('verifyPackage').onclick=async()=>{
  const seq=++verificationRequest,btn=el('verifyPackage'),message=el('verifyPackageStatus'),details=el('verifyPackageDetails');
  const zip=el('verifyPackageZip').files?.[0],sum=el('verifyPackageChecksum').files?.[0],manifest=el('verifyPackageManifest').files?.[0];
  details.replaceChildren();
  if(!zip||!sum||!manifest){message.textContent='Choose all three package files first.';return;}
  if(zip.name!=='LIFEGEN-source.zip'||sum.name!=='SHA256SUMS.txt'||manifest.name!=='PACKAGE-MANIFEST.json'){message.textContent='Choose the expected LIFEGEN export filenames.';return;}
  if(zip.size>50*1024*1024||sum.size>4096||manifest.size>65536){message.textContent='Package files exceed verification size limits.';return;}
  btn.disabled=true;message.textContent='Checking the ZIP checksum and source manifest locally…';
  try{
   const result=await verifyPackageFiles(new Uint8Array(await zip.arrayBuffer()),await sum.text(),await manifest.text());
   if(seq!==verificationRequest)return;
   message.textContent='SHA-256 verified. This package has not been deployed.';
   for(const [label,value] of [['Source branch',result.branch],['Source commit',result.commit],['Export type',result.mode],['Selected files',String(result.fileCount)],['SHA-256',result.sha256]]){
    const line=document.createElement('p');line.textContent=label+': '+value;details.append(line);
   }
  }catch(error){if(seq===verificationRequest)message.textContent='Verification failed: '+error.message;}
  finally{if(seq===verificationRequest)btn.disabled=false;}
 };

 let stagedBranch='',stageSequence=0,packagePending=false;
 const selected=()=>[...stage.querySelectorAll('.package-file:checked')].map(cb=>cb.value);
 const updateStage=()=>{
  const count=stage.querySelectorAll('.package-file').length;
  const valid=stagedBranch===branchInput.value.trim()&&count>0;
  selectedOnly.disabled=!valid;
  if(!valid)selectedOnly.checked=false;
  if(valid)stageStatus.textContent=selected().length+' of '+count+' changed files selected for export (maximum 40).';
 };
 branchInput.addEventListener('input',()=>{stageSequence++;stagedBranch='';stage.replaceChildren();selectedOnly.checked=false;selectedOnly.disabled=true;stageStatus.textContent='Branch changed. Find Changed Files again before exporting selected files.';});
 el('findPackageFiles').onclick=async()=>{
  const branch=branchInput.value.trim(),seq=++stageSequence;
  stagedBranch='';stage.replaceChildren();selectedOnly.checked=false;selectedOnly.disabled=true;
  stageStatus.textContent='Comparing '+branch+' with develop…';
  try{
   if(!/^(develop|(?:feature|fix)\/[A-Za-z0-9._-]{1,90})$/.test(branch))throw Error('Use develop, feature/name or fix/name.');
   const result=await api('branch-status?branch='+encodeURIComponent(branch));
   if(seq!==stageSequence||branch!==branchInput.value.trim())return;
   if(result.truncated)throw Error('More than 100 changed files. Staged exports cannot be safely verified; use a full-source package.');
   const files=result.files.filter(file=>file.status!=='removed');
   if(!files.length){stageStatus.textContent='No changed source files found. You can still export the full source.';return;}
   stagedBranch=branch;
   const all=document.createElement('label');all.className='row';
   const toggle=document.createElement('input');toggle.type='checkbox';toggle.setAttribute('aria-label','Select all changed files');
   all.append(toggle,document.createTextNode('Select all ('+Math.min(files.length,40)+' maximum)'));stage.append(all);
   const list=document.createElement('div');list.className='stack';stage.append(list);
   files.forEach((file,index)=>{
    const label=document.createElement('label');label.className='row';
    const check=document.createElement('input');check.type='checkbox';check.className='package-file';check.value=file.path;check.checked=index<40;
    const name=document.createElement('span');name.textContent=file.status+' · '+file.path;
    label.append(check,name);list.append(label);
    check.addEventListener('change',()=>{
     if(selected().length>40){check.checked=false;stageStatus.textContent='Select at most 40 files.';return;}
     toggle.checked=selected().length===files.length;updateStage();
    });
   });
   toggle.checked=files.length<=40;
   toggle.addEventListener('change',()=>{
    const checks=[...list.querySelectorAll('input[type=checkbox]')];
    checks.forEach((cb,index)=>{cb.checked=toggle.checked&&index<40;});
    updateStage();
   });
   updateStage();
  }catch(error){if(seq===stageSequence){stageStatus.textContent='Cannot stage files: '+error.message;stagedBranch='';selectedOnly.disabled=true;}}
 };
 let artifactRequest=0;
 const inspectArtifacts=async(run)=>{
  const request=++artifactRequest,panel=el('packageArtifactsPanel');
  panel.hidden=false;el('packageArtifactsTitle').textContent='Artifacts · '+(run.branch||'Unknown branch');
  el('packageArtifactsList').replaceChildren();el('packageArtifactsStatus').textContent='Loading artifact details…';
  try{
   const result=await api('package-artifacts?run_id='+encodeURIComponent(run.id));
   if(request!==artifactRequest)return;
   if(!result.artifacts.length){
    el('packageArtifactsStatus').textContent='No artifacts available for this run. The build may be unfinished, failed, or its artifacts expired.';
    return;
   }
   el('packageArtifactsStatus').textContent=result.artifacts.length+' artifacts · '+(result.conclusion||result.status||'Unknown');
   for(const artifact of result.artifacts){
    const item=document.createElement('div');item.className='row row--between';
    const label=document.createElement('span');label.textContent=artifact.name+' · '+(artifact.size_in_bytes/1048576).toFixed(2)+' MB'+(artifact.expired?' · Expired':'');
    const detail=document.createElement('small');detail.className='muted';detail.textContent=artifact.expires_at?'Expires '+new Date(artifact.expires_at).toLocaleString():'Expiration unavailable';
    item.append(label,detail);el('packageArtifactsList').append(item);
   }
   const link=document.createElement('a');link.className='btn btn--sm';link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View or download artifacts on GitHub';el('packageArtifactsList').append(link);
  }catch(error){if(request===artifactRequest)el('packageArtifactsStatus').textContent='Cannot inspect artifacts: '+error.message;}
 };
 el('closePackageArtifacts').onclick=()=>{artifactRequest++;el('packageArtifactsPanel').hidden=true;};
 let runsRequest=0;
 const refreshRuns=async()=>{
  const request=++runsRequest,status=el('packageRunsStatus'),list=el('packageRunsList');
  status.textContent='Loading package runs…';list.replaceChildren();
  try{
   const result=await api('package-runs');if(request!==runsRequest)return;
   status.textContent=result.runs.length+' recent package runs';
   result.runs.forEach(run=>{
    const row=document.createElement('div');row.className='row row--between';
    const a=document.createElement('a');a.href=run.url;a.target='_blank';a.rel='noopener noreferrer';
    const resultLabel=run.conclusion||run.status||'Unknown';
    a.textContent=(run.branch||'Unknown branch')+' · '+resultLabel+' · GitHub';
    const inspect=document.createElement('button');inspect.type='button';inspect.className='btn btn--sm';
    inspect.textContent='Inspect Artifacts';inspect.onclick=()=>inspectArtifacts(run);
    const when=document.createElement('span');when.className='small muted';when.textContent=run.created_at?new Date(run.created_at).toLocaleString():'';
    row.append(a,inspect,when);list.append(row);
   });
  }catch(error){if(request===runsRequest)status.textContent=error.message;}
 };
 el('refreshPackageRuns').onclick=refreshRuns;
 if(data.connected)refreshRuns();
 el('runPackage').onclick=async()=>{
  if(packagePending)return;
  const button=el('runPackage'),status=el('packageStatus');
  const branch=branchInput.value.trim(),onlySelected=selectedOnly.checked;
  if(onlySelected&&(stagedBranch!==branch||selectedOnly.disabled)){status.textContent='Find changed files again before exporting selected files.';return;}
  const paths=onlySelected?selected():undefined;
  if(onlySelected&&(!paths.length||paths.length>40)){status.textContent='Select between 1 and 40 changed files.';return;}
  if(!confirm('Start '+(onlySelected?'selected-file ('+paths.length+' files)':'full-source')+' package build for '+branch+'?'))return;
  packagePending=true;button.disabled=true;status.textContent='Requesting package build for '+branch+'…';
  try{
   const result=await api('package',{method:'POST',body:{branch,...(onlySelected?{paths}:{})}});
   status.textContent=result.message+' The run may take a moment to appear.';
   await refreshRuns();
  }catch(e){status.textContent=e.message;}
  finally{packagePending=false;button.disabled=!data.writesEnabled;}
 };
}
