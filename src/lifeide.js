import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const runGit=promisify(execFile);
import {requireStaff,checkOrigin,checkCsrf} from './auth.js';
import {httpError} from './domain.js';

const enabled=()=>process.env.LIFEIDE_LOCAL_EDIT==='true'&&process.env.NODE_ENV!=='production'&&!process.env.VERCEL&&!process.env.HOSTED_PREVIEW;

const ignored=new Set(['.git','node_modules','.env','.vercel','backup','preview-db','.next','dist']);
function guard(req,res,next){if(!enabled())return res.status(404).json({message:'LifeIDE repository editing is disabled.'});next();}
function admin(req,res,next){if(req.actor?.role_id!=='admin')return next(httpError(403,'Administrator access is required.'));next();}
export function resolveLifeIdePath(raw,workspace=path.resolve(process.cwd())){
 if(typeof raw!=='string'||raw.length>300||!raw||raw.includes('\\')||/[\x00-\x1f\x7f]/.test(raw)||path.isAbsolute(raw))throw httpError(400,'Invalid path.');
 const pieces=raw.split('/');
 if(pieces.some(x=>!x||x==='.'||x==='..'||ignored.has(x)||x.startsWith('.')))throw httpError(400,'Restricted path.');
 const resolved=path.resolve(workspace,...pieces);
 if(!resolved.startsWith(workspace+path.sep))throw httpError(400,'Invalid path.');
 return resolved;
}
export async function verifyLifeIdePath(raw,{create=false,workspace=path.resolve(process.cwd())}={}){
 const absolute=resolveLifeIdePath(raw,workspace);
 const relative=path.relative(workspace,absolute).split(path.sep);
 let probe=workspace;
 for(let i=0;i<relative.length;i++){
  probe=path.join(probe,relative[i]);
  let stat;
  try{stat=await fs.lstat(probe);}catch(e){if(e.code==='ENOENT'&&create&&i===relative.length-1)return absolute;throw httpError(404,'Path not found.');}
  if(stat.isSymbolicLink())throw httpError(403,'Symbolic links are not accessible.');
 }
 return absolute;
}
export function createLifeIdeRouter({workspace=path.resolve(process.cwd()),authenticate=requireStaff,access=guard,checkRole=admin,origin=checkOrigin,csrf=checkCsrf}={}){
 const router=express.Router();
 const base=workspace;
 const safePath=(raw,options={})=>verifyLifeIdePath(raw,{...options,workspace:base});
 router.use(access,authenticate,checkRole);
router.get('/tree',async(req,res)=>{
 const dir=typeof req.query.path==='string'&&req.query.path?req.query.path:null;
 const absolute=dir?await safePath(dir):base;
 if(!(await fs.stat(absolute)).isDirectory())throw httpError(400,'Not a directory.');
 const entries=await fs.readdir(absolute,{withFileTypes:true});
 const items=entries.filter(e=>!ignored.has(e.name)&&!e.name.startsWith('.')&&!e.isSymbolicLink()).map(e=>({name:e.name,type:e.isDirectory()?'folder':e.isFile()?'file':'other'})).filter(e=>e.type!=='other').sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='folder'?-1:1);
 res.json({path:dir||'',items});
});
router.get('/file',async(req,res)=>{
 const raw=req.query.path,absolute=await safePath(raw);
 const stat=await fs.stat(absolute);
 if(!stat.isFile()||stat.size>512*1024)throw httpError(413,'File is not an editable text file.');
 const bytes=await fs.readFile(absolute);
 if(bytes.length>512*1024)throw httpError(413,'File is too large to edit.');
 if(bytes.includes(0))throw httpError(415,'Binary files cannot be edited.');
 try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw httpError(415,'Only UTF-8 text files are editable.');}
 res.json({path:raw,content:bytes.toString('utf8'),version:crypto.createHash('sha256').update(bytes).digest('hex')});
});
router.put('/file',(req,res,next)=>{try{origin(req);csrf(req);next();}catch(e){next(e);}},async(req,res)=>{
 const {path:raw,content,version}=req.body||{};
 if(typeof content!=='string'||Buffer.byteLength(content)>512*1024||typeof version!=='string'||!/^[a-f0-9]{64}$/.test(version))throw httpError(400,'Invalid file content or version.');
 if(content.includes('\0'))throw httpError(415,'Binary content cannot be saved.');
 const utf8=Buffer.from(content,'utf8');
 if(utf8.toString('utf8')!==content)throw httpError(415,'Invalid Unicode content cannot be saved.');
 const absolute=await safePath(raw),stat=await fs.stat(absolute);
 if(!stat.isFile()||stat.size>512*1024)throw httpError(413,'File is not editable.');
 const original=await fs.readFile(absolute),hash=crypto.createHash('sha256').update(original).digest('hex');
 if(hash!==version)throw httpError(409,'File changed on disk. Reload before saving.');
 if(original.length>512*1024)throw httpError(413,'File is too large to edit.');
 if(original.includes(0))throw httpError(415,'Binary file.');
 try{new TextDecoder('utf-8',{fatal:true}).decode(original);}catch{throw httpError(415,'Only UTF-8 text files are editable.');}
 await fs.writeFile(absolute,content,{flag:'w'});
 res.json({ok:true,version:crypto.createHash('sha256').update(content).digest('hex')});
});

