// Date planning for printed Sunday passes, using the church's Asia/Manila day
// rather than the administrator's device timezone (which may be elsewhere).
export function manilaToday(now=new Date()) {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const lookup=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return `${lookup.year}-${lookup.month}-${lookup.day}`;
}
export function sundayOptions(today=manilaToday(),count=8){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(today))throw new Error('Invalid Manila date');
 const day=new Date(`${today}T12:00:00Z`);
 if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==today)throw new Error('Invalid Manila date');
 const untilSunday=(7-day.getUTCDay())%7;
 day.setUTCDate(day.getUTCDate()+untilSunday);
 const date=d=>d.toISOString().slice(0,10);
 return Array.from({length:count},(_,index)=>{const d=new Date(day);d.setUTCDate(d.getUTCDate()+index*7);return date(d);});
}
