import {createHmac,timingSafeEqual} from 'node:crypto';

const SECRET_NAME='SERVICE_QR_SECRET';
const MIN_SECRET_LENGTH=32;

/**
 * Signed Sunday check-in pass.
 *
 * The pass identifies a SUNDAY, not a `services` row — general Sunday attendance
 * and the `services` table were removed, so a Sunday is a calendar fact and the
 * date alone is the identity. Format: v2.<YYYY-MM-DD>.<base64url mac>
 */
const DATE_PATTERN=/^\d{4}-\d{2}-\d{2}$/;
const isSundayDate=(date)=>{ const d=new Date(`${date}T12:00:00Z`); return !Number.isNaN(d.getTime())&&d.getUTCDay()===0; };
const mac=(date,secret)=>createHmac('sha256',secret).update('lifegen-service-checkin:v2:'+date).digest('base64url');

export function serviceQrConfigured(secret=process.env[SECRET_NAME]){
 return Boolean(secret&&secret.length>=MIN_SECRET_LENGTH);
}

export function signServicePass(date,secret=process.env[SECRET_NAME]){
 if(!serviceQrConfigured(secret))throw new Error(`${SECRET_NAME} must be configured (minimum ${MIN_SECRET_LENGTH} characters).`);
 if(!DATE_PATTERN.test(String(date))||!isSundayDate(String(date)))throw new Error('Invalid service QR identity.');
 return 'v2.'+date+'.'+mac(date,secret);
}

export function verifyServicePass(token,secret=process.env[SECRET_NAME]){
 if(!serviceQrConfigured(secret))return null;
 const m=/^v2\.(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]{43})$/.exec(String(token||''));
 if(!m||!isSundayDate(m[1]))return null;
 const expected=mac(m[1],secret);
 const a=Buffer.from(m[2]);const b=Buffer.from(expected);
 if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 return {service_date:m[1]};
}