router.post('/entry',(req,res,next)=>{try{origin(req);csrf(req);next();}catch(e){next(e);}},async(req,res)=>{
 const {path:raw,type}=req.body||{};
 if(type!=='file'&&type!=='folder')throw httpError(400,'Invalid entry type.');
 const absolute=await safePath(raw,{create:true});
 try{
  if(type==='folder')await fs.mkdir(absolute);
  else await fs.writeFile(absolute,'',{flag:'wx'});
 }catch(e){if(e.code==='EEXIST')throw httpError(409,'An entry with this name already exists.');throw e;}
 res.status(201).json({ok:true,path:raw,type});
});
router.get('/git/status',async(req,res)=>{
 const {stdout}=await runGit('git',['status','--porcelain=v1','-z','--untracked-files=normal'],{cwd:base,maxBuffer:200000,timeout:5000});
 const fields=stdout.split('\0'),entries=[];
 for(let i=0;i<fields.length;i++){
  const line=fields[i];if(!line)continue;
  const status=line.slice(0,2),file=line.slice(3);
  if(status.includes('R')||status.includes('C')){i++;continue;}
  try{resolveLifeIdePath(file,base);entries.push({status,path:file});}catch{}
 }
 res.json({entries});
});
router.get('/git/diff',async(req,res)=>{
 const raw=req.query.path;
 await safePath(raw);
 const {stdout}=await runGit('git',['diff','--no-ext-diff','--',raw],{cwd:base,maxBuffer:512000,timeout:5000});
 res.json({path:raw,diff:stdout});
});
// Git changes are local-only, admin-only, and require the existing CSRF safeguards.
const gitWrite=(req,res,next)=>{try{origin(req);csrf(req);next();}catch(e){next(e);}};
router.post('/git/commit',gitWrite,async(req,res)=>{
 const paths=req.body?.paths,message=req.body?.message;
 if(!Array.isArray(paths)||paths.length<1||paths.length>30||new Set(paths).size!==paths.length)throw httpError(400,'Select 1–30 distinct files.');
 if(typeof message!=='string'||message.trim().length<5||message.length>160||/[\r\n\x00-\x1f]/.test(message))throw httpError(400,'Provide a one-line commit message (5–160 characters).');
 for(const file of paths)await safePath(file);
 const git=async args=>(await runGit('git',['-c','core.hooksPath=/dev/null',...args],{cwd:base,maxBuffer:512000,timeout:10000})).stdout;
 const branch=(await git(['branch','--show-current'])).trim();
 if(!branch||branch==='main'||branch==='master'||branch.startsWith('release/'))throw httpError(409,'Switch to a feature branch before committing.');
 const staged=(await git(['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
 if(staged.length)throw httpError(409,'Existing staged files detected. Commit or unstage them outside LifeIDE first.');
 const changed=(await git(['status','--porcelain=v1','-z','--untracked-files=normal'])).split('\0').filter(Boolean);
 const allowed=new Set(changed.filter(x=>!x.startsWith('R')&&!x.startsWith('C')).map(x=>x.slice(3)));
 if(paths.some(x=>!allowed.has(x)))throw httpError(409,'Refresh Git Changes and select modified or untracked files.');
 await git(['add','--',...paths]);
 const actual=(await git(['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
 if(actual.length!==paths.length||actual.some(x=>!paths.includes(x))){await git(['reset','--quiet','--',...paths]).catch(()=>{});throw httpError(409,'Unexpected staged changes. Commit was stopped; inspect the Git index.');}
 try {
  await git(['commit','-m',message.trim(),'--only','--',...paths]);
 } catch(error) {
  await git(['reset','--quiet','--',...paths]).catch(()=>{});
  throw error;
 }
 const hash=(await git(['rev-parse','--short','HEAD'])).trim();
 res.json({ok:true,branch,commit:hash});
});
return router;
}
export default createLifeIdeRouter();
