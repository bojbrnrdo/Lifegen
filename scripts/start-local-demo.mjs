import {config} from 'dotenv';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const file=resolve(process.cwd(),'.env.lifeide.local');
const loaded=config({path:file,override:false});
if(loaded.error)throw Error('Missing .env.lifeide.local. Create a private local-only DATABASE_URL first.');
const url=new URL(process.env.DATABASE_URL||'');
if(!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('Refusing to connect to a non-local database.');
if(process.env.NODE_ENV==='production'||process.env.VERCEL_ENV==='production')throw Error('Local demo cannot run in production.');
if(process.env.LOCAL_DEMO!=='true')throw Error('LOCAL_DEMO=true is required.');
if(!/^\d{2,5}$/.test(String(process.env.PORT||'18769')))throw Error('Invalid local port.');
process.env.PORT ||= '18769';
process.env.DATABASE_DIRECT_URL ||= process.env.DATABASE_URL;
const container='lifegen-lifeide-local-db';
const run=(...args)=>spawnSync('docker',args,{encoding:'utf8'});
const state=run('inspect','--format','{{.State.Running}}',container);
if(state.status!==0)throw Error('Missing Docker container '+container+'. Set up the local database before starting.');
if(state.stdout.trim()!=='true'){
 const start=run('start',container);
 if(start.status!==0)throw Error('Cannot start local database: '+start.stderr.trim());
}
let ready=false;
for(let attempt=0;attempt<30;attempt++){
 const check=run('exec',container,'pg_isready','-U',url.username,'-d',url.pathname.slice(1));
 if(check.status===0){ready=true;break;}
 await new Promise(done=>setTimeout(done,500));
}
if(!ready)throw Error('Local PostgreSQL did not become ready.');
console.log('Starting LifeGen with isolated local demo database on port '+process.env.PORT);
await import('./serve.mjs');
