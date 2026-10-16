import {esc} from '../ui.js';
import {devRequest} from '../api.js';

const api=devRequest;
const heading=(title,subtitle)=>`<div class="page-header"><div><h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p></div></div>`;
const offline=(data)=>!data.connected?'<div class="alert alert--info">GitHub integration is not yet configured on the server. Ask the administrator to configure LIFEGEN_GITHUB_DEV_TOKEN with repository Contents and Actions permissions. Never enter tokens in this page.</div>':'';
const field=`<label for="devBranch">Working branch</label><input id="devBranch" class="input" value="develop" autocomplete="off" spellcheck="false"/><span class="help">Use develop, feature/* or fix/* branches. Main is protected.</span>`;

export async function renderDevGit({main}){
 main.innerHTML=heading('Git','Repository status and development branches')+'<div class="card"><div class="card__body">Loading…</div></div>';
 const data=await api('status');
 main.innerHTML=heading('Git','Developer workspace — safe development branches only')+offline(data)+
 `<div class="grid grid--2"><section class="card"><div class="card__header"><h2>Repository</h2></div><div class="card__body stack">
 <p><b>${esc(data.repository)}</b></p><p class="small muted">Deployed environment: ${esc(data.environment)} · Commit: ${esc(data.commit||'Not available')}</p>
 <p class="small muted">Working branch: ${esc(data.branch||'Not available')}</p>
 <a class="btn" href="https://github.com/bojbrnrdo/Lifegen/pulls" target="_blank" rel="noopener noreferrer">View pull requests ↗</a>
 <div class="row"><button type="button" id="checkDevConnection" class="btn btn--sm">Test GitHub connection</button></div>
 <p class="small muted" id="devConnectionResult" role="status">Connection has not been tested.</p>
 <div class="field"><label for="newDevBranch">New development branch</label><input id="newDevBranch" placeholder="feature/my-change" spellcheck="false"/></div>
 <button type="button" id="createDevBranch" class="btn" ${data.connected?'':'disabled'}>Create branch from develop</button>
 <p class="small muted" role="status" id="createBranchStatus"></p>
 </div></section><section class="card"><div class="card__header"><h2>Branch files</h2></div><div class="card__body stack">
 ${field}<button type="button" id="devBrowse" class="btn btn--primary" ${data.connected?'':'disabled'}>Browse files</button>
 <p id="devGitStatus" class="small muted" role="status"></p>
 <div class="field"><label for="devFileFilter">Filter files</label><input id="devFileFilter" type="search" placeholder="Search paths…" disabled/></div><div id="devGitFiles" class="stack"></div>
 </div></section></div>
 <section class="card mt-2"><div class="card__header"><h2>Submit for review</h2></div><div class="card__body stack">
 <p class="small muted">Create a draft pull request from a feature/fix branch into develop. Nothing is merged or deployed automatically.</p>
 <div class="field"><label for="prBranch">Source branch</label><input id="prBranch" placeholder="feature/my-change" spellcheck="false"/></div>
 <div class="field"><label for="prTitle">Pull request title</label><input id="prTitle" maxlength="120" placeholder="feat: describe the change"/></div>
 <div class="field"><label for="prDescription">Review notes</label><textarea id="prDescription" rows="4" maxlength="4000" placeholder="What changed and what should reviewers test?"></textarea></div>
 <button type="button" id="createDraftPr" class="btn btn--primary" ${data.connected?'':'disabled'}>Create draft pull request</button>
 <p class="small muted" role="status" id="draftPrStatus"></p><div id="draftPrLink"></div>
 </div></section>
 <section class="card mt-2"><div class="card__header"><h2>Open development pull requests</h2><button type="button" class="btn btn--sm" id="refreshDevPrs" ${data.connected?'':'disabled'}>Refresh</button></div>
 <div class="card__body"><p class="small muted" id="devPrStatus" role="status">Load current review requests.</p><div class="stack" id="devPrList"></div></div></section>`;
 const refreshPrs=async()=>{
  const status=main.querySelector('#devPrStatus'),list=main.querySelector('#devPrList');status.textContent='Loading pull requests…';list.replaceChildren();
  try{const result=await api('pull-requests');status.textContent=result.pulls.length+' open pull requests into develop';
   result.pulls.forEach(pr=>{const row=document.createElement('div');row.className='row row--between';
    const details=document.createElement('div');const title=document.createElement('a');title.href=pr.html_url;title.target='_blank';title.rel='noopener noreferrer';title.textContent='#'+pr.number+' · '+pr.title;
    const sub=document.createElement('p');sub.className='small muted';sub.textContent=pr.branch+' → '+pr.base+(pr.draft?' · Draft':' · Ready for review');
    details.append(title,sub);row.append(details);list.append(row);});
  }catch(error){status.textContent=error.message;}
 };
 main.querySelector('#refreshDevPrs').onclick=refreshPrs;
 if(data.connected)refreshPrs();
 main.querySelector('#checkDevConnection').onclick=async()=>{
  const status=main.querySelector('#devConnectionResult');
  status.textContent='Checking GitHub repository access…';
  try{const result=await api('connection-check');
   status.textContent=result.connected?'Connected to '+result.repository+' · develop readable · write access not yet verified':'Not connected: '+(result.reason||'unknown');
  }catch(error){status.textContent='Connection failed: '+error.message;}
 };
 main.querySelector('#createDevBranch').onclick=async()=>{
  const name=main.querySelector('#newDevBranch').value.trim(),status=main.querySelector('#createBranchStatus');
  status.textContent='Creating branch…';
  try{const result=await api('branch',{method:'POST',body:{name}});status.textContent='Created '+result.name;
   main.querySelector('#devBranch').value=result.name;
   main.querySelector('#prBranch').value=result.name;
  }catch(error){status.textContent=error.message;}
 };
 main.querySelector('#createDraftPr').onclick=async()=>{
  const button=main.querySelector('#createDraftPr');
  const status=main.querySelector('#draftPrStatus');
  const output=main.querySelector('#draftPrLink');
  button.disabled=true;status.textContent='Creating draft pull request…';output.replaceChildren();
  try{
   const result=await api('pull-request',{method:'POST',body:{
    branch:main.querySelector('#prBranch').value.trim(),
    title:main.querySelector('#prTitle').value.trim(),
    description:main.querySelector('#prDescription').value.trim()
   }});
   status.textContent='Draft PR #'+result.number+' created for review.';
   const link=document.createElement('a');link.href=result.url;link.textContent='Open pull request #'+result.number+' ↗';link.target='_blank';link.rel='noopener noreferrer';link.className='btn';output.append(link);
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
 };
 let listedFiles=[];
 const filter=main.querySelector('#devFileFilter');
 filter.oninput=()=>{const files=main.querySelector('#devGitFiles');files.replaceChildren();const term=filter.value.trim().toLowerCase();listedFiles.filter(f=>f.path.toLowerCase().includes(term)).slice(0,150).forEach(file=>{const a=document.createElement('a');a.href='#/dev/ide?branch='+encodeURIComponent(main.querySelector('#devBranch').value.trim())+'&path='+encodeURIComponent(file.path);a.textContent=file.path;a.className='small';files.append(a);});};
 main.querySelector('#devBrowse').onclick=async()=>{
  const status=main.querySelector('#devGitStatus'),files=main.querySelector('#devGitFiles');
  status.textContent='Loading files…';files.replaceChildren();
  try{const result=await api('tree?branch='+encodeURIComponent(main.querySelector('#devBranch').value.trim()));
  listedFiles=result.files;filter.disabled=false;filter.oninput();
  status.textContent=result.files.length+' source files available'+(result.truncated?' (list truncated)':'');
  }catch(e){status.textContent=e.message;}
 };
}

export async function renderDevIDE({main,query={}}){
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
 let sha='',loadedBranch='',loadedPath='',savedContent='',canEdit=false;
 const updateSave=()=>{const message=el('ideCommit').value.trim();el('ideSave').disabled=!canEdit||!sha||el('ideEditor').value===savedContent||message.length<8||loadedBranch!==el('ideBranch').value.trim()||loadedPath!==el('idePath').value.trim();};
 const el=id=>main.querySelector('#'+id);
 el('ideOpen').onclick=async()=>{el('ideMessage').textContent='Loading…';el('ideSave').disabled=true;el('ideEditor').disabled=true;el('ideCommit').disabled=true;
  try{const branch=el('ideBranch').value.trim(),path=el('idePath').value.trim();
   const f=await api('file?branch='+encodeURIComponent(branch)+'&path='+encodeURIComponent(path));
   sha=f.sha;loadedBranch=branch;loadedPath=path;savedContent=f.content;canEdit=Boolean(f.editable);el('ideEditor').value=f.content;el('ideEditor').disabled=!canEdit;el('ideCommit').disabled=!canEdit;updateSave();el('ideMessage').textContent='Loaded '+path+' from '+branch+(canEdit?' · ready to edit':' · read-only');
  }catch(e){el('ideMessage').textContent=e.message;}
 };
 for(const id of ['ideEditor','ideCommit','ideBranch','idePath'])el(id).addEventListener('input',updateSave);
 el('ideSave').onclick=async()=>{
  if(loadedBranch!==el('ideBranch').value.trim()||loadedPath!==el('idePath').value.trim()){el('ideMessage').textContent='Reopen the file after changing branch or path.';return;}
  if(!canEdit||el('ideEditor').value===savedContent){el('ideMessage').textContent='No changes to commit.';return;}
  if(el('ideCommit').value.trim().length<8){el('ideMessage').textContent='Enter a descriptive commit message of at least 8 characters.';return;}
  if(!confirm('Commit the edits to '+loadedBranch+'?'))return;
  el('ideSave').disabled=true;el('ideMessage').textContent='Committing…';
  try{const result=await api('file',{method:'PUT',body:{branch:loadedBranch,path:loadedPath,sha,content:el('ideEditor').value,message:el('ideCommit').value.trim()}});
   sha=result.sha;savedContent=el('ideEditor').value;el('ideCommit').value='';el('ideMessage').textContent='Committed: '+result.commit.slice(0,12);
  }catch(e){el('ideMessage').textContent=e.message;}finally{updateSave();}
 };
 if(query.path&&data.connected)el('ideOpen').click();
}

export async function renderDevPackaging({main}){
 main.innerHTML=heading('Packaging','Build and package a development branch')+'<div class="card"><div class="card__body">Loading…</div></div>';
 const data=await api('status');
 main.innerHTML=heading('Packaging','Run the hosted CI build and download validated artifacts from GitHub Actions')+offline(data)+
 `<div class="card"><div class="card__body stack">
 <div class="field">${field}</div>
 <button type="button" class="btn btn--primary" id="runPackage" ${data.connected?'':'disabled'}>Start packaging</button>
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
 main.querySelector('#runPackage').onclick=async()=>{const status=main.querySelector('#packageStatus');if(!confirm('Start a package build for this development branch?'))return;
  try{const result=await api('package',{method:'POST',body:{branch:main.querySelector('#devBranch').value.trim()}});status.textContent=result.message+' The run may take a moment to appear.';await refreshRuns();}
  catch(e){status.textContent=e.message;}
 };
}
