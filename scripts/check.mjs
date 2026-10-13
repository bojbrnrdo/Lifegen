import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=['src','scripts','public/admin/js','public/lifegen','public/vip-announce'].flatMap(walk).filter(f=>/\.(m?js)$/.test(f));let failed=false;
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){console.error(file,r.stderr);failed=true;}}
const publicCode=walk('public').filter(f=>/\.(html|js)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
if(/sb_publishable_|SUPABASE_ANON_KEY|postgres(?:ql)?:\/\//.test(publicCode)){console.error('Database credential found in public assets.');failed=true;}
// Server TLS must always verify the database certificate chain (this scanner excluded).
for(const file of files.filter(f=>f.startsWith('src'+path.sep)||f.startsWith('scripts'+path.sep)).filter(f=>f!==path.join('scripts','check.mjs'))){
 const code=fs.readFileSync(file,'utf8');
 if(/NODE_TLS_REJECT_UNAUTHORIZED/.test(code)||/rejectUnauthorized\s*[:=]\s*false/.test(code)){console.error(`TLS certificate verification must stay enabled: ${file}. Add the Supabase project CA through DATABASE_SSL_ROOT_CERT instead.`);failed=true;}
}
const deployment=JSON.parse(fs.readFileSync('vercel.json','utf8'));
if(deployment.framework!=='express'||deployment.outputDirectory!==null||!fs.existsSync('src/app.js')){console.error('Vercel must use the Express preset with src/app.js and automatic output directory.');failed=true;}
if(failed)process.exit(1);console.log(`Checked ${files.length} JavaScript files. No database credentials in public assets. One website and Admin portal share the same API.`);
