import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
const out=path.resolve(process.env.LIFEGEN_ZIP_PATH||path.join(root,'..','LIFEGEN-Vercel-Deploy.zip'));
const include=['.env.example','.gitignore','.vercelignore','DEPLOY-FIRST.md','README.md','database','docs','package.json','package-lock.json','public','scripts','src','vercel.json'];
try{unlinkSync(out);}catch{}
const r=spawnSync('zip',['-q','-9','-r',out,...include],{cwd:root,encoding:'utf8'});
if(r.status!==0)throw new Error(r.stderr||'Could not create release ZIP (zip utility required).');
const bytes=readFileSync(out),sum=createHash('sha256').update(bytes).digest('hex');
writeFileSync(out+'.sha256',`${sum}  ${path.basename(out)}\n`);
// Refuse accidental packaging of environment or private data, and require the declared release version.
const listing=spawnSync('unzip',['-Z1',out],{encoding:'utf8'});
if(listing.status!==0)throw new Error('Could not validate release ZIP.');
const bad=listing.stdout.split(/\r?\n/).filter(n=>/(^|\/)\.env(?:$|\.)/.test(n)&&n!=='.env.example'||/(^|\/)(?:node_modules|private-data|tests)(?:\/|$)/.test(n));
if(bad.length)throw new Error(`Release archive contains excluded paths: ${bad.join(', ')}`);
if(!listing.stdout.split(/\r?\n/).includes('src/app.js'))throw new Error('Release archive is missing the application entry point.');
console.log(`Created LIFEGEN Vercel ZIP v${manifest.version}: ${(bytes.length/1024).toFixed(1)} KB (DEFLATE level 9), SHA-256 ${sum}.`);
