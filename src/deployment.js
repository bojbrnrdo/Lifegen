// Admin-only, opt-in deployment helper. Vercel tokens stay in memory, never in PostgreSQL or source files.
import {Router,raw} from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
import {checkOrigin,checkCsrf,requireStaff,requirePermission} from './auth.js';
import {httpError} from './domain.js';

const MAX_ZIP=5*1024*1024,MAX_FILES=180,MAX_EXPANDED=12*1024*1024;
const TTL=30*60*1000;
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const idOk=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(s);
export const DEPLOY_SETTINGS={framework:'express',installCommand:'npm ci',buildCommand:'npm run build && npm run db:migrate',outputDirectory:null,rootDirectory:null,nodeVersion:'22.x'};
export const deploymentHelperEnabled=()=>process.env.ENABLE_DEPLOY_HELPER==='true'&&!process.env.VERCEL;

export function inspectArchive(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_ZIP)throw httpError(400,'Choose a LIFEGEN ZIP smaller than 5 MB.');
 let count=0,total=0,entries;
 try{entries=unzipSync(new Uint8Array(buffer),{filter:e=>{
  count++;total+=e.originalSize;
  if(count>MAX_FILES||total>MAX_EXPANDED||e.originalSize>2*1024*1024)throw new Error('Archive is too large.');
  if(!e.name||e.name.includes('\\')||e.name.startsWith('/')||e.name.split('/').some(p=>p==='..')||/\0/.test(e.name))throw new Error('Unsafe archive path.');
  return !e.name.endsWith('/');
 }});}catch{throw httpError(400,'That ZIP is invalid, unsafe or too large. Use the LIFEGEN deployment ZIP.');}
 const names=Object.keys(entries),packages=names.filter(n=>n==='package.json'||n==='lifegen-neon/package.json');
 if(packages.length!==1)throw httpError(400,'The ZIP must contain one LIFEGEN package.json at the top level or in lifegen-neon.');
 const prefix=packages[0].slice(0,-'package.json'.length),files=[];
 for(const name of names){
  if(!name.startsWith(prefix))continue;
  const file=name.slice(prefix.length);if(!file)continue;
  const segments=file.split('/');
  if(segments.some(p=>['node_modules','.git','.vercel','private-data','test-results'].includes(p))||segments.some(p=>p.startsWith('.env')&&p!=='.env.example'))throw httpError(400,'The ZIP contains private environment files or generated folders. Use the clean deployment ZIP.');
  if(/Admin-Setup-Code|runtime\.env/i.test(file))throw httpError(400,'Private setup-code files must not be uploaded.');
  const data=Buffer.from(entries[name]);
  if(/npg_[a-zA-Z0-9]{8,}/.test(data.toString('utf8')))throw httpError(400,'The ZIP contains a database credential. Use the clean deployment ZIP.');
  files.push({file,data:data.toString('base64'),encoding:'base64'});
 }
 const map=new Map(files.map(f=>[f.file,f]));
 for(const required of ['package.json','package-lock.json','vercel.json','src/app.js','public/lifegen/index.html','public/admin/index.html','database/001_init.sql','scripts/migrate.mjs'])if(!map.has(required))throw httpError(400,'The ZIP is missing '+required+'.');
 let pkg,config;
 try{pkg=JSON.parse(strFromU8(entries[prefix+'package.json']));config=JSON.parse(strFromU8(entries[prefix+'vercel.json']));}catch{throw httpError(400,'The ZIP has invalid project configuration.');}
 if(pkg.name!=='lifegen-neon'||!pkg.dependencies?.express)throw httpError(400,'Choose the LIFEGEN application ZIP, not another project.');
 // Normalize older trusted editions too: one root, Express, automatic output.
 config.framework='express';config.outputDirectory=null;config.installCommand='npm ci';config.buildCommand=DEPLOY_SETTINGS.buildCommand;
 map.get('vercel.json').data=Buffer.from(JSON.stringify(config,null,2)+'\n').toString('base64');
 return {hash:sha(buffer),version:String(pkg.version||''),files,files_count:files.length,size:buffer.length,flattened:Boolean(prefix)};
}

