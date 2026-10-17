(() => {
 const token=new URLSearchParams(location.search).get('t');
 const message=document.getElementById('message');
 const button=document.getElementById('present');
 const recover=document.getElementById('recover');
 const date=document.getElementById('date');
 const name=document.getElementById('name');
 const setMessage=(s)=>{message.textContent=s;};
 if(!token||token.length>200){setMessage('This QR code is invalid. Please scan the printed service QR again.');return;}
 (async()=>{
  try{
   const r=await fetch('/api/public/service-checkin?t='+encodeURIComponent(token),{credentials:'same-origin'});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Cannot verify service.');
   date.textContent=data.service_date;
   if(!data.registered){setMessage('Your VIP registration is not linked to this browser.');recover.hidden=false;return;}
   name.textContent='Welcome, '+data.attendee.name;
   if(!data.can_check_in){setMessage('Check-in is available only on this service date.');return;}
   setMessage('Tap Present to submit your attendance for validation.');
   button.hidden=false;button.disabled=false;
   button.addEventListener('click',async()=>{
    button.disabled=true;setMessage('Submitting…');
    try{
     const result=await fetch('/api/public/service-checkin',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':data.csrf_token},credentials:'same-origin',body:JSON.stringify({t:token})});
     const body=await result.json();if(!result.ok)throw Error(body.error||'Unable to check in.');
     setMessage(body.message||'Attendance request submitted.');
    }catch(error){setMessage(error.message);button.disabled=false;}
   });
  }catch(error){setMessage(error.message);}
 })();
})();
