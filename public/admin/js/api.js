// All records live on the shared server / Neon database. No localStorage data engine.
let csrf=null;
let previewSessionToken=null; // Kept only in memory for sandboxed non-production previews; never local/session storage.
let stopSync=null;
export const session={get:()=>null,set:()=>{}};
const qs=(params={})=>{const e=Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!=='');return e.length?'?'+new URLSearchParams(e):'';};
async function request(url,{method='GET',body,blob=false,upload=false}={}) {
 const headers={};if(body!==undefined)headers['Content-Type']=upload?'application/zip':'application/json';if(csrf)headers['X-CSRF-Token']=csrf;if(previewSessionToken)headers['X-Lifegen-Preview-Session']=previewSessionToken;
 const response=await fetch(url,{method,headers,credentials:'same-origin',cache:'no-store',body:body===undefined?undefined:upload?body:JSON.stringify(body)});
 if(!response.ok){let data={};try{data=await response.json();}catch{}const error=new Error(data.message||'The server request failed.');error.status=response.status;error.details=data.details;if(response.status===401&&!url.includes('/auth/login')){previewSessionToken=null;window.dispatchEvent(new Event('auth:expired'));}throw error;}
 if(blob)return {blob:await response.blob(),filename:response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1]};
 const result=await response.json();if(result.csrf_token)csrf=result.csrf_token;if(result.preview_session_token)previewSessionToken=result.preview_session_token;return result;
}
const call=(method,...args)=>request('/api/tracker/'+method,{method:'POST',body:{args}});
export function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename||'lifegen-export';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const api={
 deploymentStatus:()=>request('/api/deploy/status'),connectDeployment:token=>request('/api/deploy/connect',{method:'POST',body:{token}}),deploymentProjects:scope=>request('/api/deploy/projects',{method:'POST',body:{scope}}),uploadDeployment:file=>request('/api/deploy/archive',{method:'POST',body:file,upload:true}),publishDeployment:body=>request('/api/deploy/publish',{method:'POST',body}),deploymentJob:()=>request('/api/deploy/job'),disconnectDeployment:()=>request('/api/deploy/disconnect',{method:'POST',body:{}}),
 qs,get:url=>call('get',url),
 status:async()=>{const r=await request('/api/auth/status');if(!r.user)stopSync?.();return r;},login:(username,password)=>request('/api/auth/login',{method:'POST',body:{username,password}}),setup:body=>request('/api/auth/setup',{method:'POST',body}),recoverAdmin:body=>request('/api/auth/admin-recovery',{method:'POST',body}),
 logout:async()=>{try{await request('/api/auth/logout',{method:'POST',body:{}});}finally{csrf=null;previewSessionToken=null;stopSync?.();}},
 clearPreviewSession:()=>{previewSessionToken=null;csrf=null;},
changePassword:(current,next)=>request('/api/auth/password',{method:'POST',body:{current,next}}),
 migrate:(data,{sourceKey,dryRun=true}={})=>request('/api/migration',{method:'POST',body:{data,source_key:sourceKey,dry_run:dryRun}}),
 backup:async()=>{const r=await request('/api/backup',{blob:true});downloadBlob(r.blob,r.filename||'lifegen-neon-backup.json');},
 restore:data=>api.migrate(data,{dryRun:false}),
 download:async url=>{try{const r=await request('/api/exports',{method:'POST',body:{url},blob:true});downloadBlob(r.blob,r.filename||'lifegen-report.csv');}catch(e){window.dispatchEvent(new CustomEvent('api:message',{detail:{message:e.message,type:'error'}}));}},
 blob:async url=>(await request(url,{blob:true})).blob,
};
const methods=['people','person','createPerson','updatePerson','duplicates','archivePerson','restorePerson','setPersonStatus','deletePerson','updatePreferences','services','serviceByDate','service','serviceAudit','openService','updateService','mark','undoMark','dashboard','reportSummary','reportYears','reportLifegroups','search','lifegroups','lifegroup','lifegroupOptions','lifegroupNeeds','lifegroupRecommend','networks','network','createNetwork','updateNetwork','deleteNetwork','createLifegroup','updateLifegroup','deleteLifegroup','assignLifegroup','leaveLifegroup','saveSettings','system','users','roles','createUser','updateUser','demoStatus','demoLoad','demoRemove','activity','registrations','registration','registrationCounts','reviewRegistration','recoverRegistration','pendingCheckins','validateCheckin','getPrize','setPrize','qrRegistration','postsAdmin','moderatePost'];
for(const method of methods)api[method]=(...args)=>call(method,...args);
export function startLiveUpdates(){
 stopSync?.();let stopped=false,source,lastRevision=null,pollTimer,reconcileTimer;
 const state=s=>window.dispatchEvent(new CustomEvent('sync:state',{detail:{state:s}}));
 const changed=detail=>{const r=Number(detail.revision);if(!Number.isSafeInteger(r)||r<0)return;if(lastRevision!==null&&(r>lastRevision||(!detail.entity&&r<lastRevision)))window.dispatchEvent(new CustomEvent('db:change',{detail}));lastRevision=detail.entity?Math.max(lastRevision??0,r):r;};
 const poll=async()=>{if(stopped||document.visibilityState==='hidden')return;try{changed(await request('/api/events'));state(source?.readyState===1?'live':'refresh');}catch{state('offline');}};
 const fallback=()=>{if(!pollTimer)pollTimer=setInterval(poll,2000);state('refresh');poll();};
 if(window.EventSource){source=new EventSource('/api/events/stream',{withCredentials:true});source.addEventListener('sync',e=>{changed(JSON.parse(e.data));clearInterval(pollTimer);pollTimer=null;state('live');});source.addEventListener('change',e=>changed(JSON.parse(e.data)));source.onerror=fallback;}else fallback();
 reconcileTimer=setInterval(poll,30000);const onVisible=()=>{if(document.visibilityState==='visible')poll();};document.addEventListener('visibilitychange',onVisible);
 stopSync=()=>{stopped=true;source?.close();clearInterval(pollTimer);clearInterval(reconcileTimer);document.removeEventListener('visibilitychange',onVisible);};return stopSync;
}
window.__lgDownload=url=>api.download(url);
