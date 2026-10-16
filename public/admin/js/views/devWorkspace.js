import {esc} from '../ui.js';
import {state} from '../app.js';

const api=async(path,options={})=>{
 const response=await fetch('/api/admin/dev/'+path,{credentials:'same-origin',
  headers:{accept:'application/json',...(options.body?{'content-type':'application/json','x-csrf-token':state.user?.csrf_token||''}:{})},
  ...options});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||data.message||'Request failed');
 return data;
};
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
 </div></section><section class="card"><div class="card__header"><h2>Branch files</h2></div><div class="card__body stack">
 ${field}<button type="button" id="devBrowse" class="btn btn--primary" ${data.connected?'':'disabled'}>Browse files</button>
 <p id="devGitStatus" class="small muted" role="status"></p>
 <div id="devGitFiles" class="stack"></div>
 </div></section></div>`;
 main.querySelector('#devBrowse').onclick=async()=>{
  const status=main.querySelector('#devGitStatus'),files=main.querySelector('#devGitFiles');
  status.textContent='Loading files…';files.replaceChildren();
  try{const result=await api('tree?branch='+encodeURIComponent(main.querySelector('#devBranch').value.trim()));
  status.textContent=result.files.length+' source files available'+(result.truncated?' (list truncated)':'');
  result.files.slice(0,150).forEach(file=>{const a=document.createElement('a');a.href='#/dev/ide?branch='+encodeURIComponent(result.branch)+'&path='+encodeURIComponent(file.path);a.textContent=file.path;a.className='small';files.append(a);});
  }catch(e){status.textContent=e.message;}
 };
}

export async function renderDevIDE({main,query={}}){
 main.innerHTML=heading('MerchIDE','Edit and commit repository source files from LIFEGEN — no production branch edits')+'<div class="card"><div class="card__body">Loading…</div></div>';
 const data=await api('status');
 main.innerHTML=heading('MerchIDE','Edit files on develop and feature branches. Every save creates a Git commit.')+offline(data)+
 `<div class="card"><div class="card__body stack">
 <div class="form-grid"><div class="field"><label for="ideBranch">Branch</label><input id="ideBranch" value="${esc(query.branch||'develop')}" spellcheck="false"/></div>
 <div class="field"><label for="idePath">Repository file path</label><input id="idePath" value="${esc(query.path||'')}" placeholder="src/example.js" spellcheck="false"/></div></div>
 <button type="button" class="btn" id="ideOpen" ${data.connected?'':'disabled'}>Open file</button>
 <p id="ideMessage" role="status" class="small muted">Choose a file from Git or enter its repository path.</p>
 <textarea id="ideEditor" rows="22" spellcheck="false" style="width:100%;font-family:monospace;tab-size:2" disabled aria-label="Source code editor"></textarea>
 <div class="field"><label for="ideCommit">Commit message</label><input id="ideCommit" placeholder="feat: describe change" maxlength="160" disabled/></div>
 <button type="button" class="btn btn--primary" id="ideSave" disabled>Commit changes</button>
 </div></div>`;
 let sha='',loadedBranch='',loadedPath='';
 const el=id=>main.querySelector('#'+id);
 el('ideOpen').onclick=async()=>{el('ideMessage').textContent='Loading…';el('ideSave').disabled=true;el('ideEditor').disabled=true;el('ideCommit').disabled=true;
  try{const branch=el('ideBranch').value.trim(),path=el('idePath').value.trim();
   const f=await api('file?branch='+encodeURIComponent(branch)+'&path='+encodeURIComponent(path));
   sha=f.sha;loadedBranch=branch;loadedPath=path;el('ideEditor').value=f.content;el('ideEditor').disabled=false;el('ideCommit').disabled=false;el('ideSave').disabled=false;el('ideMessage').textContent='Loaded '+path+' from '+branch;
  }catch(e){el('ideMessage').textContent=e.message;}
 };
 el('ideSave').onclick=async()=>{
  if(loadedBranch!==el('ideBranch').value.trim()||loadedPath!==el('idePath').value.trim()){el('ideMessage').textContent='Reopen the file after changing branch or path.';return;}
  if(!confirm('Commit the edits to '+loadedBranch+'?'))return;
  el('ideSave').disabled=true;el('ideMessage').textContent='Committing…';
  try{const result=await api('file',{method:'PUT',body:JSON.stringify({branch:loadedBranch,path:loadedPath,sha,content:el('ideEditor').value,message:el('ideCommit').value.trim()})});
   sha=result.sha;el('ideMessage').textContent='Committed: '+result.commit.slice(0,12);
  }catch(e){el('ideMessage').textContent=e.message;}finally{el('ideSave').disabled=false;}
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
 </div></div>`;
 main.querySelector('#runPackage').onclick=async()=>{const status=main.querySelector('#packageStatus');if(!confirm('Start a package build for this development branch?'))return;
  try{const result=await api('package',{method:'POST',body:JSON.stringify({branch:main.querySelector('#devBranch').value.trim()})});status.textContent=result.message;}
  catch(e){status.textContent=e.message;}
 };
}
