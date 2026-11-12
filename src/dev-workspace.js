import {requireStaff,checkOrigin,checkCsrf} from './auth.js';
import crypto from 'node:crypto';

const repository='bojbrnrdo/Lifegen';
const apiRoot='https://api.github.com/repos/'+repository;
const productionAppConfigured=(env=process.env)=>Boolean(
 env.VERCEL_ENV==='production' &&
 env.LIFEGEN_GITHUB_APP_ID &&
 env.LIFEGEN_GITHUB_APP_INSTALLATION_ID &&
 env.LIFEGEN_GITHUB_APP_PRIVATE_KEY?.includes('PRIVATE KEY')
);
const productionAppWritesEnabled=(env=process.env)=>
 productionAppConfigured(env)&&env.LIFEGEN_GITHUB_PROD_WRITES_ENABLED==='true';
let installationToken={token:'',expires:0};
async function githubToken(){
 if(process.env.VERCEL_ENV!=='production')return process.env.LIFEGEN_GITHUB_DEV_TOKEN||'';
 if(!productionAppConfigured())return '';
 if(installationToken.expires>Date.now()+60000)return installationToken.token;
 const now=Math.floor(Date.now()/1000);
 const encoded=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
 const input=encoded({alg:'RS256',typ:'JWT'})+'.'+encoded({iat:now-60,exp:now+480,iss:String(process.env.LIFEGEN_GITHUB_APP_ID)});
 const privateKey=process.env.LIFEGEN_GITHUB_APP_PRIVATE_KEY.replace(/\\n/g,'\n');
 const signature=crypto.sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
 const response=await fetch('https://api.github.com/app/installations/'+encodeURIComponent(process.env.LIFEGEN_GITHUB_APP_INSTALLATION_ID)+'/access_tokens',{
  method:'POST',
  headers:{authorization:'Bearer '+input+'.'+signature,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'},
  body:JSON.stringify({repositories:['Lifegen'],permissions:{contents:'write',pull_requests:'write'}}),
  signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw Object.assign(new Error('GitHub App installation credentials or repository permissions need configuration.'),{status:503});
 const result=await response.json();
 if(typeof result.token!=='string'||!result.expires_at)throw Object.assign(new Error('GitHub App did not return a usable installation token.'),{status:503});
 installationToken={token:result.token,expires:Date.parse(result.expires_at)};
 return installationToken.token;
}
export const allowedBranch=b=>/^(develop|feature\/[a-zA-Z0-9._-]{1,90}|fix\/[a-zA-Z0-9._-]{1,90})$/.test(b||'');
export const allowedPath=p=>typeof p==='string'&&p.length>0&&p.length<=200&&
  !p.startsWith('/')&&!p.includes('..')&&!p.includes('\\')&&
  /^[a-zA-Z0-9._/-]+$/.test(p)&&
  !/(^|\/)(\.env(?:\..*)?|\.git|node_modules|secrets?)(\/|$)/i.test(p)&&
  !/\.(pem|key|p12|pfx|crt|p8|p7b|jks|keystore|asc|gpg|age|sqlite|sqlite3|db|bak)$/i.test(p)&&
  !/(^|\/)(id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\.[^/]*)?|secrets?(\.[^/]*)?|service[-_]?account(\.[^/]*)?|token(s)?\.[^/]+|\.npmrc|\.pypirc|\.netrc|\.htpasswd|\.aws|\.ssh|\.kube)(\/|$)/i.test(p);
export const editableBranch=b=>/^(feature|fix)\/[a-zA-Z0-9._-]{1,90}$/.test(b||'');
export const editablePath=p=>allowedPath(p)&&!/(^|\/)\.github(\/|$)/i.test(p)&&
 !/^(src\/(auth|db|deployment|dev-workspace)\.js|vercel\.json|package(-lock)?\.json)$/i.test(p);
const enabled=()=>process.env.VERCEL_ENV==='production'?productionAppConfigured():Boolean(process.env.LIFEGEN_GITHUB_DEV_TOKEN);
let connectionCache={mode:'',expires:0,connected:false};
const verified=async()=>{
 if(!enabled())return false;
 const mode=process.env.VERCEL_ENV==='production'?'app':'preview';
 if(connectionCache.mode===mode&&Date.now()<connectionCache.expires)return connectionCache.connected;
 try{
  const ref=await request(apiRoot+'/git/ref/heads/develop');
  connectionCache={mode,expires:Date.now()+60000,connected:Boolean(ref.object?.sha)};
 }catch{connectionCache={mode,expires:Date.now()+15000,connected:false};}
 return connectionCache.connected;
};
const request=async(url,opts={})=>{
 const response=await fetch(url,{
  ...opts,
  headers:{accept:'application/vnd.github+json',
   authorization:'Bearer '+await githubToken(),
   'x-github-api-version':'2022-11-28',
   ...(opts.headers||{})},
  signal:AbortSignal.timeout(15000)
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
  const code=response.status;
  const guidance=code===401?'GitHub credentials are invalid or expired.':
   code===403?'GitHub denied access, permissions are insufficient, or rate limits were reached.':
   code===404?'Repository, branch, file or workflow was not found, or token access is missing.':
   code===409?'GitHub detected a conflict. Refresh and retry.':
   code===422?'GitHub rejected the request. Check names, required fields, and existing pull requests.':
   code===429?'GitHub rate limit reached. Please retry later.':
   code>=500?'GitHub is temporarily unavailable. Try again later.':
   'GitHub request failed ('+code+').';
  const error=new Error(guidance);
  error.status=code;throw error;
 }
 return data;
};
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
const ensureAdmin=(req,res,next)=>req.actor?.role_id==='admin'?next():res.status(403).json({error:'Administrator access required'});
const ensureEnabled=async(req,res,next)=>{try{
 if(await verified())return next();
 return res.status(503).json({error:'GitHub repository access is unavailable. Check the server-side GitHub App or preview integration.'});
 }catch(e){next(e);}};
export const writesAllowed=(env=process.env)=>{
 if(env.VERCEL_ENV==='production')return productionAppWritesEnabled(env);
 return env.NODE_ENV!=='production'&&env.LIFEGEN_DEV_WRITES_ENABLED==='true'&&
  env.LIFEGEN_DEV_DATABASE_ISOLATED==='true'&&env.VERCEL_ENV==='preview';
};
const checkWrite=(req,res,next)=>{try{
 if(!writesAllowed())return res.status(403).json({error:'GitHub writes are disabled. Configure a repository-scoped GitHub App and enable protected branch writes, or use an isolated development preview.'});
 checkOrigin(req);checkCsrf(req);next();
 }catch(e){next(e);}};
const deny=(res)=>res.status(400).json({error:'Only safe development branches and source-file paths are allowed.'});

const packageRequests=new Map();
export function registerDevWorkspace(app){
 app.get('/api/admin/dev/status',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  const connected=await verified();
  res.set('Cache-Control','no-store').json({
   connected,
   repository,
   environment:process.env.VERCEL_ENV||'local',
   branch:process.env.VERCEL_GIT_COMMIT_REF||'',
   commit:(process.env.VERCEL_GIT_COMMIT_SHA||'').slice(0,12),
   readOnly:!connected||!writesAllowed(),
   writesEnabled:connected&&writesAllowed()
  });
 }));
 app.get('/api/admin/dev/readiness',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  const configured=enabled();
  const connected=configured?await verified():false;
  const isPreview=process.env.VERCEL_ENV==='preview'&&process.env.NODE_ENV!=='production';
  const isProductionApp=productionAppConfigured();
  const explicitWrites=process.env.LIFEGEN_DEV_WRITES_ENABLED==='true';
  const isolatedDbAcknowledged=process.env.LIFEGEN_DEV_DATABASE_ISOLATED==='true';
  res.set('Cache-Control','no-store').json({
   checks:[
    {id:'preview',label:'Isolated preview or configured production GitHub App',ready:isPreview||isProductionApp},
    {id:'token',label:'Server-side GitHub App or preview credential configured',ready:configured},
    {id:'repository',label:'GitHub develop branch accessible',ready:connected},
    {id:'database',label:'Preview database isolated (not required for GitHub-only production writes)',ready:isProductionApp||(isolatedDbAcknowledged&&isPreview)},
    {id:'writes',label:'Protected GitHub branch writes explicitly enabled',ready:writesAllowed()}
   ],
   canBrowse:connected,canWrite:connected&&writesAllowed(),
   note:'In production, configure a GitHub App scoped to LIFEGEN and an explicit write flag. Only feature/fix branches and draft PRs are writable; main stays protected.'
  });
 }));
 app.post('/api/admin/dev/branch',requireStaff,ensureAdmin,ensureEnabled,checkWrite,wrap(async(req,res)=>{
  const name=String(req.body?.name||'').trim();
  if(!editableBranch(name))return res.status(400).json({error:'Branch names must start with feature/ or fix/.'});
  const base=await request(apiRoot+'/git/ref/heads/develop');
  const result=await request(apiRoot+'/git/refs',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({ref:'refs/heads/'+name,sha:base.object.sha})
  });
  res.status(201).json({name,sha:result.object?.sha});
 }));
 app.get('/api/admin/dev/connection-check',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!enabled())return res.json({connected:false,reason:'not_configured',repository});
  try{
   const project=await request(apiRoot);
   const branch=await request(apiRoot+'/git/ref/heads/develop');
   return res.json({connected:true,repository:project.full_name||repository,
    canReadDevelop:Boolean(branch.object?.sha),permissionsVerified:false,
    note:'Repository read access verified. Write and Actions permissions must be validated separately.'});
  }catch(error){
   return res.status(503).json({connected:false,reason:'connection_failed',
    message:'GitHub connection test failed. Check token access, expiry and repository permissions.'});
  }
 }));
 app.get('/api/admin/dev/tree',requireStaff,ensureAdmin,ensureEnabled,wrap(async(req,res)=>{
  const branch=String(req.query.branch||'develop');
  if(!allowedBranch(branch))return deny(res);
  const ref=await request(apiRoot+'/git/ref/heads/'+encodeURIComponent(branch));
  const commit=await request(apiRoot+'/git/commits/'+ref.object.sha);
  const tree=await request(apiRoot+'/git/trees/'+commit.tree.sha+'?recursive=1');
  res.set('Cache-Control','no-store').json({branch,truncated:Boolean(tree.truncated),
   files:(tree.tree||[]).filter(x=>x.type==='blob'&&allowedPath(x.path)).slice(0,2000).map(x=>({path:x.path,size:x.size}))});
 }));
 app.get('/api/admin/dev/file',requireStaff,ensureAdmin,ensureEnabled,wrap(async(req,res)=>{
  const branch=String(req.query.branch||'develop'),file=String(req.query.path||'');
  if(!allowedBranch(branch)||!allowedPath(file))return deny(res);
  const info=await request(apiRoot+'/contents/'+file.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(branch));
  if(info.type!=='file'||info.size>200000)return res.status(400).json({error:'Only text files up to 200 KB can be edited.'});
  const raw=await request(apiRoot+'/git/blobs/'+info.sha);
  if(raw.encoding!=='base64')return res.status(400).json({error:'Unsupported file encoding'});
  const bytes=Buffer.from(raw.content,'base64');
  const decoded=bytes.toString('utf8');
  if(bytes.includes(0)||!Buffer.from(decoded,'utf8').equals(bytes))return res.status(415).json({error:'Binary and invalid UTF-8 files cannot be opened in LifeIDE.'});
  res.set('Cache-Control','no-store').json({path:file,branch,sha:info.sha,content:decoded,editable:editableBranch(branch)&&editablePath(file)});
 }));
 app.put('/api/admin/dev/file',requireStaff,ensureAdmin,ensureEnabled,checkWrite,wrap(async(req,res)=>{
  const {branch,path:file,sha,content,message}=req.body||{};
  if(!editableBranch(branch)||!editablePath(file))return res.status(403).json({error:'Editing is limited to feature/fix branches and non-sensitive source files. Use a reviewed pull request for protected changes.'});
  if(typeof content!=='string'||Buffer.byteLength(content)>200000||
   !/^[a-f0-9]{40}$/.test(String(sha||''))||typeof message!=='string'||message.trim().length<8||message.length>160)
   return res.status(400).json({error:'Invalid edit, blob SHA, or commit message.'});
  const current=await request(apiRoot+'/contents/'+file.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(branch));
  if(current.sha!==sha)return res.status(409).json({error:'The file changed on GitHub. Reopen it before saving.'});
  const currentBlob=await request(apiRoot+'/git/blobs/'+sha);
  if(currentBlob.encoding==='base64'&&Buffer.from(currentBlob.content,'base64').equals(Buffer.from(content,'utf8')))
   return res.status(409).json({error:'No changes detected. Edit the file before committing.'});
  const data=await request(apiRoot+'/contents/'+file.split('/').map(encodeURIComponent).join('/'),{
   method:'PUT',headers:{'content-type':'application/json'},
   body:JSON.stringify({branch,sha,message:message.trim(),content:Buffer.from(content,'utf8').toString('base64')})
  });
  res.json({ok:true,commit:data.commit?.sha,sha:data.content?.sha});
 }));
 // Read-only branch status and history for the Git console. These endpoints
 // never execute git locally or modify the remote repository.
 app.get('/api/admin/dev/branches',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  if(!await verified())return res.status(503).json({error:'GitHub connection is unavailable.'});
  const list=await request(apiRoot+'/branches?per_page=100');
  const branches=list.filter(b=>allowedBranch(b.name)).map(b=>({
   name:b.name,sha:b.commit?.sha||'',protected:Boolean(b.protected)
  }));
  res.set('Cache-Control','no-store').json({branches,base:'develop'});
 }));
 app.get('/api/admin/dev/branch-status',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  if(!await verified())return res.status(503).json({error:'GitHub connection is unavailable.'});
  const branch=String(req.query.branch||'develop');
  if(!allowedBranch(branch))return deny(res);
  const result=await request(apiRoot+'/compare/'+encodeURIComponent('develop')+'...'+encodeURIComponent(branch)+'?per_page=100');
  res.set('Cache-Control','no-store').json({
   branch,base:'develop',ahead:result.ahead_by||0,behind:result.behind_by||0,
   status:result.status||'identical',truncated:(result.files||[]).length>=100,
   files:(result.files||[]).slice(0,100).filter(f=>allowedPath(f.filename)).map(f=>({
    path:f.filename,status:f.status,additions:f.additions||0,deletions:f.deletions||0
   }))
  });
 }));
 // Read-only file patch from the same branch comparison shown in Git status.
 // Never fetch arbitrary URLs or expose unapproved/sensitive file paths.
 app.get('/api/admin/dev/file-diff',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  if(!await verified())return res.status(503).json({error:'GitHub connection is unavailable.'});
  const branch=String(req.query.branch||''),file=String(req.query.path||'');
  if(!allowedBranch(branch)||!allowedPath(file))return deny(res);
  const comparison=await request(apiRoot+'/compare/'+encodeURIComponent('develop')+'...'+encodeURIComponent(branch)+'?per_page=100');
  if((comparison.files||[]).length>=100)return res.status(409).json({error:'Comparison is too large to verify this file. Review it on GitHub.'});
  const entry=(comparison.files||[]).find(item=>item.filename===file);
  if(!entry)return res.status(404).json({error:'This file is not changed on the selected branch.'});
  const patch=typeof entry.patch==='string'?entry.patch:'';
  res.set('Cache-Control','no-store').json({
   branch,base:'develop',path:file,status:entry.status,
   additions:entry.additions||0,deletions:entry.deletions||0,
   patch:patch.slice(0,120000),truncated:patch.length>120000,
   unavailable:!patch
  });
 }));
 app.get('/api/admin/dev/history',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  if(!await verified())return res.status(503).json({error:'GitHub connection is unavailable.'});
  const branch=String(req.query.branch||'develop');
  if(!allowedBranch(branch))return deny(res);
  const commits=await request(apiRoot+'/commits?sha='+encodeURIComponent(branch)+'&per_page=25');
  res.set('Cache-Control','no-store').json({branch,commits:commits.map(c=>({
   sha:c.sha,subject:String(c.commit?.message||'').split('\n')[0].slice(0,200),
   author:c.commit?.author?.name||'Unknown',date:c.commit?.author?.date||'',
   url:c.html_url
  }))});
 }));
 // Inspect only commits present in the selected branch's recent history.
 // This is read-only and avoids accepting arbitrary repository SHA queries.
 app.get('/api/admin/dev/commit-detail',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  if(!await verified())return res.status(503).json({error:'GitHub connection is unavailable.'});
  const branch=String(req.query.branch||''),sha=String(req.query.sha||'');
  if(!allowedBranch(branch)||!/^[a-f0-9]{40}$/.test(sha))return deny(res);
  const recent=await request(apiRoot+'/commits?sha='+encodeURIComponent(branch)+'&per_page=25');
  if(!recent.some(item=>item.sha===sha))return res.status(404).json({error:'Commit is not in the most recent 25 commits on this branch.'});
  const commit=await request(apiRoot+'/commits/'+sha);
  const files=(commit.files||[]).filter(item=>allowedPath(item.filename));
  let remaining=90000;
  res.set('Cache-Control','no-store').json({
   branch,sha,subject:String(commit.commit?.message||'').split('\n')[0].slice(0,200),
   truncated:files.length>30||(commit.files||[]).length>=300,
   files:files.slice(0,30).map(item=>{
    const patch=typeof item.patch==='string'?item.patch:'';
    const snippet=patch.slice(0,Math.min(16000,remaining));
    remaining-=snippet.length;
    return {path:item.filename,status:item.status,additions:item.additions||0,
     deletions:item.deletions||0,patch:snippet,unavailable:!patch,
     truncated:snippet.length<patch.length};
   })
  });
 }));
 app.get('/api/admin/dev/pull-requests',requireStaff,ensureAdmin,ensureEnabled,wrap(async(req,res)=>{
  const branch=String(req.query.branch||'').trim();
  if(branch&&!editableBranch(branch))return deny(res);
  const params=new URLSearchParams({state:'open',base:'develop',per_page:'30',sort:'updated',direction:'desc'});
  if(branch)params.set('head',repository.split('/')[0]+':'+branch);
  const pulls=await request(apiRoot+'/pulls?'+params.toString());
  res.set('Cache-Control','no-store').json({pulls:pulls.map(p=>({
   number:p.number,title:p.title,html_url:p.html_url,draft:Boolean(p.draft),
   branch:p.head?.ref||'',base:p.base?.ref||'',updated_at:p.updated_at||''
  }))});
 }));
 app.post('/api/admin/dev/pull-request',requireStaff,ensureAdmin,ensureEnabled,checkWrite,wrap(async(req,res)=>{
  const branch=String(req.body?.branch||'').trim();
  const title=String(req.body?.title||'').trim();
  const description=String(req.body?.description||'').trim();
  if(!editableBranch(branch)||title.length<8||title.length>120||description.length>4000)
   return res.status(400).json({error:'Choose a feature/fix branch and provide a descriptive pull request title.'});
  // Confirm branch exists and differs from develop before requesting a review.
  await request(apiRoot+'/git/ref/heads/'+encodeURIComponent(branch));
  const diff=await request(apiRoot+'/compare/develop...'+encodeURIComponent(branch));
  if((diff.ahead_by||0)<1)return res.status(409).json({error:'This branch has no new commits relative to develop.'});
  const created=await request(apiRoot+'/pulls',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({head:branch,base:'develop',title,body:description,draft:true})
  });
  res.status(201).json({number:created.number,url:created.html_url,state:created.state,draft:Boolean(created.draft)});
 }));
 app.get('/api/admin/dev/package-runs',requireStaff,ensureAdmin,ensureEnabled,wrap(async(req,res)=>{
  const result=await request(apiRoot+'/actions/workflows/lifegen-package.yml/runs?per_page=15');
  res.set('Cache-Control','no-store').json({runs:(result.workflow_runs||[]).map(run=>({
   id:run.id,branch:run.head_branch,status:run.status,conclusion:run.conclusion,
   url:run.html_url,created_at:run.created_at
  }))});
 }));
 app.post('/api/admin/dev/package',requireStaff,ensureAdmin,ensureEnabled,checkWrite,wrap(async(req,res)=>{
  if(process.env.VERCEL_ENV==='production')return res.status(403).json({error:'Package workflow dispatch is limited to isolated previews.'});
  const branch=String(req.body?.branch||'develop');
  if(!allowedBranch(branch))return deny(res);
  const paths=req.body?.paths;
  if(paths!==undefined&&(!Array.isArray(paths)||paths.length<1||paths.length>40||
     new Set(paths).size!==paths.length||
     paths.some(path=>!allowedPath(path)||path.length>200)))
   return res.status(400).json({error:'Select 1–40 unique, permitted source files for a staged package.'});
  if(paths){
   // Only package actual changed files on the chosen remote branch; never trust
   // the browser-provided list without verifying the GitHub comparison.
   const diff=await request(apiRoot+'/compare/'+encodeURIComponent('develop')+'...'+encodeURIComponent(branch)+'?per_page=100');
   if((diff.files||[]).length>=100)return res.status(409).json({error:'Too many changed files to verify a staged package. Use the full-source package.'});
   const eligible=new Set((diff.files||[]).filter(item=>item.status!=='removed'&&allowedPath(item.filename)).map(item=>item.filename));
   if(paths.some(path=>!eligible.has(path)))return res.status(409).json({error:'The selected files are not all current changed source files. Refresh staging before packaging.'});
  }
  const now=Date.now(),last=packageRequests.get(branch)||0;
  if(now-last<60000)return res.status(429).json({error:'A package build was recently requested for this branch. Wait one minute before retrying.'});
  packageRequests.set(branch,now);
  try{
   await request(apiRoot+'/actions/workflows/lifegen-package.yml/dispatches',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({ref:branch,inputs:{paths:paths?paths.join('\n'):''}})
   });
  }catch(error){packageRequests.delete(branch);throw error;}
  res.status(202).json({ok:true,message:'Packaging workflow requested. Check GitHub Actions for the result.'});
 }));
}
