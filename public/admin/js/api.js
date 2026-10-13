// All records live in Supabase PostgreSQL through the server API. No browser database engine.
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
// Design uploads use XHR so the browser can report real upload progress.
// The title travels URI-encoded because HTTP header values are latin-1.
export function uploadDesign(file,{title,mode='background',onProgress,signal}={}){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open('POST','/api/vip-designs');
  xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
  xhr.setRequestHeader('X-Design-Title',encodeURIComponent(title||''));
  xhr.setRequestHeader('X-Design-Mode',mode);
  if(csrf)xhr.setRequestHeader('X-CSRF-Token',csrf);
  if(previewSessionToken)xhr.setRequestHeader('X-Lifegen-Preview-Session',previewSessionToken);
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(Math.round((e.loaded/e.total)*100));};
  xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText);}catch{}
   if(data.csrf_token)csrf=data.csrf_token;
   if(xhr.status>=200&&xhr.status<300){resolve(data);return;}
   if(xhr.status===401){previewSessionToken=null;window.dispatchEvent(new Event('auth:expired'));}
   const err=new Error(data.message||`Upload failed (${xhr.status}).`);err.status=xhr.status;reject(err);};
  xhr.onerror=()=>reject(new Error('The upload could not reach the server. Check the connection and try again.'));
  xhr.onabort=()=>reject(new Error('Upload cancelled.'));
  if(signal)signal.addEventListener('abort',()=>xhr.abort(),{once:true});
  xhr.send(file);
 });
}
export function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename||'lifegen-export';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const api={
 vipDesigns:()=>request('/api/vip-designs'),vipDesignSelection:date=>request('/api/vip-designs/selection/'+encodeURIComponent(date)),vipDesignPreviewPick:date=>request('/api/vip-designs/preview/'+encodeURIComponent(date)),vipDesignSelect:(date,body)=>request('/api/vip-designs/selection/'+encodeURIComponent(date),{method:'POST',body}),vipDesignUpdate:(id,body)=>request('/api/vip-designs/'+encodeURIComponent(id),{method:'PATCH',body}),vipDesignDelete:id=>request('/api/vip-designs/'+encodeURIComponent(id),{method:'DELETE'}),uploadDesign,
 deploymentStatus:()=>request('/api/deploy/status'),connectDeployment:token=>request('/api/deploy/connect',{method:'POST',body:{token}}),deploymentProjects:scope=>request('/api/deploy/projects',{method:'POST',body:{scope}}),uploadDeployment:file=>request('/api/deploy/archive',{method:'POST',body:file,upload:true}),publishDeployment:body=>request('/api/deploy/publish',{method:'POST',body}),deploymentJob:()=>request('/api/deploy/job'),disconnectDeployment:()=>request('/api/deploy/disconnect',{method:'POST',body:{}}),
 qs,get:url=>call('get',url),
 status:async()=>{const r=await request('/api/auth/status');if(!r.user)stopSync?.();return r;},login:(username,password)=>request('/api/auth/login',{method:'POST',body:{username,password}}),setup:body=>request('/api/auth/setup',{method:'POST',body}),recoverAdmin:body=>request('/api/auth/admin-recovery',{method:'POST',body}),
 logout:async()=>{try{await request('/api/auth/logout',{method:'POST',body:{}});}finally{csrf=null;previewSessionToken=null;stopSync?.();}},
 clearPreviewSession:()=>{previewSessionToken=null;csrf=null;},
changePassword:(current,next)=>request('/api/auth/password',{method:'POST',body:{current,next}}),
 backup:async()=>{const r=await request('/api/backup',{blob:true});downloadBlob(r.blob,r.filename||'lifegen-supabase-backup.json');},
 blob:async url=>(await request(url,{blob:true})).blob,
};
const methods=['people','person','createPerson','updatePerson','duplicates','archivePerson','restorePerson','setPersonStatus','deletePerson','dashboard','search','saveSettings','system','users','roles','createUser','updateUser','demoStatus','demoLoad','demoRemove','activity','registrations','registration','registrationCounts','reviewRegistration','recoverRegistration','pendingCheckins','validateCheckin','getPrize','setPrize','qrRegistration','postsAdmin','moderatePost','calendarEvents','saveCalendarEvent','deleteCalendarEvent','services','serviceByDate','service','serviceAudit','openService','mark','undoMark','updateService','reportYears','reportSummary','lifegroupOverview','lifegroups','lifegroupOptions','lifegroupNeeds','lifegroupRecommend','lifegroup','lifegroupProgress','progressOverview','networkCalendar','networks','network','createLifegroup','updateLifegroup','deleteLifegroup','assignLifegroup','leaveLifegroup','setTier','createNetwork','updateNetwork','deleteNetwork','ensureNetworkLeaderGroup','saveMeeting','deleteMeeting','giftTracker','markGiftGiven','undoGiftGiven'];
for(const method of methods)api[method]=(...args)=>call(method,...args);
if(typeof window!=='undefined')window.__lgDownload=async url=>{const r=await request(url,{blob:true});downloadBlob(r.blob,r.filename);};
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

