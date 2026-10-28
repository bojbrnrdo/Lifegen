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
 if(typeof raw!=='string'||raw.length>300||!raw||raw.includes('\\')||raw.includes('\0')||path.isAbsolute(raw))throw httpError(400,'Invalid path.');
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
 if(bytes.includes(0))throw httpError(415,'Binary files cannot be edited.');
 res.json({path:raw,content:bytes.toString('utf8'),version:crypto.createHash('sha256').update(bytes).digest('hex')});
});
router.put('/file',(req,res,next)=>{try{origin(req);csrf(req);next();}catch(e){next(e);}},async(req,res)=>{
 const {path:raw,content,version}=req.body||{};
 if(typeof content!=='string'||Buffer.byteLength(content)>512*1024||typeof version!=='string'||!/^[a-f0-9]{64}$/.test(version))throw httpError(400,'Invalid file content or version.');
 const absolute=await safePath(raw),stat=await fs.stat(absolute);
 if(!stat.isFile()||stat.size>512*1024)throw httpError(413,'File is not editable.');
 const original=await fs.readFile(absolute),hash=crypto.createHash('sha256').update(original).digest('hex');
 if(hash!==version)throw httpError(409,'File changed on disk. Reload before saving.');
 if(original.includes(0))throw httpError(415,'Binary file.');
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
 const {stdout}=await runGit('git',['status','--porcelain=v1','--untracked-files=normal'],{cwd:base,maxBuffer:200000,timeout:5000});
 res.json({entries:stdout.split('\n').filter(Boolean).map(line=>({status:line.slice(0,2),path:line.slice(3)})).filter(item=>{try{resolveLifeIdePath(item.path,base);return true;}catch{return false;}})});
});
router.get('/git/diff',async(req,res)=>{
 const raw=req.query.path;
 await safePath(raw);
 const {stdout}=await runGit('git',['diff','--no-ext-diff','--',raw],{cwd:base,maxBuffer:512000,timeout:5000});
 res.json({path:raw,diff:stdout});
});
return router;
}
export default createLifeIdeRouter();
