import {esc} from '../ui.js';

const row=(label,value)=>`<div class="row row--between"><strong>${esc(label)}</strong><span class="small muted">${esc(value||'Not available')}</span></div>`;

export async function renderDeveloper({main}){
 main.innerHTML='<div class="page-header"><div><h1>Developer environment</h1><p class="sub">Read-only deployment information. No tokens, terminal, or database write access.</p></div></div><div class="card"><div class="card__body">Loading environment details…</div></div>';
 const response=await fetch('/api/admin/developer-info',{credentials:'same-origin',headers:{accept:'application/json'}});
 if(!response.ok)throw Error(response.status===403?'Administrator access required':'Could not load deployment details');
 const data=await response.json();
 main.innerHTML=`<div class="page-header"><div><h1>Developer environment</h1><p class="sub">GitHub, Vercel and release visibility · read only</p></div></div>
 <div class="grid grid--2">
  <section class="card"><div class="card__header"><h2>Current deployment</h2></div>
    <div class="card__body stack">
      ${row('Environment',data.environment)}
      ${row('Branch',data.branch)}
      ${row('Commit',data.commit)}
      ${row('Deployment',data.deployment)}
      <p class="small muted">These values are provided by the deployment platform, and may be unavailable locally.</p>
    </div></section>
  <section class="card"><div class="card__header"><h2>Development workflow</h2></div>
    <div class="card__body stack">
      <div><b>1. Feature branch</b><p class="small muted">Develop separately from main.</p></div>
      <div><b>2. Pull request → develop</b><p class="small muted">Run CI and review changes in a Vercel preview.</p></div>
      <div><b>3. QA → main</b><p class="small muted">Merge reviewed, tested changes for production release.</p></div>
      <p class="small muted">Preview database credentials must be configured independently. Never share production credentials with previews.</p>
    </div></section>
 </div>
 <div class="card mt-2"><div class="card__header"><h2>Project links</h2></div>
  <div class="card__body row">
  <a class="btn" href="https://github.com/bojbrnrdo/Lifegen" target="_blank" rel="noopener noreferrer">GitHub repository ↗</a>
  <a class="btn" href="https://github.com/bojbrnrdo/Lifegen/pulls" target="_blank" rel="noopener noreferrer">Pull requests ↗</a>
  <a class="btn" href="https://github.com/bojbrnrdo/Lifegen/actions" target="_blank" rel="noopener noreferrer">CI checks ↗</a>
  <a class="btn" href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer">Vercel dashboard ↗</a>
  </div>
 </div>`;
}
