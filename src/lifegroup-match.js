// Pure, deterministic Cell matching. Database writes happen in the transaction layer.
export const DEFAULT_VIP_PRIORITIES = Object.freeze(['day','area','category','capacity']);
export function validateVipPriorityOrder(value) {
 const parts=Array.isArray(value)?value:(typeof value==='string'?value.split(','):[]);
 const order=parts.map(x=>String(x).trim().toLowerCase());
 if(order.length!==4||new Set(order).size!==4||order.some(x=>!DEFAULT_VIP_PRIORITIES.includes(x)))
   throw new Error('VIP priority order must contain day, area, category and capacity exactly once.');
 return order;
}
export function recommendEligibleCells(groups,prefs={}) {
 const normalize=x=>String(x??'').trim().toLowerCase();
 const desired={day:normalize(prefs.day||prefs.preferred_day),
  area:normalize(prefs.area||prefs.preferred_area),
  category:normalize(prefs.category||prefs.preferred_category)};
 const priorityOrder=prefs.priority_order?validateVipPriorityOrder(prefs.priority_order):DEFAULT_VIP_PRIORITIES;
 const candidates=groups.filter(g=>g.is_active&&!g.leads_network&&g.leader_person_id&&
   Number(g.slots)>0&&!g.is_demo).map(g=>{
   const reasons=[];
   if(desired.day&&normalize(g.schedule_day)===desired.day)reasons.push('day');
   if(desired.area&&normalize(g.area)===desired.area)reasons.push('area');
   if(desired.category&&normalize(g.category)===desired.category)reasons.push('category');
   return {...g,reasons,score:reasons.length};
 });
 return candidates.sort((a,b)=>{
   for(const field of priorityOrder){
     const av=field==='capacity'?Number(a.slots):Number(a.reasons.includes(field));
     const bv=field==='capacity'?Number(b.slots):Number(b.reasons.includes(field));
     if(av!==bv)return bv-av;
   }
   return Number(a.id)-Number(b.id);
 });
}
