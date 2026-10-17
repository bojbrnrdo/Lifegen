import {createHmac,timingSafeEqual} from 'node:crypto';

const SECRET_NAME='SERVICE_QR_SECRET';
/** Uses Manila-local calendar time, never the deployment server timezone. */
export function serviceCheckinOpen(date,now=new Date()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return false;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const value=key=>parts.find(p=>p.type===key)?.value||'';
 const day=value('year')+'-'+value('month')+'-'+value('day');
 const minutes=Number(value('hour'))*60+Number(value('minute'));
 // Sunday service begins at 1 PM. Allow an early 30-minute arrival and a
 // 30-minute grace period after the advertised 3 PM ending.
 const weekday=new Date(date+'T12:00:00Z').getUTCDay();
 return day===date&&weekday===0&&minutes>=12*60+30&&minutes<=15*60+30;
}

export function signServicePass(serviceId,date,secret=process.env[SECRET_NAME]){
 if(!secret||secret.length<32)throw new Error('SERVICE_QR_SECRET must be configured (minimum 32 characters).');
 if(!Number.isSafeInteger(Number(serviceId))||Number(serviceId)<1||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Invalid service QR identity.');
 const data=Number(serviceId)+'.'+date;
 const mac=createHmac('sha256',secret).update('lifegen-service-checkin:v1:'+data).digest('base64url');
 return 'v1.'+data+'.'+mac;
}
export function verifyServicePass(token,secret=process.env[SECRET_NAME]){
 if(!secret||secret.length<32)return null;
 const m=/^v1\.(\d{1,16})\.(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]{43})$/.exec(String(token||''));
 if(!m)return null;
 const expected=signServicePass(Number(m[1]),m[2],secret).split('.').at(-1);
 const a=Buffer.from(m[3]);const b=Buffer.from(expected);
 if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 return {service_id:Number(m[1]),service_date:m[2]};
}
