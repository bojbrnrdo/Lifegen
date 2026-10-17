/** Build hierarchy from explicit membership relationships; never infer parent from tier. */
export function splitMemberHierarchy(rawMembers = []) {
 const members=rawMembers.filter(m=>!m.left_at);
 const byMembershipId=new Map(members.filter(m=>m.membership_id!=null).map(m=>[Number(m.membership_id),m]));
 const children=new Map(),roots=[];
 for(const m of members){
  const parentId=m.parent_membership_id==null?null:Number(m.parent_membership_id);
  const parent=parentId==null?null:byMembershipId.get(parentId);
  const valid=m.tier==='new' && parent && parent.tier==='solid' &&
    Number(parent.lifegroup_id??parent.group_id)===Number(m.lifegroup_id??m.group_id) &&
    Number(parent.person_id??parent.id)!==Number(m.person_id??m.id);
  if(valid){
   const key=Number(parent.membership_id);
   if(!children.has(key))children.set(key,[]);
   children.get(key).push(m);
  }else roots.push(m);
 }
 return {roots,children};
}
