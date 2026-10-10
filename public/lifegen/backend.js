// Same-origin HTTP API adapter. No Neon or Supabase credentials are exposed to the browser.
window.Lifegen=(()=>{
 let vipState=null,config=null,clockBase=Date.now(),clockAt=performance.now(),notify=()=>{};
 const utcNow=()=>new Date(clockBase+performance.now()-clockAt);
 const churchNow=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(utcNow()).map(x=>[x.type,x.value]));return new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`);};
 const getDevice=()=>vipState?.registered?{token:String(vipState.vip.id),name:vipState.vip.name}:null;
 const setDevice=()=>{if(vipState?.registered&&config?.legacy_restore_enabled===true){try{localStorage.removeItem('lifegen_device');}catch{}}};
 async function request(url,body){const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(vipState?.csrf_token)headers['X-CSRF-Token']=vipState.csrf_token;const r=await fetch(url,{method:body===undefined?'GET':'POST',headers,credentials:'same-origin',cache:'no-store',body:body===undefined?undefined:JSON.stringify(body)});let data={};try{data=await r.json();}catch{}if(!r.ok){const e=new Error(data.message||'Could not complete this request.');e.status=r.status;throw e;}return data;}
 const refreshVip=async()=>vipState=await request('/api/public/vip');
 function showRecovery(code){let box=document.getElementById('recoveryCodeBox');if(!box){box=document.createElement('div');box.id='recoveryCodeBox';box.className='recovery-code-box';document.getElementById('vip-attendance-dashboard').prepend(box);}box.innerHTML='<b>Save your private VIP recovery code</b><p>Use this on another phone or if browser cookies are cleared. Keep it private.</p>';const c=document.createElement('code');c.textContent=code;box.append(c);const b=document.createElement('button');b.type='button';b.className='btn btn-gold';b.textContent='Copy recovery code';b.onclick=()=>navigator.clipboard.writeText(code).then(()=>notify('Recovery code copied. Save it somewhere safe.','copy')).catch(()=>notify('Select and copy your code manually.','info'));box.append(b);}
 const DB={
  addRegistration:async reg=>{const button=document.querySelector('#vip-signup-form button[type=submit]');button.disabled=true;try{let key=sessionStorage.getItem('lifegen_registration_request');if(!key){key=crypto.randomUUID();sessionStorage.setItem('lifegen_registration_request',key);}const r=await request('/api/public/registrations',{...reg,privacy_consent:document.getElementById('vip-consent').checked,idempotency_key:key,website:document.getElementById('vip-website').value});await refreshVip();sessionStorage.removeItem('lifegen_registration_request');if(r.recovery_code)showRecovery(r.recovery_code);}finally{button.disabled=false;}},
  listCheckinsFor:async()=> (await refreshVip()).checkins||[],addCheckin:()=>request('/api/public/checkins',{}),
  listPosts:()=>request('/api/public/posts'),addPost:p=>request('/api/public/posts',{type:p.type,author:p.author,content:p.content,is_anonymous:p.isAnonymous}),
  getPrize:async()=> (await request('/api/public/prize')).value
 };
 async function initialize({sync,verse,toast,reducedMotion}){
  notify=toast;
  for(const id of ['adminToggle','footerAdmin'])document.getElementById(id)?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();location.assign('/admin');},true);
  document.getElementById('show-vip-recovery').onclick=()=>{document.getElementById('vip-recovery-form').hidden=false;document.getElementById('vip-recovery-code').focus();};
  document.getElementById('vip-recovery-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await request('/api/public/vip/restore',{recovery_code:document.getElementById('vip-recovery-code').value});await refreshVip();sync();e.target.hidden=true;toast('Welcome back. Your VIP portal is restored.','check');}catch(err){document.getElementById('vip-recovery-error').textContent=err.message;}finally{b.disabled=false;}};
  try{config=await request('/api/public/config');clockBase=new Date(config.server_time).getTime();clockAt=performance.now();
   if(config.hosted_preview&&!config.preview){const note=document.createElement('div');note.className='public-preview';note.textContent='Connected preview · your real Neon database. New registrations are saved here.';document.body.prepend(note);}
   if(config.preview){const note=document.createElement('div');note.className='public-preview';note.textContent='Demonstration · temporary local PostgreSQL, not your Neon project. Test records only.';document.body.prepend(note);}
   await refreshVip();
   if(!vipState.registered&&config.legacy_restore_enabled===true){let old=null;try{old=JSON.parse(localStorage.getItem('lifegen_device'));}catch{}if(old?.token){try{await request('/api/public/vip/restore',{legacy_token:old.token});await refreshVip();localStorage.removeItem('lifegen_device');}catch{toast('Your old VIP record must be imported before this portal can be restored. Contact the LIFEGEN team.','info');document.querySelector('#vip-signup-form button[type=submit]').disabled=true;}}}
   sync();verse(false);if(location.hash==='#vip'){const target=vipState.registered?document.getElementById('vip-attendance-dashboard'):document.getElementById('vip-signup-form');target.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'start'});}
  }catch(e){const note=document.createElement('div');note.className='backend-warning';note.textContent=e.message+' No registration has been saved.';document.body.prepend(note);}
  setInterval(()=>{if(document.visibilityState==='visible'&&vipState?.registered)sync();},15000);
 }
 return {DB,getDevice,setDevice,churchNow,utcNow,initialize,request};
})();
