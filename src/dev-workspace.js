import {requireStaff,checkOrigin,checkCsrf} from './auth.js';

const repository='bojbrnrdo/Lifegen';
const apiRoot='https://api.github.com/repos/'+repository;
const token=()=>process.env.LIFEGEN_GITHUB_DEV_TOKEN||'';
export const allowedBranch=b=>/^(develop|feature\/[a-zA-Z0-9._-]{1,90}|fix\/[a-zA-Z0-9._-]{1,90})$/.test(b||'');
export const allowedPath=p=>typeof p==='string'&&p.length>0&&p.length<=200&&
  !p.startsWith('/')&&!p.includes('..')&&!p.includes('\\')&&
  /^[a-zA-Z0-9._/-]+$/.test(p)&&
  !/(^|\/)(\.env(?:\..*)?|\.git|node_modules|secrets?)(\/|$)/i.test(p)&&
  !/\.(pem|key|p12|pfx|crt)$/i.test(p);
export const editableBranch=b=>/^(feature|fix)\/[a-zA-Z0-9._-]{1,90}$/.test(b||'');
export const editablePath=p=>allowedPath(p)&&!/(^|\/)\.github(\/|$)/i.test(p)&&
 !/^(src\/(auth|db|deployment|dev-workspace)\.js|vercel\.json|package(-lock)?\.json)$/i.test(p);
const enabled=()=>Boolean(token());
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
 if(!response.ok)throw new Error(response.status===409?'Git conflict. Refresh the file and try again.':
   response.status===403?'GitHub access denied or rate limited.':
   'GitHub request failed ('+response.status+').');
 return data;
};
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
const ensureAdmin=(req,res,next)=>req.actor?.role_id==='admin'?next():res.status(403).json({error:'Administrator access required'});
const ensureEnabled=(req,res,next)=>enabled()?next():res.status(503).json({error:'Developer Git integration is not connected. Configure LIFEGEN_GITHUB_DEV_TOKEN on the server.'});
const checkWrite=(req,res,next)=>{try{checkOrigin(req);checkCsrf(req);next();}catch(e){next(e);}};
const deny=(res)=>res.status(400).json({error:'Only safe development branches and source-file paths are allowed.'});

export function registerDevWorkspace(app){
 app.get('/api/admin/dev/status',requireStaff,ensureAdmin,wrap(async(req,res)=>{
  res.set('Cache-Control','no-store').json({
   connected:enabled(),
   repository,
   environment:process.env.VERCEL_ENV||'local',
   branch:process.env.VERCEL_GIT_COMMIT_REF||'',
   commit:(process.env.VERCEL_GIT_COMMIT_SHA||'').slice(0,12),
   readOnly:!enabled()
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
  const data=await request(apiRoot+'/contents/'+file.split('/').map(encodeURIComponent).join('/'),{
   method:'PUT',headers:{'content-type':'application/json'},
   body:JSON.stringify({branch,sha,message:message.trim(),content:Buffer.from(content,'utf8').toString('base64')})
  });
  res.json({ok:true,commit:data.commit?.sha,sha:data.content?.sha});
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
