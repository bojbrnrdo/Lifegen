import {createHmac,timingSafeEqual} from 'node:crypto';

const SECRET_NAME='SERVICE_QR_SECRET';
export function signServicePass(serviceId,date,secret=process.env[SECRET_NAME]){
 if(!secret||secret.length<32)throw new Error('SERVICE_QR_SECRET must be configured (minimum 32 characters).');
 if(!Number.isSafeInteger(Number(serviceId))||Number(serviceId)<1||!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new Error('Invalid service QR identity.');
 const data=Number(serviceId)+'.'+date;
 const mac=createHmac('sha256',secret).update('lifegen-service-checkin:v1:'+data).digest('base64url');
 return 'v1.'+data+'.'+mac;
}
export function verifyServicePass(token,secret=process.env[SECRET_NAME]){
 if(!secret||secret.length<32)return null;
 const m=/^v1\\.(\\d{1,16})\\.(\\d{4}-\\d{2}-\\d{2})\\.([A-Za-z0-9_-]{43})$/.exec(String(token||''));
 if(!m)return null;
 const expected=signServicePass(Number(m[1]),m[2],secret).split('.').at(-1);
 const a=Buffer.from(m[3]);const b=Buffer.from(expected);
 if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 return {service_id:Number(m[1]),service_date:m[2]};
}
