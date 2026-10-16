import {requireStaff,checkOrigin,checkCsrf} from './auth.js';

const repository='bojbrnrdo/Lifegen';
const apiRoot='https://api.github.com/repos/'+repository;
const token=()=>process.env.LIFEGEN_GITHUB_DEV_TOKEN||'';
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
const enabled=()=>Boolean(token());
let connectionCache={token:'',expires:0,connected:false};
const verified=async()=>{
 const key=token();if(!key)return false;
 if(connectionCache.token===key&&Date.now()<connectionCache.expires)return connectionCache.connected;
 try{const ref=await request(apiRoot+'/git/ref/heads/develop');
  connectionCache={token:key,expires:Date.now()+60000,connected:Boolean(ref.object?.sha)};
 }catch{connectionCache={token:key,expires:Date.now()+15000,connected:false};}
 return connectionCache.connected;
};
const request=async(url,opts={})=>{
 const response=await fetch(url,{
  ...opts,
  headers:{accept:'application/vnd.github+json',
   authorization:'Bearer '+token(),
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
 return res.status(503).json({error:'GitHub repository access is unavailable. Check the server-side integration token.'});
 }catch(e){next(e);}};
const checkWrite=(req,res,next)=>{try{checkOrigin(req);checkCsrf(req);next();}catch(e){next(e);}};
const deny=(res)=>res.status(400).json({error:'Only safe development branches and source-file paths are allowed.'});

export function registerDevWorkspace(app){
 app.get('/api/admin/dev/status',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  const connected=await verified();
  res.set('Cache-Control','no-store').json({
   connected,
   repository,
   environment:process.env.VERCEL_ENV||'local',
   branch:process.env.VERCEL_GIT_COMMIT_REF||'',
   commit:(process.env.VERCEL_GIT_COMMIT_SHA||'').slice(0,12),
   readOnly:!connected
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
  const branch=String(req.body?.branch||'develop');
  if(!allowedBranch(branch))return deny(res);
  await request(apiRoot+'/actions/workflows/lifegen-package.yml/dispatches',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({ref:branch})
  });
  res.status(202).json({ok:true,message:'Packaging workflow requested. Check GitHub Actions for the result.'});
 }));
}
