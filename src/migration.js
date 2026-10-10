import { withState, stateId, logAction, databaseBackup, transaction } from './db.js';
import { domain, today, isValidDate, isSunday, fullNameSafe, httpError, migrateNetworkText, migrateGenders } from './domain.js';
import { hashToken } from './auth.js';
const ENTITIES=['people','services','networks','lifegroups','memberships','records','audit'];
const bool=v=>v===true||v===1||v==='true'||v==='1';
const clean=v=>v==null||v===''?null:String(v).trim();
function date(v,label,optional=false) {if(!v&&optional)return null;const s=String(v||'').slice(0,10);if(!isValidDate(s))throw httpError(400,`Invalid ${label}: ${String(v).slice(0,80)}`);return s;}
const norm=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const safeLegacy=v=>Array.isArray(v)?v.map(safeLegacy):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!/(token|password|csrf|secret|authorization|idempotency)/i.test(k)).map(([k,x])=>[k,safeLegacy(x)])):v;
function validateInput(input) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw httpError(400,'Upload a JSON backup or a bundled Supabase export.');
 const kind=Array.isArray(input.people)?(input.source==='neon'?'neon':'tracker'):Array.isArray(input.vip_registrations)?'supabase':null;
 if(!kind)throw httpError(400,'Unrecognized export. A tracker backup must contain people, services and records arrays.');
 if(kind!=='supabase')for(const name of ['people','services','records'])if(!Array.isArray(input[name]))throw httpError(400,`Missing ${name} array.`);
 for(const t of [...ENTITIES,'vip_registrations','vip_checkins','checkins','community_posts','prayer_reactions','audit_log','import_mappings'])if(input[t]!==undefined&&!Array.isArray(input[t]))throw httpError(400,`${t} must be an array.`);
 for(const t of [...ENTITIES,'vip_registrations','vip_checkins','checkins','community_posts','prayer_reactions','audit_log','import_mappings'])if(Array.isArray(input[t])) {
  const ids=new Set();for(const r of input[t]){if(!r||typeof r!=='object')throw httpError(400,`Invalid ${t} row.`);if(r.id!=null){const id=String(r.id);if(ids.has(id))throw httpError(400,`Duplicate ${t} ID ${id}.`);ids.add(id);}}
 }
 return kind;
}
export async function importData(input,{sourceKey,actor=null,dryRun=true}={}) {
 const kind=validateInput(input);sourceKey=sourceKey||`${kind}-original`;
 if(!/^[a-zA-Z0-9._:-]{1,100}$/.test(sourceKey))throw httpError(400,'Source key must contain only letters, numbers, dots, dashes, colons or underscores.');
 const source=structuredClone(input);
 if(kind==='tracker') {
  source.networks=source.networks||[];source.lifegroups=source.lifegroups||[];source.memberships=source.memberships||[];
  source.seq={...(source.seq||{})};for(const t of ENTITIES)source.seq[t]=Math.max(0,...(source[t]||[]).map(r=>Number(r.id)||0));
  migrateNetworkText(source);migrateGenders(source);
 }
 const summary={source:kind,source_key:sourceKey,dry_run:dryRun,inserted:{},skipped:{},linked_existing_people:0,warnings:[]};
 return withState(async({data,client})=>{
  const sameDatabase=kind==='neon'&&Boolean(source.database_instance)&&source.database_instance===data.settings.__database_instance;
  const existing=(await client.query('SELECT entity,source_id,destination_id FROM import_mappings WHERE source_key=$1',[sourceKey])).rows;
  const mapping=new Map(existing.map(r=>[`${r.entity}:${r.source_id}`,r.destination_id]));
  const key=(t,id)=>`${t}:${String(id)}`;
  const mark=async(t,id,destination)=>{mapping.set(key(t,id),destination);await client.query('INSERT INTO import_mappings(source_key,entity,source_id,destination_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[sourceKey,t,String(id),destination]);};
  if(sameDatabase){for(const t of [...ENTITIES,'vip_registrations','vip_checkins','community_posts','audit_log']){const ids=new Set((await client.query(`SELECT id FROM "${t}"`)).rows.map(r=>String(r.id)));for(const r of source[t]||[])if(ids.has(String(r.id)))await mark(t,r.id,r.id);}}
  const mapped=(t,id,label,optional=false)=>{if(id==null&&optional)return null;const v=mapping.get(key(t,id));if(!v)throw httpError(400,`Missing reference: ${label} refers to ${t} ID ${id}. Nothing was imported.`);return v;};
  const skip=(t)=>summary.skipped[t]=(summary.skipped[t]||0)+1;
  const add=(t)=>summary.inserted[t]=(summary.inserted[t]||0)+1;
  if(kind!=='supabase') {
   for(const t of ENTITIES)for(const r of source[t]||[]) {
    if(r.id==null)throw httpError(400,`${t} row is missing its ID.`);
    if(mapping.has(key(t,r.id))){skip(t);continue;}
    let n={...r,id:stateId(data,t)};
    for(const b of ['is_active','is_demo'])if(b in n)n[b]=bool(n[b])?1:0;
    if(t==='people') {
     if(!clean(n.first_name))throw httpError(400,`Person ${r.id} has no first name.`);
     n.last_name=String(n.last_name||'');n.date_registered=date(n.date_registered,'registration date');n.birthdate=date(n.birthdate,'birthday',true);n.date_first_attended=date(n.date_first_attended,'first attendance date',true);n.privacy_consent_at=date(n.privacy_consent_at,'consent date',true);
     if(n.age!=null&&(!Number.isInteger(Number(n.age))||Number(n.age)<1||Number(n.age)>120))throw httpError(400,`Person ${r.id} has an invalid age.`);
     n.age=n.age==null?null:Number(n.age);n.registration_source=n.registration_source||'import';
     if(!['first_timer','new_believer','regular','member','leader','volunteer','inactive'].includes(n.status))throw httpError(400,`Person ${r.id} has an invalid status.`);
     const original=n.person_code;n.person_code=original||`LG-${n.date_registered.slice(0,4)}-${String(n.id).padStart(4,'0')}`;
     if(data.people.some(p=>p.person_code===n.person_code)){n.legacy_person_code=original;let codeNumber=n.id;do{n.person_code=`LG-${n.date_registered.slice(0,4)}-${String(codeNumber++).padStart(4,'0')}`;}while(data.people.some(p=>p.person_code===n.person_code));summary.warnings.push(`Person code ${original} was already used; the original is retained in legacy_person_code.`);}
     if(n.photo&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(n.photo))throw httpError(400,`Person ${r.id} has an unsupported photo. Use a JPEG/PNG/WebP data image.`);
     if(!n.privacy_consent_at)summary.warnings.push(`Imported person ${r.id} has no recorded consent date. Confirm their privacy notice/consent with staff.`);
    }
    if(t==='services'){n.service_date=date(n.service_date,'Sunday service date');if(!isSunday(n.service_date))throw httpError(400,`Service ${r.id} is not a Sunday.`);const same=data.services.find(s=>s.service_date===n.service_date);if(same){await mark(t,r.id,same.id);skip(t);continue;}}
    if(t==='networks'){n.leader_person_id=mapped('people',r.leader_person_id,'Network leader',true);n.parent_network_id=null;n._legacy_parent=r.parent_network_id;}
    if(t==='lifegroups'){n.leader_person_id=mapped('people',r.leader_person_id,'Lifegroup leader',true);n.network_id=mapped('networks',r.network_id,'Lifegroup network',true);}
    if(t==='memberships'){n.person_id=mapped('people',r.person_id,'Membership person');n.lifegroup_id=mapped('lifegroups',r.lifegroup_id,'Membership group');n.joined_at=date(r.joined_at,'membership joined date');n.left_at=date(r.left_at,'membership left date',true);if(!n.left_at&&data.memberships.some(m=>m.person_id===n.person_id&&!m.left_at))throw httpError(400,'The backup assigns a person to two active Lifegroups. Resolve this before importing.');}
    if(t==='records'){n.person_id=mapped('people',r.person_id,'Attendance person');n.service_id=mapped('services',r.service_id,'Attendance service');n.recorded_by=null;n.recorded_by_name=r.recorded_by_name||'Imported staff';n.legacy_recorded_by=r.recorded_by;n.source='import';if(n.status==='absent')n.classification=null;else if(!n.classification)n.classification='returning';const same=data.records.find(v=>v.person_id===n.person_id&&v.service_id===n.service_id);if(same){await mark(t,r.id,same.id);skip(t);continue;}}
    if(t==='audit'){n.user_id=null;n.user_name=r.user_name||'Imported staff';n.person_id=r.person_id==null?null:(mapping.get(key('people',r.person_id))||null);n.service_id=r.service_id==null?null:(mapping.get(key('services',r.service_id))||null);}
    data[t].push(n);await mark(t,r.id,n.id);add(t);
   }
   for(const n of data.networks)if('_legacy_parent' in n){n.parent_network_id=mapped('networks',n._legacy_parent,'Parent network',true);delete n._legacy_parent;}
   // Validate active imported memberships against the original church's group rule.
   for(const m of data.memberships.filter(m=>!m.left_at)){const p=data.people.find(p=>p.id===m.person_id),g=data.lifegroups.find(g=>g.id===m.lifegroup_id);if(g?.gender&&p?.sex&&((g.gender==='boys')!==(p.sex==='male')))throw httpError(400,'An imported active membership conflicts with the group’s boys/girls rule. Resolve it before importing.');}
  }
  const tokenToId=new Map();
  for(const r of source.vip_registrations||[]) {
   const sourceId=r.id??(r.vip_token?'token-'+hashToken(r.vip_token):null);if(sourceId==null)throw httpError(400,'VIP export is missing a registration ID/token.');
   if(mapping.has(key('vip_registrations',sourceId))){tokenToId.set(String(r.vip_token||r.id),mapping.get(key('vip_registrations',sourceId)));skip('vip_registrations');continue;}
   const name=String(r.full_name||'').trim();if(!name)throw httpError(400,'VIP export contains a missing name.');
   let personId;
   if(kind==='neon')personId=mapped('people',r.person_id,'VIP person');
   else {
    const phone=digits(r.contact),candidates=phone?data.people.filter(p=>digits(p.contact_number)===phone&&norm(fullNameSafe(p))===norm(name)):[];if(candidates.length>1)throw httpError(400,`VIP ${sourceId} matches multiple tracker profiles. Review the copied exports before importing; no records were changed.`);const candidate=candidates[0];
    if(candidate){personId=candidate.id;summary.linked_existing_people++;for(const [field,value] of Object.entries({age:r.age?Number(r.age):null,school:clean(r.school),inviter:clean(r.inviter)})){if((candidate[field]==null||candidate[field]==='')&&value!=null){candidate[field]=value;summary.filled_person_fields=summary.filled_person_fields||{};summary.filled_person_fields[field]=(summary.filled_person_fields[field]||0)+1;}}}
    else {const parts=name.split(/\s+/);const p=await domain.createPerson({first_name:parts.shift(),last_name:parts.join(' '),full_name:name,age:r.age?Number(r.age):null,school:clean(r.school),inviter:clean(r.inviter),contact_number:digits(r.contact).length>=7?clean(r.contact):null,date_registered:String(r.created_at||today()).slice(0,10),status:'first_timer',registration_source:'vip',privacy_consent:false});personId=p.id;if(clean(r.contact)&&digits(r.contact).length<7){data.people.find(row=>row.id===p.id).contact_number=clean(r.contact);summary.warnings.push(`VIP ${sourceId} has an unvalidated legacy contact. It was retained; confirm it with the person.`);}add('people');if(!phone)summary.warnings.push(`VIP ${sourceId} had no contact number; no name-only automatic merge was performed.`);}
   }
   const id=stateId(data,'vip_registrations'),legacyHash=r.vip_token?hashToken(r.vip_token):r.legacy_token_hash||null;
   await client.query('INSERT INTO vip_registrations(id,person_id,full_name,age,school,inviter,contact,review_status,legacy_token_hash,recovery_hash,idempotency_key,created_at,extras) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now()),$13::jsonb)',[id,personId,name,r.age?Number(r.age):null,clean(r.school),clean(r.inviter),clean(r.contact),r.review_status==='reviewed'?'reviewed':'new',legacyHash,r.recovery_hash||null,kind==='neon'?r.idempotency_key||null:null,r.created_at||null,JSON.stringify({legacy_record:safeLegacy(r)})]);
   await mark('vip_registrations',sourceId,id);tokenToId.set(String(r.vip_token||r.id),id);add('vip_registrations');
  }
  for(const r of [...(source.checkins||[]),...(source.vip_checkins||[])]) {
   const sourceId=r.id??`checkin-${hashToken(r.vip_token||'')}:${r.date_key}`;if(mapping.has(key('vip_checkins',sourceId))){skip('vip_checkins');continue;}
   const registrationId=kind==='neon'?mapped('vip_registrations',r.registration_id,'Check-in registration'):tokenToId.get(String(r.vip_token));
   if(!registrationId)throw httpError(400,'A check-in refers to a VIP registration that is not in this export.');
   const day=date(r.date_key,'VIP check-in date');if(!isSunday(day))throw httpError(400,'A VIP check-in export contains a non-Sunday date.');
   if(!['pending','valid','invalid'].includes(r.status))throw httpError(400,'Invalid exported check-in status.');
   const old=(await client.query('SELECT id FROM vip_checkins WHERE registration_id=$1 AND date_key=$2',[registrationId,day])).rows[0];
   if(old){await mark('vip_checkins',sourceId,old.id);skip('vip_checkins');continue;}
   const id=stateId(data,'vip_checkins');await client.query('INSERT INTO vip_checkins(id,registration_id,date_key,status,created_at,validated_at,extras) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,now()),$6,$7::jsonb)',[id,registrationId,day,r.status,r.created_at||null,r.validated_at||null,JSON.stringify({legacy_record:safeLegacy(r)})]);
   if(r.status==='valid') {
    const personId=(await client.query('SELECT person_id FROM vip_registrations WHERE id=$1',[registrationId])).rows[0].person_id;
    let s=data.services.find(s=>s.service_date===day);if(!s){s=await domain.openService(day);add('services');}
    if(!data.records.some(v=>v.person_id===personId&&v.service_id===s.id&&v.status==='present')){await domain.mark(s.id,personId,'present');data.records.find(v=>v.person_id===personId&&v.service_id===s.id).source='import';add('records');}
   }
   await mark('vip_checkins',sourceId,id);add('vip_checkins');
  }
  for(const r of source.community_posts||[]) {
   if(r.id==null)throw httpError(400,'Prayer export is missing an ID.');if(mapping.has(key('community_posts',r.id))){skip('community_posts');continue;}
   const id=stateId(data,'community_posts'),content=String(r.content||'').trim(),anon=bool(r.is_anonymous??r.isAnonymous);
   if(!content||content.length>1000||!['prayer','testimony','praise'].includes(r.type))throw httpError(400,'The prayer export contains an unsupported post. Nothing was imported.');
   await client.query('INSERT INTO community_posts(id,type,author,content,is_anonymous,is_hidden,created_at,extras) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,now()),$8::jsonb)',[id,r.type,anon?null:clean(r.author),content,anon,bool(r.is_hidden),r.created_at||null,JSON.stringify({legacy_record:safeLegacy(r)})]);await mark('community_posts',r.id,id);add('community_posts');
  }
  for(const r of source.prayer_reactions||[]) {
   if(!/^[a-f0-9]{64}$/.test(String(r.visitor_hash||'')))throw httpError(400,'Invalid exported prayer reaction.');
   const postId=mapped('community_posts',r.post_id,'Prayer reaction post');const result=await client.query('INSERT INTO prayer_reactions(post_id,visitor_hash,created_at) VALUES($1,$2,COALESCE($3::timestamptz,now())) ON CONFLICT DO NOTHING',[postId,r.visitor_hash,r.created_at||null]);if(result.rowCount)add('prayer_reactions');else skip('prayer_reactions');
  }
  for(const r of source.audit_log||[]) {
   if(r.id==null)throw httpError(400,'Imported audit log is missing an ID.');if(mapping.has(key('audit_log',r.id))){skip('audit_log');continue;}
   const entityId=mapping.get(key(r.entity,r.entity_id))||r.entity_id;
   const row=(await client.query('INSERT INTO audit_log(actor_name,entity,entity_id,action,details,created_at) VALUES($1,$2,$3,$4,$5::jsonb,COALESCE($6::timestamptz,now())) RETURNING id',[r.actor_name||'Imported staff',r.entity,entityId==null?null:String(entityId),r.action,JSON.stringify({...safeLegacy(r.details||{}),imported_actor_id:r.actor_id||null}),r.created_at||null])).rows[0];await mark('audit_log',r.id,row.id);add('audit_log');
  }
  for(const r of source.import_mappings||[]) {
   const destination=mapping.get(key(r.entity,r.destination_id));if(!destination){summary.warnings.push(`Legacy import mapping for ${r.entity} ${r.source_id} could not be retained.`);continue;}
   await client.query('INSERT INTO import_mappings(source_key,entity,source_id,destination_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[r.source_key,r.entity,String(r.source_id),destination]);
  }
  const settings=Array.isArray(source.settings)?Object.fromEntries(source.settings.map(r=>[r.key,r.value])):source.settings||{};
  for(const [k,v0] of Object.entries(settings)) {if(k.startsWith('__'))continue;let v=v0;if(typeof v==='string'&&/^"|^\{|^\[/.test(v)){try{v=JSON.parse(v);}catch{}}
   const existingValue=data.settings[k];if(existingValue==null||existingValue===''||['Lifegiver Church of Faith','Lifegen / 3rd Service','No prize set yet'].includes(existingValue))data.settings[k]=v;
   else if(JSON.stringify(existingValue)!==JSON.stringify(v))summary.warnings.push(`Setting ${k} already has a newer value; it was not overwritten.`);
  }
  for(const p of source.monthly_prizes||[])await client.query('INSERT INTO monthly_prizes(month,description) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.month,p.description]);
  await logAction(client,actor,'migration',sourceKey,dryRun?'dry_run':'import',summary);
  if(!dryRun)await client.query('INSERT INTO migration_runs(source_key,actor_id,summary) VALUES($1,$2,$3::jsonb)',[sourceKey,actor?.id||null,JSON.stringify(summary)]);
  summary.warnings=summary.warnings.slice(0,100);return summary;
 },{actor,write:true,dryRun});
}
export const exportBackup=()=>transaction(client=>databaseBackup(client),{write:false});
