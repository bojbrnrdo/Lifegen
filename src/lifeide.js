import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {requireStaff,checkOrigin,checkCsrf} from './auth.js';
import {httpError} from './domain.js';
const router=express.Router();
const enabled=()=>process.env.LIFEIDE_LOCAL_EDIT==='true'&&process.env.NODE_ENV!=='production'&&!process.env.VERCEL&&!process.env.HOSTED_PREVIEW;
const base=path.resolve(process.cwd());
const ignored=new Set(['.git','node_modules','.env','.vercel','backup','preview-db','.next','dist']);
function guard(req,res,next){if(!enabled())return res.status(404).json({message:'LifeIDE repository editing is disabled.'});next();}
function admin(req,res,next){if(req.actor?.role_id!=='admin')return next(httpError(403,'Administrator access is required.'));next();}
function target(raw){
 if(typeof raw!=='string'||raw.length>300||!raw||raw.includes('\\')||raw.includes('\0')||path.isAbsolute(raw))throw httpError(400,'Invalid path.');
 const pieces=raw.split('/');
 if(pieces.some(x=>!x||x==='.'||x==='..'||ignored.has(x)||x.startsWith('.env')))throw httpError(400,'Restricted path.');
 const resolved=path.resolve(base,...pieces);
 if(!resolved.startsWith(base+path.sep))throw httpError(400,'Invalid path.');
 return resolved;
}
async function safePath(raw,{create=false}={}){
 const absolute=target(raw);
 const relative=path.relative(base,absolute).split(path.sep);
 let probe=base;
 for(let i=0;i<relative.length;i++){
  probe=path.join(probe,relative[i]);
  let stat;
  try{stat=await fs.lstat(probe);}catch(e){if(e.code==='ENOENT'&&create&&i===relative.length-1)return absolute;throw httpError(404,'Path not found.');}
  if(stat.isSymbolicLink())throw httpError(403,'Symbolic links are not accessible.');
 }
 return absolute;
}
router.use(guard,requireStaff,admin);
router.get('/tree',async(req,res)=>{
 const dir=typeof req.query.path==='string'&&req.query.path?req.query.path:null;
 const absolute=dir?await safePath(dir):base;
 if(!(await fs.stat(absolute)).isDirectory())throw httpError(400,'Not a directory.');
 const entries=await fs.readdir(absolute,{withFileTypes:true});
 const items=entries.filter(e=>!ignored.has(e.name)&&!e.name.startsWith('.env')&&!e.isSymbolicLink()).map(e=>({name:e.name,type:e.isDirectory()?'folder':e.isFile()?'file':'other'})).filter(e=>e.type!=='other').sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='folder'?-1:1);
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
router.put('/file',(req,res,next)=>{try{checkOrigin(req);checkCsrf(req);next();}catch(e){next(e);}},async(req,res)=>{
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
export default router;