export function createDeploymentService({fetchImpl=globalThis.fetch,approvedZipPaths=['/home/user/LIFEGEN-Vercel-Deploy.zip','/home/user/LIFEGEN-One-Site.zip','/home/user/lifegen-neon/private-data/approved-releases/LIFEGEN-Vercel-Deploy-2.1.2.zip'],config=()=>process.env,now=()=>Date.now()}={}){
 const sessions=new Map();
 const scrub=(text,session)=>{
  let value=String(text||'');
  for(const secret of [session?.token,config().DATABASE_URL,config().DATABASE_DIRECT_URL,config().SETUP_KEY])if(secret)value=value.split(secret).join('[redacted]');
  return value.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[private database URL]').replace(/npg_[a-zA-Z0-9]+/g,'[redacted]').slice(0,14000);
 };
 const get=key=>{const s=sessions.get(key);if(!s||now()-s.lastUsed>TTL){sessions.delete(key);throw httpError(409,'Your publishing connection expired. Connect Vercel again.');}s.lastUsed=now();return s;};
 async function api(s,path,{method='GET',body,scope=null,params={}}={}){
  const url=new URL(path,'https://api.vercel.com');if(url.origin!=='https://api.vercel.com')throw httpError(400,'Invalid hosting endpoint.');
  if(scope)url.searchParams.set('teamId',scope);
  for(const[k,v]of Object.entries(params))url.searchParams.set(k,String(v));
  let response,data;
  try{response=await fetchImpl(url.toString(),{method,headers:{Authorization:'Bearer '+s.token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(35000)});data=await response.json();}
  catch{throw httpError(502,'Vercel did not respond in time. Your file was not published automatically; check the deployment status before retrying.');}
  if(!response.ok){const status=response.status===401||response.status===403?403:response.status===429?429:502;const message=response.status===401?'Vercel rejected that access token. Create a valid token for the account/team that owns LIFEGEN.':response.status===403?'This token cannot access that Vercel account/team. Check its scope and permissions.':scrub(data?.error?.message||data?.message||'Hosting request failed.',s);throw httpError(status,message);}
  return data;
 }
 const scopeFor=(s,scope)=>{const id=String(scope||'');if(!s.scopes.some(v=>v.id===id))throw httpError(400,'Choose an account/team returned by Vercel.');return id;};
 async function projects(s,scope){
  scope=scopeFor(s,scope);const all=[];let until;
  for(let page=0;page<10;page++){
   const data=await api(s,'/v10/projects',{scope,params:{limit:100,...(until?{until}:{})}}),items=Array.isArray(data)?data:data.projects||[];
   for(const p of items)if(idOk(p.id)&&typeof p.name==='string')all.push({id:p.id,name:p.name,framework:p.framework||null,account_id:idOk(p.accountId)?p.accountId:null});
   const next=data.pagination?.next;if(!next||next===until)break;until=next;
  }
  s.projects=all;s.scope=scope;return all;
 }
 async function approved(buffer){
  const hash=sha(buffer);for(const path of approvedZipPaths){try{if(sha(await fs.readFile(path))===hash)return;}catch{}}
  throw httpError(400,'This is not an approved LIFEGEN release ZIP. Download the current package supplied with this publishing tool.');
 }
 return {
  async connect(key,token){
   if(typeof token!=='string'||token.trim().length<10||token.length>600||!/^[A-Za-z0-9._-]+$/.test(token.trim()))throw httpError(400,'Paste a Vercel access token, not your password or database URL.');
   for(const[k,v]of sessions)if(now()-v.lastUsed>TTL)sessions.delete(k);
   if(sessions.size>=20&&!sessions.has(key))throw httpError(429,'Too many publishing connections. Disconnect an older session first.');
   const s={token:token.trim(),lastUsed:now(),projects:[],scope:'',scopes:[{id:'',name:'Personal account'}],archive:null,job:null,busy:false};
   // Invalid tokens fail here; team-only permissions are handled by scope selection.
   try{const teams=await api(s,'/v2/teams',{params:{limit:100}});for(const t of teams.teams||[])if(idOk(t.id))s.scopes.push({id:t.id,name:String(t.name||t.slug||t.id)});}
   catch(e){if(e.status!==403)throw e;await api(s,'/v10/projects',{params:{limit:1}});}
   let loaded=[];for(const scope of s.scopes){try{loaded=await projects(s,scope.id);if(loaded.length)break;}catch(e){if(e.status!==403)throw e;}}
   sessions.set(key,s);return {connected:true,scopes:s.scopes,scope:s.scope,projects:loaded};
  },
  status(key){const s=sessions.get(key);if(!s||now()-s.lastUsed>TTL){sessions.delete(key);return {connected:false};}return {connected:true,scopes:s.scopes,scope:s.scope,projects:s.projects,archive:s.archive?{hash:s.archive.hash,version:s.archive.version,files_count:s.archive.files_count,size:s.archive.size,flattened:s.archive.flattened}:null,job:s.job?{id:s.job.id,state:s.job.state,url:s.job.url}:null};},
  async projects(key,scope){const s=get(key);if(s.busy)throw httpError(409,'Wait for the current publishing request.');return {projects:await projects(s,scope),scope:s.scope};},
  async upload(key,buffer){if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_ZIP)throw httpError(400,'Upload a valid LIFEGEN ZIP smaller than 5 MB.');const s=get(key);if(s.busy)throw httpError(409,'Wait for the current publishing request.');await approved(buffer);const a=inspectArchive(buffer);s.archive=a;return {hash:a.hash,version:a.version,files_count:a.files_count,size:a.size,flattened:a.flattened};},
  async publish(key,{project_id,archive_hash,confirm}){
   const s=get(key);if(s.busy)throw httpError(409,'Publishing is already in progress.');
   if(s.job&&!['READY','ERROR','CANCELED'].includes(s.job.state))throw httpError(409,'A deployment is still building. Check its status before starting another.');
   const project=s.projects.find(p=>p.id===project_id);
   if(!project||!idOk(project_id))throw httpError(400,'Choose a project from your connected account/team.');
   if(confirm!==true)throw httpError(400,'Confirm that you want to publish to the selected existing project.');
   if(!s.archive||s.archive.hash!==archive_hash)throw httpError(409,'Choose and validate your ZIP again.');
   const env=config();if(!env.DATABASE_URL||!env.DATABASE_DIRECT_URL)throw httpError(503,'The private Neon connection is not available on this server.');
   const db=new URL(env.DATABASE_URL),direct=new URL(env.DATABASE_DIRECT_URL);
   if(!db.hostname.endsWith('.neon.tech')||!direct.hostname.endsWith('.neon.tech')||db.pathname!==direct.pathname)throw httpError(503,'Use the pooled and direct URLs for the same Neon database.');
   const projectScope=s.scope||(project.account_id?.startsWith('team_')?project.account_id:'');
   s.busy=true;
   try{
    // Never return the environment API response; it can contain sensitive values.
    const variables=[['DATABASE_URL',env.DATABASE_URL],['DATABASE_DIRECT_URL',env.DATABASE_DIRECT_URL],...(env.SETUP_KEY?[['SETUP_KEY',env.SETUP_KEY]]:[]),['LOCAL_DEMO','false'],['HOSTED_PREVIEW','false'],['ENABLE_DEPLOY_HELPER','false'],['LEGACY_VIP_RESTORE','false'],['SITE_URL','']].map(([key,value])=>({key,value,type:['DATABASE_URL','DATABASE_DIRECT_URL','SETUP_KEY'].includes(key)?'sensitive':'plain',target:['production','preview']}));
    const saved=await api(s,'/v10/projects/'+encodeURIComponent(project.id)+'/env',{method:'POST',scope:projectScope,params:{upsert:'true'},body:variables});
    if(saved.failed?.length)throw httpError(502,'Vercel could not save all environment settings. No deployment was started. Check token permissions.');
    const deployment=await api(s,'/v13/deployments',{method:'POST',scope:projectScope,params:{forceNew:1,skipAutoDetectionConfirmation:1},body:{name:project.name,project:project.id,target:'production',files:s.archive.files,projectSettings:{...DEPLOY_SETTINGS,skipGitConnectDuringLink:true},meta:{lifegen_release:s.archive.version,lifegen_archive_sha256:s.archive.hash}}});
    if(!idOk(deployment.id))throw httpError(502,'Vercel did not return a valid deployment ID. Check its dashboard before retrying.');
    s.job={id:deployment.id,state:deployment.readyState||'QUEUED',url:deployment.url?'https://'+String(deployment.url).replace(/^https?:\/\//,''):null,scope:projectScope,project_id:project.id,project_name:project.name};
    return {id:s.job.id,state:s.job.state,url:s.job.url,project:project.name,environment_saved:true};
   }finally{s.busy=false;}
  },
  async poll(key){
   const s=get(key);if(!s.job)return {job:null};
   const data=await api(s,'/v13/deployments/'+encodeURIComponent(s.job.id),{scope:s.job.scope});s.job.state=data.readyState||s.job.state;
   if(data.url)s.job.url='https://'+String(data.url).replace(/^https?:\/\//,'');
   const aliases=(data.alias||[]).filter(v=>typeof v==='string'&&/^[a-zA-Z0-9.-]+$/.test(v)).map(v=>'https://'+v);
   let logs='';try{const events=await api(s,'/v3/deployments/'+encodeURIComponent(s.job.id)+'/events',{scope:s.job.scope,params:{follow:0,limit:40,direction:'backward'}});if(Array.isArray(events))logs=scrub(events.map(e=>e.payload?.text||e.text||'').filter(Boolean).join('\n'),s);}catch{}
   return {job:{id:s.job.id,state:s.job.state,url:s.job.url,aliases,project:s.job.project_name,error:scrub(data.errorMessage||data.aliasError?.message||'',s),logs}};
  },
  disconnect(key){sessions.delete(key);return {connected:false};},
  // Test visibility contains no tokens and is never an HTTP endpoint.
  sessionCount(){return sessions.size;}
 };
}

export function createDeploymentRouter({service=createDeploymentService(),enabled=deploymentHelperEnabled}={}){
 const router=Router();
 router.use((req,res,next)=>{if(!enabled())return next(httpError(404,'Publishing helper is not enabled on this host.'));next();});
 router.use(requireStaff,(req,res,next)=>{requirePermission(req.actor,'settings:manage');next();});
 router.use((req,res,next)=>{if(req.method!=='GET'){checkOrigin(req);checkCsrf(req);}next();});
 const key=req=>req.actor.session_hash;
 router.get('/status',(req,res)=>res.json(service.status(key(req))));
 router.post('/connect',async(req,res)=>res.json(await service.connect(key(req),req.body.token)));
 router.post('/projects',async(req,res)=>res.json(await service.projects(key(req),req.body.scope)));
 router.post('/archive',raw({type:'application/zip',limit:MAX_ZIP}),async(req,res)=>res.json(await service.upload(key(req),req.body)));
 router.post('/publish',async(req,res)=>res.json(await service.publish(key(req),req.body)));
 router.get('/job',async(req,res)=>res.json(await service.poll(key(req))));
 router.post('/disconnect',(req,res)=>res.json(service.disconnect(key(req))));
 return router;
}
