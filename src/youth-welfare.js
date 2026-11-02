import { logAction, transaction, withState } from './db.js';
import { domain, httpError } from './domain.js';
import { YOUTH_EDUCATION_STATUSES, YOUTH_GRADE_YEAR_LEVELS, YOUTH_SCHOOL_STOP_PERIODS, YOUTH_SCHOOL_STOP_REASONS, YOUTH_CONTINUATION_CHOICES, YOUTH_LCSOL_STATUSES, normalizeYouthWelfareAnswers, YOUTH_WELFARE_CONSENT_VERSION } from './youth-welfare-form.js';

export const YOUTH_WELFARE_CATEGORIES = Object.freeze([
  { id: 'student', label: 'Student' },
  { id: 'working_student', label: 'Working student' },
  { id: 'young_professional', label: 'Young professional' },
  { id: 'working_employed', label: 'Working / employed' },
  { id: 'not_studying', label: 'Not currently studying' },
  { id: 'unable_to_continue', label: 'Unable to continue / attend school' },
  { id: 'unclassified', label: 'Unclassified' },
]);

export const YOUTH_REPORT_TEMPLATES = Object.freeze([
  { id: 'monthly-registration', name: 'Monthly registrations', type: 'registration_summary', period: 'month' },
  { id: 'quarterly-registration', name: 'Quarterly registrations', type: 'registration_summary', period: 'quarter' },
  { id: 'current-directory', name: 'People directory', type: 'current_directory', period: 'all' },
  { id: 'data-quality', name: 'Data quality', type: 'data_quality', period: 'all' },
  { id: 'follow-up-tasks', name: 'Follow-ups', type: 'tasks', period: 'all' },
]);

const CATEGORY_IDS = new Set(YOUTH_WELFARE_CATEGORIES.map(({ id }) => id));
const CATEGORY_LABELS = new Map(YOUTH_WELFARE_CATEGORIES.map(({ id, label }) => [id, label]));
const MISSING_FILTERS = new Set(['all', 'review', 'incomplete', 'duplicates', 'email', 'birthday', 'gender', 'school', 'ministry', 'consent']);
const EDUCATION_FILTERS = new Set(['all',...Object.keys(YOUTH_EDUCATION_STATUSES)]);
const LCSOL_FILTERS = new Set(['all','yes','no','unknown']);
const LCSOL_STATUS_FILTERS = new Set(['all','unknown',...Object.keys(YOUTH_LCSOL_STATUSES)]);
const VERIFICATION_FILTERS = new Set(['all','verified','pending','not_recorded']);
export const YOUTH_WELFARE_PEOPLE_TABS = Object.freeze([
  {id:'all',label:'All People'},
  {id:'students',label:'Students',education_status:'currently_studying'},
  {id:'out_of_school',label:'Out-of-School',education_status:'out_of_school'},
  {id:'als',label:'ALS',education_status:'currently_als'},
  {id:'working_students',label:'Working Students',education_status:'working_student'},
  {id:'graduated',label:'Graduated',education_status:'graduated'},
  {id:'incomplete',label:'Incomplete'},
]);
const PEOPLE_TAB_IDS = new Set(YOUTH_WELFARE_PEOPLE_TABS.map(({id})=>id));
const TASK_TYPES = new Set(['data_verification', 'registration_review', 'admin_follow_up']);
const TASK_STATUSES = new Set(['needs_review', 'in_progress', 'resolved']);
const REPORT_TYPES = new Set(['registration_summary', 'current_directory', 'data_quality', 'tasks']);
const IS_LOCAL_DEMO = () => process.env.LOCAL_DEMO === 'true';

// These People rows are the canonical LIFEGEN source. The public_registration
// audit event also covers a regular registration that reused an existing email.
// Every VIP-linked person is excluded independently of registration_source.
function eligiblePredicate(localDemo = IS_LOCAL_DEMO()) {
  return `p.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id = p.id
    )
    AND (
      p.registration_source IN ('public','youth_welfare')
      OR EXISTS (
        SELECT 1 FROM public.youth_welfare_categories youth_member
        WHERE youth_member.person_id = p.id
      )
      OR EXISTS (
        SELECT 1 FROM public.audit_log registration_event
        WHERE registration_event.entity = 'people'
          AND registration_event.entity_id = p.id::text
          AND registration_event.action = 'public_registration'
      )${localDemo ? "\n      OR p.is_demo = true" : ''}
    )`;
}

const nullText = field => `NULLIF(BTRIM(${field}), '') IS NULL`;
const missingFieldSql = Object.freeze({
  email: nullText('p.email'),
  birthday: 'p.birthdate IS NULL',
  gender: 'p.sex IS NULL',
  school: nullText('p.school'),
  ministry: nullText('p.ministry'),
  consent: 'p.privacy_consent_at IS NULL',
});
const missingExpression = `(${Object.values(missingFieldSql).join(' OR ')})`;
function welfareIncompletePredicate(personAlias='p',welfareAlias='welfare') {
  const personName=`COALESCE(NULLIF(BTRIM(${personAlias}.full_name),''),NULLIF(BTRIM(CONCAT_WS(' ',${personAlias}.first_name,${personAlias}.last_name)),''))`;
  return `(${welfareAlias}.person_id IS NULL
    OR ${personName} IS NULL
    OR NULLIF(BTRIM(${personAlias}.email),'') IS NULL
    OR ${personAlias}.birthdate IS NULL OR ${personAlias}.sex IS NULL
    OR NULLIF(BTRIM(${personAlias}.school),'') IS NULL
    OR NULLIF(BTRIM(${personAlias}.ministry),'') IS NULL
    OR ${personAlias}.privacy_consent_at IS NULL
    OR NULLIF(BTRIM(${welfareAlias}.complete_address),'') IS NULL
    OR NULLIF(BTRIM(${welfareAlias}.contact_number),'') IS NULL
    OR NULLIF(BTRIM(${welfareAlias}.parent_guardian_name),'') IS NULL
    OR NULLIF(BTRIM(${welfareAlias}.parent_guardian_contact),'') IS NULL
    OR (${welfareAlias}.cell_leader_person_id IS NULL AND NULLIF(BTRIM(${welfareAlias}.cell_leader_manual_name),'') IS NULL)
    OR ${welfareAlias}.education_status IS NULL
    OR (${welfareAlias}.education_status IN ('currently_studying','currently_als','working_student') AND ${welfareAlias}.grade_year_level IS NULL)
    OR ${welfareAlias}.lcsol_enrolled IS NULL OR ${welfareAlias}.lcsol_status IS NULL
    OR ${welfareAlias}.welfare_consent_at IS NULL)`;
}
function duplicateEmailPredicate() {
  const peerEligibility = eligiblePredicate().replace(/(^|[^a-zA-Z0-9_])p\./g, '$1peer.');
  return `(NULLIF(BTRIM(p.email),'') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.people peer
    WHERE peer.id<>p.id AND lower(btrim(peer.email))=lower(btrim(p.email))
      AND ${peerEligibility}
  ))`;
}

function personSelect() {
  return `
    SELECT
      p.id,
      p.person_code,
      p.first_name,
      p.last_name,
      COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')) AS full_name,
      p.email,
      p.birthdate::text AS birthdate,
      p.age,
      p.sex AS gender,
      p.school,
      p.course_year,
      p.occupation,
      p.ministry,
      p.inviter,
      p.status,
      p.date_registered::text AS date_registered,
      p.privacy_consent_at::text AS consent_recorded_at,
      COALESCE(category.category, 'unclassified') AS youth_category,
      welfare.person_id AS youth_welfare_record_id,
      welfare.messenger_facebook_name,
      welfare.complete_address,
      welfare.contact_number AS youth_contact_number,
      welfare.parent_guardian_name,
      welfare.parent_guardian_contact,
      welfare.cell_leader_person_id,
      welfare.cell_leader_manual_name,
      welfare.education_status,
      welfare.grade_year_level,
      welfare.school_stop_period,
      welfare.school_stop_reasons,
      welfare.continue_studies,
      welfare.church_invited_at::text AS church_invited_at,
      welfare.lcsol_enrolled,
      welfare.lcsol_status,
      welfare.welfare_consent_at::text AS welfare_consent_at,
      welfare.verification_status,
      ${welfareIncompletePredicate()} AS is_incomplete
    FROM public.people p
    LEFT JOIN public.youth_welfare_categories category ON category.person_id = p.id
    LEFT JOIN public.youth_welfare_records welfare ON welfare.person_id = p.id
  `;
}

export function validateYouthCategory(category) {
  const value = String(category ?? '').trim();
  if (!CATEGORY_IDS.has(value)) throw httpError(400, 'Choose a valid Youth Welfare category.');
  return value;
}

export function youthCategoryLabel(category) {
  return CATEGORY_LABELS.get(category) || CATEGORY_LABELS.get('unclassified');
}

export function youthWelfareEligibilitySql({ localDemo = IS_LOCAL_DEMO() } = {}) {
  return eligiblePredicate(localDemo);
}

function integerInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function validDate(value, label = 'date', { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, `Enter a valid ${label}.`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text) throw httpError(400, `Enter a valid ${label}.`);
  return text;
}

function validId(value, label = 'record') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, `Invalid ${label} ID.`);
  return id;
}

function cleanString(value, max, label, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw httpError(400, `Enter ${label}.`);
  if (text.length > max) throw httpError(400, `${label} must be ${max} characters or fewer.`);
  return text || null;
}

export function normalizeYouthFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Invalid saved filters.');
  const q=String(input.q??'').trim().slice(0,100);
  const category=String(input.category??'all');
  if(category!=='all'&&!CATEGORY_IDS.has(category))throw httpError(400,'Choose a valid category filter.');
  const missing=String(input.missing??'all');
  if(!MISSING_FILTERS.has(missing))throw httpError(400,'Choose a valid data-quality filter.');
  const education_status=String(input.education_status??'all');
  if(!EDUCATION_FILTERS.has(education_status))throw httpError(400,'Choose a valid education-status filter.');
  const lcsol_enrolled=String(input.lcsol_enrolled??'all');
  if(!LCSOL_FILTERS.has(lcsol_enrolled))throw httpError(400,'Choose a valid LCSOL enrollment filter.');
  const tab=String(input.tab??'all');
  if(!PEOPLE_TAB_IDS.has(tab))throw httpError(400,'Choose a valid People tab.');
  const normalizeAge=(raw,label)=>{
    if(raw===undefined||raw===null||raw==='')return null;
    const value=Number(raw);
    if(!Number.isSafeInteger(value)||value<1||value>120)throw httpError(400,`Enter a valid ${label} from 1 to 120.`);
    return value;
  };
  const age_min=normalizeAge(input.age_min,'minimum age');
  const age_max=normalizeAge(input.age_max,'maximum age');
  if(age_min!==null&&age_max!==null&&age_min>age_max)throw httpError(400,'Minimum age cannot be greater than maximum age.');
  let cell_leader=String(input.cell_leader??'all').trim();
  if(cell_leader!=='all'){
    if(cell_leader.startsWith('person:')&&/^[1-9][0-9]{0,15}$/.test(cell_leader.slice(7))){}
    else if(cell_leader.startsWith('manual:')&&cell_leader.slice(7).trim().length>0&&cell_leader.slice(7).trim().length<=200)cell_leader=`manual:${cell_leader.slice(7).trim()}`;
    else throw httpError(400,'Choose a valid Cell Leader filter.');
  }
  const lcsol_status=String(input.lcsol_status??'all');
  if(!LCSOL_STATUS_FILTERS.has(lcsol_status))throw httpError(400,'Choose a valid LCSOL status filter.');
  const verification_status=String(input.verification_status??'all');
  if(!VERIFICATION_FILTERS.has(verification_status))throw httpError(400,'Choose a valid verification-status filter.');
  return {q,category,missing,education_status,lcsol_enrolled,tab,age_min,age_max,cell_leader,lcsol_status,verification_status};
}

const YOUTH_MEMBER_INPUT_FIELDS=new Set(['first_name','last_name','email','contact_number','birthdate','sex','school','course_year','ministry','occupation','existing_person_id','manual_review_confirmed']);
function assertCanAddYouthWelfarePerson(actor){
  const permissions=actor?.permissions||[];
  if(!permissions.includes('youth_welfare:people:add')&&!permissions.includes('people:write'))throw httpError(403,'Your account cannot add or link People records.');
}
function normalizeYouthMemberInput(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw httpError(400,'Enter valid member details.');
  const unknown=Object.keys(raw).filter(key=>!YOUTH_MEMBER_INPUT_FIELDS.has(key));
  if(unknown.length)throw httpError(400,`Unsupported member fields: ${unknown.join(', ')}.`);
  const first_name=cleanString(raw.first_name,120,'a first name',{required:true});
  const last_name=cleanString(raw.last_name,120,'a last name',{required:true});
  const email=cleanString(raw.email,254,'an email address');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw httpError(400,'Enter a valid email address.');
  const contact_number=cleanString(raw.contact_number,80,'a contact number');
  if(contact_number&&contact_number.replace(/\D/g,'').length<7)throw httpError(400,'Contact number looks too short.');
  const birthdate=validDate(raw.birthdate,'birthday',{optional:true});
  const sex=cleanString(raw.sex,40,'sex');
  if(sex&&!['male','female','other','prefer_not_to_say'].includes(sex))throw httpError(400,'Choose a valid sex value.');
  const school=cleanString(raw.school,300,'school');
  const course_year=cleanString(raw.course_year,200,'course or year level');
  const ministry=cleanString(raw.ministry,120,'ministry');
  const occupation=cleanString(raw.occupation,200,'occupation');
  const existing_person_id=raw.existing_person_id==null||raw.existing_person_id===''?null:validId(raw.existing_person_id,'person');
  if(raw.manual_review_confirmed!==undefined&&typeof raw.manual_review_confirmed!=='boolean')throw httpError(400,'Confirm the manual duplicate review using the checkbox.');
  const manual_review_confirmed=raw.manual_review_confirmed===true;
  if(manual_review_confirmed&&!existing_person_id)throw httpError(400,'Manual review confirmation applies only when linking a selected existing Person ID.');
  return {first_name,last_name,email,contact_number,birthdate,sex,school,course_year,ministry,occupation,existing_person_id,manual_review_confirmed};
}
function normalizedPersonName(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function editDistance(left,right){
  if(left===right)return 0;if(Math.abs(left.length-right.length)>2)return 3;
  let previous=Array.from({length:right.length+1},(_,index)=>index);
  for(let i=1;i<=left.length;i++){
    const current=[i];let rowMinimum=i;
    for(let j=1;j<=right.length;j++){const cost=left[i-1]===right[j-1]?0:1;current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+cost);rowMinimum=Math.min(rowMinimum,current[j]);}
    if(rowMinimum>2)return 3;previous=current;
  }
  return previous[right.length];
}
export function isPossibleSimilarYouthName(member,candidate){
  const first=normalizedPersonName(member?.first_name),last=normalizedPersonName(member?.last_name),candidateFirst=normalizedPersonName(candidate?.first_name),candidateLast=normalizedPersonName(candidate?.last_name);
  if(!first||!last||!candidateFirst||!candidateLast)return false;
  const rawName=value=>String(value??'').normalize('NFC').trim().toLowerCase();
  const memberParts=[first,last],candidateParts=[candidateFirst,candidateLast];
  for(let index=0;index<memberParts.length;index++){
    const memberSuffix=memberParts[index].match(/[0-9]+$/)?.[0]||null,candidateSuffix=candidateParts[index].match(/[0-9]+$/)?.[0]||null;
    if(memberSuffix!==candidateSuffix)return false;
  }
  if(first===candidateFirst&&last===candidateLast)return rawName(member.first_name)!==rawName(candidate.first_name)||rawName(member.last_name)!==rawName(candidate.last_name);
  const firstDistance=editDistance(first,candidateFirst),lastDistance=editDistance(last,candidateLast);
  return (firstDistance<=1&&lastDistance<=1)||(firstDistance===0&&lastDistance<=2)||(lastDistance===0&&firstDistance<=2);
}
const youthDuplicateMatchSql=`(
  ($5::text<>'' AND lower(btrim(COALESCE(p.email,'')))=$5::text)
  OR ($4::text<>'' AND regexp_replace(COALESCE(p.contact_number,''),'[^0-9]','','g')=$4::text)
  OR (lower(btrim(p.first_name))=$1::text AND lower(btrim(p.last_name))=$2::text)
  OR ($3::date IS NOT NULL AND FALSE)
)`;
async function youthWelfareDuplicateMatches(client,member){
  const params=[member.first_name.toLowerCase(),member.last_name.toLowerCase(),member.birthdate,member.contact_number?.replace(/\D/g,'')||'',member.email?.toLowerCase()||''];
  const directRows=(await client.query(`
    SELECT p.id,p.person_code,p.first_name,p.last_name,p.status,p.archived_at IS NOT NULL AS is_archived,
      array_remove(ARRAY[
        CASE WHEN $5::text<>'' AND lower(btrim(COALESCE(p.email,'')))=$5::text THEN 'same email'::text END,
        CASE WHEN $4::text<>'' AND regexp_replace(COALESCE(p.contact_number,''),'[^0-9]','','g')=$4::text THEN 'same contact number'::text END,
        CASE WHEN lower(btrim(p.first_name))=$1::text AND lower(btrim(p.last_name))=$2::text
          THEN CASE WHEN $3::date IS NOT NULL AND p.birthdate=$3::date THEN 'same name and birthday'::text ELSE 'same name'::text END END
      ],NULL) AS reasons,
      (${eligiblePredicate()}) AS already_in_youth_welfare
    FROM public.people p
    WHERE ${youthDuplicateMatchSql}
      AND NOT EXISTS(SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id=p.id)
    ORDER BY p.archived_at NULLS FIRST,lower(COALESCE(NULLIF(BTRIM(p.full_name),''),CONCAT_WS(' ',p.first_name,p.last_name))),p.id
    LIMIT 25`,params)).rows;
  const directRestricted=(await client.query(`SELECT p.id FROM public.people p
    WHERE ${youthDuplicateMatchSql} AND EXISTS(SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id=p.id)`,params)).rows;
  const nameParams=[normalizedPersonName(member.first_name),normalizedPersonName(member.last_name)];
  const nameCandidates=(await client.query(`SELECT p.id,p.person_code,p.first_name,p.last_name,p.status,p.archived_at IS NOT NULL AS is_archived,
      EXISTS(SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id=p.id) AS is_restricted,
      (${eligiblePredicate()}) AS already_in_youth_welfare
    FROM public.people p
    WHERE (lower(btrim(p.first_name))=$1 OR lower(btrim(p.last_name))=$2
      OR (left(regexp_replace(lower(btrim(p.first_name)),'[^a-z0-9]','','g'),1)=left($1,1)
        AND left(regexp_replace(lower(btrim(p.last_name)),'[^a-z0-9]','','g'),1)=left($2,1)))
    ORDER BY p.archived_at NULLS FIRST,lower(COALESCE(NULLIF(BTRIM(p.full_name),''),CONCAT_WS(' ',p.first_name,p.last_name))),p.id
    LIMIT 501`,[nameParams[0],nameParams[1]])).rows;
  const candidateSearchLimited=directRows.length===25||nameCandidates.length>500;
  const matchesById=new Map(directRows.map(row=>[Number(row.id),{
    id:Number(row.id),person_code:row.person_code||null,first_name:row.first_name,last_name:row.last_name,status:row.status||null,
    is_archived:Boolean(row.is_archived),reasons:row.reasons||[],already_in_youth_welfare:Boolean(row.already_in_youth_welfare),
  }]));
  const restrictedIds=new Set(directRestricted.map(row=>Number(row.id)));
  let similarNameMatches=0;
  for(const row of nameCandidates){
    if(!isPossibleSimilarYouthName(member,row))continue;
    const id=Number(row.id);
    if(row.is_restricted){restrictedIds.add(id);continue;}
    const found=matchesById.get(id);
    if(found){if(!found.reasons.includes('similar name — manual review'))found.reasons.push('similar name — manual review');continue;}
    similarNameMatches++;
    matchesById.set(id,{id,person_code:row.person_code||null,first_name:row.first_name,last_name:row.last_name,status:row.status||null,
      is_archived:Boolean(row.is_archived),reasons:['similar name — manual review'],already_in_youth_welfare:Boolean(row.already_in_youth_welfare)});
  }
  const orderedMatches=[...matchesById.values()].sort((a,b)=>Number(a.is_archived)-Number(b.is_archived)||a.first_name.localeCompare(b.first_name)||a.last_name.localeCompare(b.last_name)||a.id-b.id);
  const search_limited=candidateSearchLimited||orderedMatches.length>25;
  const matches=orderedMatches.slice(0,25);
  const restricted_matches=restrictedIds.size;
  const sameNameOnly=matches.filter(match=>match.reasons.length>0&&match.reasons.every(reason=>reason==='same name'));
  const ambiguous=similarNameMatches>0||sameNameOnly.length>0||restricted_matches>0||search_limited;
  return {matches,restricted_matches,ambiguous,search_limited,requires_selection:matches.length>0||restricted_matches>0||search_limited};
}
export async function youthWelfareCheckPersonDuplicates(raw,actor){
  assertCanAddYouthWelfarePerson(actor);
  const member=normalizeYouthMemberInput(raw);
  return transaction(client=>youthWelfareDuplicateMatches(client,member),{write:false});
}
export async function youthWelfareAddMember(raw,actor){
  assertCanAddYouthWelfarePerson(actor);
  const member=normalizeYouthMemberInput(raw);
  return withState(async({data,client,context})=>{
    const duplicates=await youthWelfareDuplicateMatches(client,member);
    if(duplicates.search_limited)throw httpError(409,'Too many possible records need review. Ask an authorized LIFEGEN Admin to check the canonical People list; no person was added.',{search_limited:true});
    if(duplicates.restricted_matches>0)throw httpError(409,'A possible match is in a restricted record. Ask an authorized Admin to review it; no person was added.',{restricted_matches:duplicates.restricted_matches});
    if(member.existing_person_id){
      const selected=duplicates.matches.find(match=>match.id===member.existing_person_id);
      if(!selected)throw httpError(400,'Choose an existing Person from the current duplicate-check results.');
      if(selected.is_archived)throw httpError(409,'That People record is archived and cannot be linked. Ask an Admin to review it.');
      if(selected.already_in_youth_welfare)throw httpError(409,'This person is already in Youth Welfare.',{person_id:selected.id});
      if(duplicates.ambiguous&&!member.manual_review_confirmed)throw httpError(409,'This possible match needs an authorized manual review before it can be linked. Verify the canonical Person ID; a similar name alone is not enough.',{matches:duplicates.matches,ambiguous:true,requires_existing_person_id:true,requires_manual_review:true});
      if(duplicates.ambiguous&&!actor?.permissions?.includes('youth_welfare:manage'))throw httpError(403,'Only an authorized Youth Welfare Admin can confirm an ambiguous People match.');
      await client.query(`INSERT INTO public.youth_welfare_categories(person_id,category,updated_by)
        VALUES($1,'unclassified',$2) ON CONFLICT(person_id) DO NOTHING`,[selected.id,actor.id]);
      await logAction(client,actor,'youth_welfare_categories',selected.id,'member_linked',{person_id:selected.id,source:'existing_people_record',manual_review_confirmed:member.manual_review_confirmed});
      return {person_id:selected.id,person_code:selected.person_code,linked_existing:true,already_in_youth_welfare:false};
    }
    if(duplicates.matches.length){
      throw httpError(409,'Possible duplicate People records were found. Select the correct existing Person ID to link, or ask an authorized Admin to review ambiguous matches.',
        {matches:duplicates.matches,ambiguous:duplicates.ambiguous,search_limited:duplicates.search_limited,requires_existing_person_id:true});
    }
    const person=await domain.createPerson({
      first_name:member.first_name,last_name:member.last_name,full_name:`${member.first_name} ${member.last_name}`,
      email:member.email,contact_number:member.contact_number,birthdate:member.birthdate,sex:member.sex,
      school:member.school,course_year:member.course_year,ministry:member.ministry,occupation:member.occupation,
      status:'first_timer',registration_source:'staff',
    });
    await context.flush();
    await client.query(`INSERT INTO public.youth_welfare_categories(person_id,category,updated_by)
      VALUES($1,'unclassified',$2) ON CONFLICT(person_id) DO NOTHING`,[person.id,actor.id]);
    await logAction(client,actor,'youth_welfare_categories',person.id,'member_added',{person_id:person.id,source:'youth_welfare_people_management'});
    const saved=data.people.find(row=>Number(row.id)===Number(person.id));
    return {person_id:Number(person.id),person_code:person.person_code||saved?.person_code||null,linked_existing:false,already_in_youth_welfare:false};
  },{actor,write:true});
}

export async function youthWelfareSummary(actor=null) {
  const eligible = eligiblePredicate();
  const missingForEligible = missingExpression.replaceAll('p.', 'ep.');
  const data = await transaction(async (client) => {
    const schemaCheck=await client.query(`SELECT to_regclass('public.youth_welfare_records') IS NOT NULL AS welfare_records_available`);
    const welfareSchemaAvailable=Boolean(schemaCheck.rows[0]?.welfare_records_available);
    const { rows } = await client.query(`
      WITH eligible_people AS (
        SELECT p.id,p.email,p.birthdate,p.sex,p.school,p.ministry,p.privacy_consent_at,
          COALESCE(category.category,'unclassified') AS category
        FROM public.people p
        LEFT JOIN public.youth_welfare_categories category ON category.person_id=p.id
        WHERE ${eligible}
      ), duplicate_emails AS (
        SELECT lower(btrim(email)) AS email
        FROM eligible_people
        WHERE NULLIF(btrim(email),'') IS NOT NULL
        GROUP BY lower(btrim(email)) HAVING count(*)>1
      ), flagged_people AS (
        SELECT ep.id FROM eligible_people ep
        LEFT JOIN duplicate_emails d ON lower(btrim(ep.email))=d.email
        WHERE ${missingForEligible} OR d.email IS NOT NULL
      )
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE category='student')::int AS student,
        count(*) FILTER (WHERE category='working_student')::int AS working_student,
        count(*) FILTER (WHERE category='young_professional')::int AS young_professional,
        count(*) FILTER (WHERE category='working_employed')::int AS working_employed,
        count(*) FILTER (WHERE category='not_studying')::int AS not_studying,
        count(*) FILTER (WHERE category='unable_to_continue')::int AS unable_to_continue,
        count(*) FILTER (WHERE category='unclassified')::int AS unclassified,
        count(*) FILTER (WHERE NULLIF(btrim(email),'') IS NULL)::int AS missing_email,
        count(*) FILTER (WHERE birthdate IS NULL)::int AS missing_birthday,
        count(*) FILTER (WHERE sex IS NULL)::int AS missing_gender,
        count(*) FILTER (WHERE NULLIF(btrim(school),'') IS NULL)::int AS missing_school,
        count(*) FILTER (WHERE NULLIF(btrim(ministry),'') IS NULL)::int AS missing_ministry,
        count(*) FILTER (WHERE privacy_consent_at IS NULL)::int AS missing_consent,
        (SELECT count(*)::int FROM eligible_people ep JOIN duplicate_emails d ON lower(btrim(ep.email))=d.email) AS duplicate_people,
        (SELECT count(*)::int FROM flagged_people) AS needs_review,
        count(*) FILTER (WHERE ${missingExpression.replaceAll('p.', '')})::int AS incomplete
      FROM eligible_people
    `);
    let welfare=null;
    if(welfareSchemaAvailable)welfare=await client.query(`
      WITH eligible_people AS (
        SELECT p.id,p.first_name,p.last_name,p.full_name,p.birthdate,p.sex,p.email,p.school,p.ministry,p.privacy_consent_at
        FROM public.people p WHERE ${eligible}
      ), data AS (
        SELECT e.*,w.person_id AS welfare_person_id,w.education_status,w.grade_year_level,w.school_stop_period,
          w.school_stop_reasons,w.continue_studies,w.lcsol_enrolled,w.lcsol_status,w.verification_status,
          w.complete_address,w.contact_number,w.parent_guardian_name,w.parent_guardian_contact,
          w.cell_leader_person_id,w.cell_leader_manual_name,w.welfare_consent_at,
          CASE WHEN e.birthdate IS NULL THEN NULL ELSE EXTRACT(YEAR FROM age(current_date,e.birthdate))::int END AS calculated_age,
          NOT ${welfareIncompletePredicate('e','w')} AS is_complete
        FROM eligible_people e LEFT JOIN public.youth_welfare_records w ON w.person_id=e.id
      )
      SELECT count(*)::int AS eligible_profiles,
        count(*) FILTER (WHERE welfare_person_id IS NOT NULL)::int AS response_records,
        count(*) FILTER (WHERE is_complete)::int AS complete_profiles,
        count(*) FILTER (WHERE NOT COALESCE(is_complete,false))::int AS incomplete_profiles,
        count(*) FILTER (WHERE verification_status='verified')::int AS verified_profiles,
        count(*) FILTER (WHERE welfare_person_id IS NULL OR verification_status='pending')::int AS pending_verification,
        count(*) FILTER (WHERE education_status='currently_studying')::int AS education_currently_studying,
        count(*) FILTER (WHERE education_status='out_of_school')::int AS education_out_of_school,
        count(*) FILTER (WHERE education_status='currently_als')::int AS education_currently_als,
        count(*) FILTER (WHERE education_status='working_student')::int AS education_working_student,
        count(*) FILTER (WHERE education_status='graduated')::int AS education_graduated,
        count(*) FILTER (WHERE education_status IS NOT NULL)::int AS education_status_known,
        count(*) FILTER (WHERE education_status='out_of_school' AND continue_studies IS NOT NULL)::int AS continuation_answers,
        count(*) FILTER (WHERE education_status='out_of_school' AND continue_studies IN ('yes_definitely','yes_need_help'))::int AS continuation_interested,
        count(*) FILTER (WHERE lcsol_enrolled IS NOT NULL)::int AS lcsol_answers,
        count(*) FILTER (WHERE lcsol_enrolled IS TRUE)::int AS lcsol_enrolled_yes,
        count(*) FILTER (WHERE lcsol_enrolled IS FALSE)::int AS lcsol_enrolled_no,
        count(*) FILTER (WHERE calculated_age BETWEEN 1 AND 12)::int AS age_under_13,
        count(*) FILTER (WHERE calculated_age BETWEEN 13 AND 15)::int AS age_13_15,
        count(*) FILTER (WHERE calculated_age BETWEEN 16 AND 18)::int AS age_16_18,
        count(*) FILTER (WHERE calculated_age BETWEEN 19 AND 24)::int AS age_19_24,
        count(*) FILTER (WHERE calculated_age>=25)::int AS age_25_plus,
        count(*) FILTER (WHERE calculated_age IS NULL)::int AS age_unknown,
        jsonb_build_object(
          'currently_studying',count(*) FILTER (WHERE education_status='currently_studying'),
          'out_of_school',count(*) FILTER (WHERE education_status='out_of_school'),
          'currently_als',count(*) FILTER (WHERE education_status='currently_als'),
          'working_student',count(*) FILTER (WHERE education_status='working_student'),
          'graduated',count(*) FILTER (WHERE education_status='graduated')
        ) AS education_status_counts,
        COALESCE((SELECT jsonb_object_agg(answer,answer_count) FROM (
          SELECT continue_studies AS answer,count(*)::int AS answer_count FROM data
          WHERE education_status='out_of_school' AND continue_studies IS NOT NULL GROUP BY continue_studies
        ) continuation_counts),'{}'::jsonb) AS continuation_choice_counts,
        COALESCE((SELECT jsonb_object_agg(reason,reason_count) FROM (
          SELECT reason,count(*)::int AS reason_count FROM data d
          CROSS JOIN LATERAL unnest(COALESCE(d.school_stop_reasons,ARRAY[]::text[])) reason
          WHERE d.education_status='out_of_school' GROUP BY reason
        ) reason_counts),'{}'::jsonb) AS school_stop_reason_counts,
        COALESCE((SELECT jsonb_object_agg(level,level_count) FROM (
          SELECT grade_year_level AS level,count(*)::int AS level_count FROM data
          WHERE grade_year_level IS NOT NULL GROUP BY grade_year_level
        ) grade_counts),'{}'::jsonb) AS grade_year_counts,
        COALESCE((SELECT jsonb_object_agg(status,status_count) FROM (
          SELECT lcsol_status AS status,count(*)::int AS status_count FROM data
          WHERE lcsol_status IS NOT NULL GROUP BY lcsol_status
        ) lcsol_counts),'{}'::jsonb) AS lcsol_status_counts,
        COALESCE((SELECT jsonb_object_agg(period,period_count) FROM (
          SELECT school_stop_period AS period,count(*)::int AS period_count FROM data
          WHERE education_status='out_of_school' AND school_stop_period IS NOT NULL GROUP BY school_stop_period
        ) period_counts),'{}'::jsonb) AS school_stop_period_counts,
        (SELECT count(*)::int FROM public.youth_welfare_follow_up_tasks task
          JOIN eligible_people eligible_task_person ON eligible_task_person.id=task.person_id
          WHERE task.status IN ('needs_review','in_progress')) AS open_followups,
        (SELECT count(*)::int FROM public.youth_welfare_follow_up_tasks task
          JOIN eligible_people eligible_task_person ON eligible_task_person.id=task.person_id
          WHERE task.status IN ('needs_review','in_progress') AND task.due_date<current_date) AS overdue_followups
      FROM data
    `);
    return { summary: rows[0], welfare: welfare?.rows[0]||null, welfare_schema_available:welfareSchemaAvailable };
  }, { write: false });
  const result = data.summary;
  const welfare = data.welfare;
  const checkedAt = new Date().toISOString();
  const ratio = (numerator, denominator) => ({ numerator: Number(numerator || 0), denominator: Number(denominator || 0), percent: Number(denominator) ? Math.round(Number(numerator || 0) * 1000 / Number(denominator)) / 10 : null });
  const canViewWelfare=actor?.permissions?.includes('youth_welfare:records:manage')===true||actor?.permissions?.includes('youth_welfare:profile:private')===true;
  const canViewFollowupMetrics=actor?.permissions?.includes('youth_welfare:manage')===true;
  const canViewSchoolStopReasons=actor?.permissions?.includes('youth_welfare:profile:private')===true;
  return {
    total: result.total,
    welfare_schema_available:data.welfare_schema_available,
    categories: Object.fromEntries(YOUTH_WELFARE_CATEGORIES.map(({ id }) => [id, result[id]])),
    insights: {
      assignedStudentCategory: result.student,
      unspecifiedCategory: result.unclassified,
      incompleteRecords: result.incomplete,
      possibleDuplicateRecords: result.duplicate_people,
      needsReview: result.needs_review,
    },
    data_quality: {
      missing_email: result.missing_email,
      missing_birthday: result.missing_birthday,
      missing_gender: result.missing_gender,
      missing_school: result.missing_school,
      missing_ministry: result.missing_ministry,
      missing_consent: result.missing_consent,
      possible_duplicate_people: result.duplicate_people,
    },
    welfare: canViewWelfare ? {
      eligible_profiles: Number(welfare.eligible_profiles || 0),
      response_records: Number(welfare.response_records || 0),
      complete_profiles: Number(welfare.complete_profiles || 0),
      incomplete_profiles: Number(welfare.incomplete_profiles || 0),
      verified_profiles: Number(welfare.verified_profiles || 0),
      pending_verification: Number(welfare.pending_verification || 0),
      completion_ratio: ratio(welfare.complete_profiles,welfare.eligible_profiles),
      education_status_counts: welfare.education_status_counts || {},
      continuation_choice_counts: welfare.continuation_choice_counts || {},
      education_status_known: Number(welfare.education_status_known || 0),
      education_interruption_ratio: ratio(welfare.education_out_of_school,welfare.education_status_known),
      continuation_answers: Number(welfare.continuation_answers || 0),
      continuation_interested: Number(welfare.continuation_interested || 0),
      continuation_interest_ratio: ratio(welfare.continuation_interested,welfare.continuation_answers),
      lcsol_answers: Number(welfare.lcsol_answers || 0),
      lcsol_enrolled_yes: Number(welfare.lcsol_enrolled_yes || 0),
      lcsol_enrolled_no: Number(welfare.lcsol_enrolled_no || 0),
      lcsol_enrollment_ratio: ratio(welfare.lcsol_enrolled_yes,welfare.lcsol_answers),
      age_groups: [
        {id:'under_13',label:'Under 13',count:Number(welfare.age_under_13||0)},
        {id:'13_15',label:'13–15',count:Number(welfare.age_13_15||0)},
        {id:'16_18',label:'16–18',count:Number(welfare.age_16_18||0)},
        {id:'19_24',label:'19–24',count:Number(welfare.age_19_24||0)},
        {id:'25_plus',label:'25+',count:Number(welfare.age_25_plus||0)},
        {id:'unknown',label:'Birthday unavailable',count:Number(welfare.age_unknown||0)},
      ],
      grade_year_counts: welfare.grade_year_counts || {},
      school_stop_period_counts: welfare.school_stop_period_counts || {},
      school_stop_reason_counts: canViewSchoolStopReasons ? (welfare.school_stop_reason_counts || {}) : {},
      lcsol_status_counts: welfare.lcsol_status_counts || {},
      open_followups: canViewFollowupMetrics ? Number(welfare.open_followups || 0) : null,
      overdue_followups: canViewFollowupMetrics ? Number(welfare.overdue_followups || 0) : null,
      source: 'actual_youth_welfare_records',
      ratio_denominators: {
        completion: 'All currently eligible, non-VIP LIFEGEN profiles.',
        education_interruption: 'Eligible profiles with a recorded Youth Welfare education status.',
        continuation_interest: 'Out-of-school profiles that answered the willingness-to-continue question.',
        lcsol_enrollment: 'Profiles with a recorded Yes/No LCSOL enrollment answer.',
      },
    } : null,
    source: 'lifegen_database',
    source_label: 'LIFEGEN PostgreSQL · direct query',
    sync_mode: 'direct_query',
    sync_status: 'connected',
    last_checked_at: checkedAt,
    last_successful_sync: null,
    generated_at: checkedAt,
    note: 'There is no separate asynchronous sync job; this dashboard queries the shared database directly. Category counts are ministry-assigned and are not inferred from registration responses.',
  };
}

export function shapeYouthProfileForViewer(person) {
  const visible=['id','person_code','first_name','last_name','full_name','status','date_registered','youth_category'];
  return Object.fromEntries(visible.filter(key=>Object.hasOwn(person,key)).map(key=>[key,person[key]]));
}

export function shapeYouthProfileForStaff(person) {
  const visible=['id','person_code','first_name','last_name','full_name','status','date_registered','youth_category','school','course_year','is_incomplete',
    'education_status','grade_year_level','school_stop_period','continue_studies','church_invited_at',
    'lcsol_enrolled','lcsol_status','verification_status','cell_leader_person_id','cell_leader_manual_name'];
  return Object.fromEntries(visible.filter(key=>Object.hasOwn(person,key)).map(key=>[key,person[key]]));
}

export async function youthWelfarePeople(input = {},actor=null) {
  const filters=normalizeYouthFilters(input);
  const canViewPrivate=actor?.permissions?.includes('youth_welfare:profile:private')===true;
  const canManageWelfare=canViewPrivate||actor?.permissions?.includes('youth_welfare:records:manage')===true;
  const protectedFilter=filters.tab!=='all'||filters.education_status!=='all'||filters.lcsol_enrolled!=='all'||
    filters.cell_leader!=='all'||filters.lcsol_status!=='all'||filters.verification_status!=='all';
  if(protectedFilter&&!canManageWelfare)throw httpError(403,'Your role cannot filter directory records by Youth Welfare answers.');
  if((filters.age_min!==null||filters.age_max!==null)&&!canViewPrivate)throw httpError(403,'Age filters are available only to Youth Welfare Admins.');
  const pageSize=integerInRange(input.limit,25,1,100);
  const pageOffset=integerInRange(input.offset,0,0,1000000);
  const missingClause=filters.missing==='all'?'':filters.missing==='review'?`AND (${missingExpression} OR ${duplicateEmailPredicate()})`:filters.missing==='incomplete'?`AND ${missingExpression}`:filters.missing==='duplicates'?`AND ${duplicateEmailPredicate()}`:`AND ${missingFieldSql[filters.missing]}`;
  const ageExpression=`COALESCE(CASE WHEN p.birthdate IS NULL THEN NULL ELSE EXTRACT(YEAR FROM age(current_date,p.birthdate))::int END,p.age)`;
  const where=`WHERE ${eligiblePredicate()}
    AND ($1::text='' OR CONCAT_WS(' ',p.first_name,p.last_name,p.full_name,p.person_code,p.id::text) ILIKE '%'||$1||'%')
    AND ($2::text='all' OR COALESCE(category.category,'unclassified')=$2)
    AND ($3::text='all' OR welfare.education_status=$3)
    AND ($4::text='all' OR ($4='yes' AND welfare.lcsol_enrolled IS TRUE) OR ($4='no' AND welfare.lcsol_enrolled IS FALSE) OR ($4='unknown' AND welfare.lcsol_enrolled IS NULL))
    AND ($5::text='all' OR ($5='unknown' AND welfare.lcsol_status IS NULL) OR welfare.lcsol_status=$5)
    AND ($6::text='all' OR ($6='verified' AND welfare.verification_status='verified') OR ($6='pending' AND welfare.person_id IS NOT NULL AND COALESCE(welfare.verification_status,'pending')='pending') OR ($6='not_recorded' AND welfare.person_id IS NULL))
    AND ($7::text='all' OR ($7 LIKE 'person:%' AND welfare.cell_leader_person_id=substring($7 FROM 8)::bigint) OR ($7 LIKE 'manual:%' AND lower(btrim(welfare.cell_leader_manual_name))=lower(btrim(substring($7 FROM 8)))))
    AND ($8::int IS NULL OR ${ageExpression}>=$8::int)
    AND ($9::int IS NULL OR ${ageExpression}<=$9::int)
    ${missingClause}`;
  const params=[filters.q,filters.category,filters.education_status,filters.lcsol_enrolled,filters.lcsol_status,filters.verification_status,filters.cell_leader,filters.age_min,filters.age_max];
  const statusTabs=YOUTH_WELFARE_PEOPLE_TABS.filter(tab=>tab.education_status);
  const countSelect=statusTabs.map(tab=>`count(*) FILTER (WHERE welfare.education_status='${tab.education_status}')::int AS ${tab.id}`).join(',\n        ');
  const tabCountsQuery=`SELECT count(*)::int AS all,
        ${countSelect},
        count(*) FILTER (WHERE ${welfareIncompletePredicate()})::int AS incomplete
      FROM public.people p
      LEFT JOIN public.youth_welfare_categories category ON category.person_id=p.id
      LEFT JOIN public.youth_welfare_records welfare ON welfare.person_id=p.id
      ${where}`;
  const selectedTab=YOUTH_WELFARE_PEOPLE_TABS.find(tab=>tab.id===filters.tab);
  const tabClause=selectedTab.education_status?`AND welfare.education_status='${selectedTab.education_status}'`:filters.tab==='incomplete'?`AND ${welfareIncompletePredicate()}`:'';
  const orderBy=input.sort==='recent'?'p.date_registered DESC,p.id':`LOWER(COALESCE(NULLIF(BTRIM(p.full_name),''),CONCAT_WS(' ',p.first_name,p.last_name))),p.id`;
  return transaction(async(client)=>{
    const counts=(await client.query(tabCountsQuery,params)).rows[0];
    const peopleResult=await client.query(`${personSelect()} ${where} ${tabClause} ORDER BY ${orderBy} LIMIT $10 OFFSET $11`,[...params,pageSize,pageOffset]);
    const includePrivate=canViewPrivate;
    const manageRecords=actor?.permissions?.includes('youth_welfare:records:manage')===true;
    const people=includePrivate?peopleResult.rows:manageRecords?peopleResult.rows.map(shapeYouthProfileForStaff):peopleResult.rows.map(shapeYouthProfileForViewer);
    const tab_counts=canManageWelfare?Object.fromEntries(YOUTH_WELFARE_PEOPLE_TABS.map(({id})=>[id,Number(counts[id]||0)])):{all:Number(counts.all||0),students:null,out_of_school:null,als:null,working_students:null,graduated:null,incomplete:null};
    const total=Number(counts[filters.tab]||0);
    return {people,total,tab_counts,limit:pageSize,offset:pageOffset,sort:input.sort==='recent'?'recent':'name',filters,private_fields_hidden:!includePrivate};
  },{write:false});
}

export async function youthWelfareCellLeaderOptions(){
  const eligible=eligiblePredicate();
  return transaction(async client=>{
    const {rows}=await client.query(`SELECT p.id,p.person_code,
      COALESCE(NULLIF(BTRIM(p.full_name),''),NULLIF(BTRIM(CONCAT_WS(' ',p.first_name,p.last_name)),'')) AS display_name,
      array_agg(DISTINCT g.name ORDER BY g.name) AS lifegroups
      FROM public.lifegroups g JOIN public.people p ON p.id=g.leader_person_id
      WHERE g.is_active AND p.archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM public.networks network WHERE network.leader_person_id=p.id AND network.is_active)
      GROUP BY p.id,p.person_code,p.full_name,p.first_name,p.last_name
      ORDER BY lower(COALESCE(NULLIF(BTRIM(p.full_name),''),NULLIF(BTRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''))),p.id`);
    const manual=(await client.query(`SELECT display_name FROM (
        SELECT DISTINCT BTRIM(welfare.cell_leader_manual_name) AS display_name
        FROM public.youth_welfare_records welfare JOIN public.people p ON p.id=welfare.person_id
        WHERE ${eligible} AND NULLIF(BTRIM(welfare.cell_leader_manual_name),'') IS NOT NULL
      ) manual_leaders ORDER BY lower(display_name),display_name`)).rows;
    return [
      ...rows.map(row=>({id:Number(row.id),filter_value:`person:${Number(row.id)}`,person_code:row.person_code||null,display_name:row.display_name||'Lifegroup leader',lifegroups:row.lifegroups||[]})),
      ...manual.map(row=>({id:null,filter_value:`manual:${row.display_name}`,person_code:null,display_name:row.display_name,manual:true,lifegroups:[]})),
    ];
  },{write:false});
}

export async function youthWelfarePerson(personId,actor=null) {
  const id = validId(personId, 'person');
  const eligible = eligiblePredicate();
  return transaction(async (client) => {
    const { rows } = await client.query(`${personSelect()} WHERE p.id=$1 AND ${eligible} LIMIT 1`,[id]);
    if (!rows[0]) throw httpError(404, 'Youth Welfare profile not found.');
    const registration = await client.query(`
      SELECT
        event.created_at::text AS event_at,
        event.details->>'ministry' AS submitted_ministry,
        NULLIF(event.details->>'person_created','')::boolean AS person_created,
        (NULLIF(event.details->>'leader_person_id','') IS NOT NULL) AS leader_assigned,
        COALESCE(NULLIF(BTRIM(leader.full_name),''),NULLIF(BTRIM(CONCAT_WS(' ',leader.first_name,leader.last_name)),'')) AS leader_name,
        registered_group.name AS lifegroup_name,
        registered_network.name AS network_name,
        CASE WHEN registered_network.leader_person_id IS NULL THEN registered_network.leader_name
          ELSE COALESCE(NULLIF(BTRIM(network_leader.full_name),''),NULLIF(BTRIM(CONCAT_WS(' ',network_leader.first_name,network_leader.last_name)),''))
        END AS network_leader_name,
        event.details->>'review' AS review_reason,
        NULLIF(review.details->>'manual_leader_name','') IS NOT NULL AS manual_leader_entry_present
      FROM (
        SELECT id,created_at,details FROM public.audit_log
        WHERE entity='people' AND entity_id=$1::text AND action='public_registration'
        ORDER BY created_at DESC,id DESC LIMIT 1
      ) event
      LEFT JOIN public.people leader
        ON leader.id::text=event.details->>'leader_person_id'
        AND leader.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id=leader.id)
      LEFT JOIN public.lifegroups registered_group
        ON registered_group.id::text=event.details->>'lifegroup_id'
      LEFT JOIN public.networks registered_network ON registered_network.id=registered_group.network_id
      LEFT JOIN public.people network_leader
        ON network_leader.id=registered_network.leader_person_id
        AND network_leader.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id=network_leader.id)
      LEFT JOIN LATERAL (
        SELECT details FROM public.audit_log review_event
        WHERE review_event.entity='people' AND review_event.entity_id=$1::text
          AND review_event.action='public_registration_review'
          AND review_event.created_at>=event.created_at
        ORDER BY review_event.created_at DESC,review_event.id DESC LIMIT 1
      ) review ON true
    `,[String(id)]);
    const includePrivate=actor?.permissions?.includes('youth_welfare:profile:private');
    const manageRecords=actor?.permissions?.includes('youth_welfare:records:manage');
    const details=registration.rows[0]||null;
    const welfareKeys=['youth_welfare_record_id','messenger_facebook_name','complete_address','youth_contact_number','parent_guardian_name','parent_guardian_contact','cell_leader_person_id','cell_leader_manual_name','education_status','grade_year_level','school_stop_period','school_stop_reasons','continue_studies','church_invited_at','lcsol_enrolled','lcsol_status','welfare_consent_at','verification_status'];
    const welfareRecord=Object.fromEntries(welfareKeys.filter(key=>Object.hasOwn(rows[0],key)).map(key=>[key,rows[0][key]]));
    const welfareRecordExists=Boolean(rows[0].youth_welfare_record_id);
    const person={...rows[0]};for(const key of welfareKeys)delete person[key];
    const canViewFollowup=actor?.permissions?.includes('youth_welfare:manage')===true;
    const followUpHistory=canViewFollowup?(await client.query(`SELECT task.id,task.task_type,task.title,task.notes,task.status,task.due_date::text AS due_date,
        task.created_at::text AS created_at,task.updated_at::text AS updated_at,task.resolved_at::text AS resolved_at,
        assigned.display_name AS assigned_to_name,creator.display_name AS created_by_name
        FROM public.youth_welfare_follow_up_tasks task
        LEFT JOIN public.staff_users assigned ON assigned.id=task.assigned_to
        LEFT JOIN public.staff_users creator ON creator.id=task.created_by
        WHERE task.person_id=$1 ORDER BY task.created_at DESC,task.id DESC LIMIT 50`,[id])).rows:null;
    if(includePrivate){
      const pending=await client.query(`SELECT id,proposed_answers,welfare_consent_at::text AS welfare_consent_at,created_at::text AS submitted_at
        FROM public.youth_welfare_record_updates WHERE person_id=$1 AND status='pending' ORDER BY created_at DESC,id DESC`,[id]);
      return { ...person,welfare_record:welfareRecord,youth_welfare_record_exists:welfareRecordExists,pending_welfare_updates:pending.rows,follow_up_history:followUpHistory,registration_details:details };
    }
    if(manageRecords){
      const staffRecord=Object.fromEntries(['cell_leader_person_id','cell_leader_manual_name','education_status','grade_year_level','school_stop_period','continue_studies','church_invited_at','lcsol_enrolled','lcsol_status','verification_status'].filter(key=>Object.hasOwn(welfareRecord,key)).map(key=>[key,welfareRecord[key]]));
      return { ...shapeYouthProfileForStaff({...person,...staffRecord}),welfare_record:staffRecord,youth_welfare_record_exists:welfareRecordExists,registration_details:details?{event_at:details.event_at,person_created:details.person_created,leader_assigned:details.leader_assigned}:null,private_fields_hidden:true };
    }
    return { ...shapeYouthProfileForViewer(person),registration_details:details?{event_at:details.event_at,person_created:details.person_created,leader_assigned:details.leader_assigned}:null,private_fields_hidden:true };
  }, { write: false });
}

const STAFF_WELFARE_FIELDS=new Set(['cell_leader_person_id','cell_leader_manual_name','education_status','grade_year_level','school_stop_period','continue_studies','church_invited_at','lcsol_enrolled','lcsol_status']);
const ADMIN_WELFARE_FIELDS=new Set([...STAFF_WELFARE_FIELDS,'messenger_facebook_name','complete_address','contact_number','parent_guardian_name','parent_guardian_contact','school_stop_reasons']);
const GRADE_REQUIRED_STATUSES=new Set(['currently_studying','currently_als','working_student']);
const selectWelfareChoice=(value,choices,label)=>{
  if(value===null||value==='')return null;
  const text=String(value??'').trim();
  if(!Object.hasOwn(choices,text))throw httpError(400,`Choose a valid ${label}.`);
  return text;
};
function normalizeWelfarePatch(body,allowed){
  if(!body||typeof body!=='object'||Array.isArray(body))throw httpError(400,'Invalid Youth Welfare record.');
  const unknown=Object.keys(body).filter(key=>!allowed.has(key));
  if(unknown.length)throw httpError(403,`Your role cannot change: ${unknown.join(', ')}.`);
  const patch={};
  for(const [key,value] of Object.entries(body)){
    switch(key){
      case 'messenger_facebook_name': patch[key]=cleanString(value,200,'Messenger/Facebook name');break;
      case 'complete_address': patch[key]=cleanString(value,500,'complete address');break;
      case 'contact_number':
      case 'parent_guardian_contact':{
        const phone=cleanString(value,40,key==='contact_number'?'contact number':'parent/guardian contact number');
        if(phone&&phone.replace(/\D/g,'').length<7)throw httpError(400,`Enter a valid ${key==='contact_number'?'contact number':'parent/guardian contact number'}.`);
        patch[key]=phone;break;
      }
      case 'parent_guardian_name': patch[key]=cleanString(value,200,'parent/guardian name');break;
      case 'cell_leader_manual_name': patch[key]=cleanString(value,200,'Cell Leader name');break;
      case 'cell_leader_person_id': patch[key]=value==null||value===''?null:validId(value,'Cell Leader');break;
      case 'education_status': patch[key]=selectWelfareChoice(value,YOUTH_EDUCATION_STATUSES,'education status');break;
      case 'grade_year_level': patch[key]=selectWelfareChoice(value,YOUTH_GRADE_YEAR_LEVELS,'grade/year level');break;
      case 'school_stop_period': patch[key]=selectWelfareChoice(value,YOUTH_SCHOOL_STOP_PERIODS,'school-stop period');break;
      case 'continue_studies': patch[key]=selectWelfareChoice(value,YOUTH_CONTINUATION_CHOICES,'continuation answer');break;
      case 'church_invited_at': patch[key]=validDate(value,'church invitation date',{optional:true});break;
      case 'lcsol_enrolled':
        if(value!==null&&typeof value!=='boolean')throw httpError(400,'Choose Yes or No for LCSOL enrollment.');
        patch[key]=value;break;
      case 'lcsol_status': patch[key]=selectWelfareChoice(value,YOUTH_LCSOL_STATUSES,'LCSOL status');break;
      case 'school_stop_reasons':{
        if(value==null){patch[key]=[];break;}
        if(!Array.isArray(value))throw httpError(400,'Select one or more school-stop reasons.');
        const reasons=[...new Set(value.map(item=>String(item??'').trim()).filter(Boolean))];
        if(reasons.some(item=>!Object.hasOwn(YOUTH_SCHOOL_STOP_REASONS,item)))throw httpError(400,'Choose valid school-stop reasons.');
        patch[key]=reasons;break;
      }
      default: throw httpError(400,'Unsupported Youth Welfare field.');
    }
  }
  if(patch.cell_leader_person_id&&patch.cell_leader_manual_name)throw httpError(400,'Choose either a linked Cell Leader or a manual Cell Leader name, not both.');
  return patch;
}
function assertLcsolConsistent(enrolled,status){
  if(enrolled===false&&status&&status!=='not_yet_started')throw httpError(400,'LCSOL enrollment is No. Choose Not yet started or correct the enrollment answer.');
  if(enrolled===true&&status==='not_yet_started')throw httpError(400,'LCSOL enrollment is Yes. Choose another status or correct the enrollment answer.');
}
function shapeStaffWelfareRecord(record){
  const keys=['person_id','cell_leader_person_id','cell_leader_manual_name','education_status','grade_year_level','school_stop_period','continue_studies','church_invited_at','lcsol_enrolled','lcsol_status','verification_status','verified_at','created_at','updated_at'];
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]));
}

export async function updateYouthWelfareRecord(personId,raw,actor){
  const id=validId(personId,'person');
  const isAdmin=actor?.permissions?.includes('youth_welfare:profile:private');
  const allowed=isAdmin?ADMIN_WELFARE_FIELDS:STAFF_WELFARE_FIELDS;
  const patch=normalizeWelfarePatch(raw,allowed);
  if(!Object.keys(patch).length)throw httpError(400,'Choose at least one Youth Welfare field to update.');
  const eligible=eligiblePredicate();
  const record=await transaction(async client=>{
    const person=(await client.query(`SELECT p.id FROM public.people p WHERE p.id=$1 AND ${eligible} FOR UPDATE OF p`,[id])).rows[0];
    if(!person)throw httpError(404,'Eligible Youth Welfare profile not found.');
    const current=(await client.query('SELECT * FROM public.youth_welfare_records WHERE person_id=$1 FOR UPDATE',[id])).rows[0]||null;
    const next={...(current||{}),...patch};
    assertLcsolConsistent(next.lcsol_enrolled,next.lcsol_status);
    if(next.cell_leader_person_id&&next.cell_leader_person_id===id)throw httpError(400,'A person cannot be their own Cell Leader.');
    if(patch.cell_leader_person_id){
      const leader=(await client.query(`SELECT p.id FROM public.people p WHERE p.id=$1 AND p.archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id=p.id)
        AND EXISTS(SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active)
        AND NOT EXISTS(SELECT 1 FROM public.networks network WHERE network.leader_person_id=p.id AND network.is_active)`,[patch.cell_leader_person_id])).rows[0];
      if(!leader)throw httpError(400,'Choose an active, non-VIP LIFEGEN person as Cell Leader.');
    }
    const changed=Object.keys(patch).filter(key=>JSON.stringify(current?.[key]??null)!==JSON.stringify(patch[key]??null));
    if(!changed.length)return current;
    if(current){
      await client.query(`INSERT INTO public.youth_welfare_record_history(person_id,actor_id,action,record_snapshot)
        VALUES($1,$2,'record_updated',$3::jsonb)`,[id,actor.id,JSON.stringify(current)]);
      const columns=Object.keys(patch);
      const sets=columns.map((key,index)=>`${key}=$${index+1}`).join(',');
      const values=columns.map(key=>patch[key]);
      values.push(actor.id,id);
      await client.query(`UPDATE public.youth_welfare_records SET ${sets},updated_by=$${values.length-1},updated_at=now() WHERE person_id=$${values.length} `,values);
    }else{
      const columns=Object.keys(patch);
      const values=[id,...columns.map(key=>patch[key]),actor.id];
      const names=['person_id',...columns,'source','created_by','updated_by'];
      const placeholders=['$1',...columns.map((_,index)=>`$${index+2}`),"'staff_entry'",`$${values.length}` ,`$${values.length}`];
      await client.query(`INSERT INTO public.youth_welfare_records(${names.join(',')}) VALUES(${placeholders.join(',')})`,values);
    }
    await logAction(client,actor,'youth_welfare_records',id,'record_updated',{changed_fields:changed});
    return (await client.query('SELECT * FROM public.youth_welfare_records WHERE person_id=$1',[id])).rows[0];
  });
  return {record:isAdmin?record:shapeStaffWelfareRecord(record),private_fields_hidden:!isAdmin};
}

export async function setYouthWelfareVerification(personId,rawStatus,actor){
  const id=validId(personId,'person');
  const status=String(rawStatus??'');
  if(!['pending','verified'].includes(status))throw httpError(400,'Choose Pending verification or Verified.');
  const eligible=eligiblePredicate();
  return transaction(async client=>{
    const row=(await client.query(`SELECT p.email,p.birthdate,p.sex,p.school,p.ministry,w.*
      FROM public.people p JOIN public.youth_welfare_records w ON w.person_id=p.id
      WHERE p.id=$1 AND ${eligible} FOR UPDATE OF w`,[id])).rows[0];
    if(!row)throw httpError(404,'Youth Welfare record not found.');
    if(status==='verified'){
      const missing=[];
      if(!String(row.email||'').trim())missing.push('email');
      if(!row.birthdate)missing.push('birthday');
      if(!row.sex)missing.push('sex');
      if(!String(row.school||'').trim())missing.push('school');
      if(!String(row.ministry||'').trim())missing.push('ministry');
      for(const [field,label] of [['complete_address','complete address'],['contact_number','contact number'],['parent_guardian_name','parent/guardian name'],['parent_guardian_contact','parent/guardian contact number']])if(!String(row[field]||'').trim())missing.push(label);
      if(!row.cell_leader_person_id&&!String(row.cell_leader_manual_name||'').trim())missing.push('Cell Leader name');
      if(!row.education_status)missing.push('educational status');
      if(GRADE_REQUIRED_STATUSES.has(row.education_status)&&!row.grade_year_level)missing.push('grade/year level');
      if(row.lcsol_enrolled===null||row.lcsol_enrolled===undefined||!row.lcsol_status)missing.push('LCSOL answers');
      if(!row.welfare_consent_at)missing.push('Youth Welfare consent');
      if(missing.length)throw httpError(409,`Complete the required fields before verification: ${missing.join(', ')}.`);
      assertLcsolConsistent(row.lcsol_enrolled,row.lcsol_status);
    }
    if(row.verification_status===status)return {person_id:id,verification_status:status,unchanged:true};
    await client.query(`UPDATE public.youth_welfare_records SET verification_status=$1,
      verified_by=CASE WHEN $1='verified' THEN $2 ELSE NULL END,
      verified_at=CASE WHEN $1='verified' THEN now() ELSE NULL END,updated_by=$2,updated_at=now()
      WHERE person_id=$3`,[status,actor.id,id]);
    await logAction(client,actor,'youth_welfare_records',id,status==='verified'?'record_verified':'verification_reset',{from:row.verification_status,to:status});
    return {person_id:id,verification_status:status};
  });
}

export async function youthWelfarePendingUpdates({limit=100}={}){
  const max=integerInRange(limit,100,1,250),eligible=eligiblePredicate();
  return transaction(async client=>{
    const {rows}=await client.query(`SELECT yw_update.id,yw_update.person_id,yw_update.proposed_answers,yw_update.welfare_consent_at::text AS welfare_consent_at,
      yw_update.created_at::text AS submitted_at,p.person_code,
      COALESCE(NULLIF(BTRIM(p.full_name),''),NULLIF(BTRIM(CONCAT_WS(' ',p.first_name,p.last_name)),'')) AS person_name
      FROM public.youth_welfare_record_updates yw_update JOIN public.people p ON p.id=yw_update.person_id
      WHERE yw_update.status='pending' AND ${eligible}
      ORDER BY yw_update.created_at,yw_update.id LIMIT $1`,[max]);
    return {updates:rows};
  },{write:false});
}

export async function reviewYouthWelfareUpdate(updateId,decision,actor){
  const id=validId(updateId,'update');
  const choice=String(decision??'');
  if(!['approve','reject'].includes(choice))throw httpError(400,'Choose Approve or Reject.');
  const eligible=eligiblePredicate();
  return transaction(async client=>{
    const update=(await client.query(`SELECT yw_update.* FROM public.youth_welfare_record_updates yw_update
      JOIN public.people p ON p.id=yw_update.person_id WHERE yw_update.id=$1 AND yw_update.status='pending' AND ${eligible} FOR UPDATE OF yw_update`,[id])).rows[0];
    if(!update)throw httpError(404,'Pending Youth Welfare update not found.');
    if(choice==='approve'){
      const raw=update.proposed_answers||{};
      const normalized=normalizeYouthWelfareAnswers({...raw,parent_guardian_contact_number:raw.parent_guardian_contact,consent:true});
      const leaderId=raw.cell_leader_person_id==null?null:validId(raw.cell_leader_person_id,'Cell Leader');
      const leaderName=cleanString(raw.cell_leader_manual_name,200,'Cell Leader name');
      if(leaderId&&leaderName)throw httpError(409,'The proposed update contains both a linked and manual Cell Leader. Review it before applying.');
      if(leaderId){
        const live=(await client.query(`SELECT p.id FROM public.people p WHERE p.id=$1 AND p.archived_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id=p.id)
          AND EXISTS(SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active)
          AND NOT EXISTS(SELECT 1 FROM public.networks network WHERE network.leader_person_id=p.id AND network.is_active)`,[leaderId])).rows[0];
        if(!live)throw httpError(409,'The proposed Cell Leader is no longer active. Review the profile before approving.');
      }
      assertLcsolConsistent(normalized.lcsol_enrolled,normalized.lcsol_status);
      const previous=(await client.query('SELECT * FROM public.youth_welfare_records WHERE person_id=$1 FOR UPDATE',[update.person_id])).rows[0];
      if(!previous)throw httpError(409,'The current Youth Welfare record no longer exists.');
      await client.query(`INSERT INTO public.youth_welfare_record_history(person_id,actor_id,action,record_snapshot)
        VALUES($1,$2,'public_update_approved',$3::jsonb)`,[update.person_id,actor.id,JSON.stringify(previous)]);
      await client.query(`UPDATE public.youth_welfare_records SET
        messenger_facebook_name=$1,complete_address=$2,contact_number=$3,parent_guardian_name=$4,parent_guardian_contact=$5,
        cell_leader_person_id=$6,cell_leader_manual_name=$7,education_status=$8,grade_year_level=$9,
        school_stop_period=$10,school_stop_reasons=$11::text[],continue_studies=$12,church_invited_at=$13,
        lcsol_enrolled=$14,lcsol_status=$15,welfare_consent_at=$16,welfare_consent_version=$17,
        verification_status='pending',verified_by=NULL,verified_at=NULL,source='approved_update',updated_by=$18,updated_at=now()
        WHERE person_id=$19`,[normalized.messenger_facebook_name,normalized.complete_address,normalized.contact_number,
        normalized.parent_guardian_name,normalized.parent_guardian_contact,leaderId,leaderName,normalized.education_status,
        normalized.grade_year_level,normalized.school_stop_period,normalized.school_stop_reasons,normalized.continue_studies,
        normalized.church_invited_at,normalized.lcsol_enrolled,normalized.lcsol_status,update.welfare_consent_at,
        raw.welfare_consent_version||YOUTH_WELFARE_CONSENT_VERSION,actor.id,update.person_id]);
    }
    await client.query(`UPDATE public.youth_welfare_record_updates SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3`,[choice==='approve'?'approved':'rejected',actor.id,id]);
    await logAction(client,actor,'youth_welfare_record_updates',id,choice==='approve'?'public_update_approved':'public_update_rejected',{person_id:update.person_id});
    return {id,person_id:update.person_id,status:choice==='approve'?'approved':'rejected'};
  });
}

export async function youthWelfareRecordHistory(personId,{limit=50}={}){
  const id=validId(personId,'person'),max=integerInRange(limit,50,1,100);
  const eligible=eligiblePredicate();
  return transaction(async client=>{
    const person=(await client.query(`SELECT p.id FROM public.people p WHERE p.id=$1 AND ${eligible}`,[id])).rows[0];
    if(!person)throw httpError(404,'Youth Welfare profile not found.');
    return (await client.query(`SELECT id,action,record_snapshot,created_at::text AS created_at
      FROM public.youth_welfare_record_history WHERE person_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,[id,max])).rows;
  },{write:false});
}

export async function youthWelfareTrackerAssignment(personId) {
  const id = validId(personId, 'person');
  const eligible = eligiblePredicate();
  return transaction(async (client) => {
    const { rows } = await client.query(`
      SELECT
        membership.role AS membership_role,
        membership.tier,
        membership.joined_at::text AS joined_at,
        group_record.name AS lifegroup_name,
        COALESCE(NULLIF(BTRIM(network.name), ''), NULLIF(BTRIM(group_record.network), '')) AS network_name,
        COALESCE(NULLIF(BTRIM(group_leader.full_name), ''), NULLIF(BTRIM(CONCAT_WS(' ', group_leader.first_name, group_leader.last_name)), '')) AS lifegroup_leader_name,
        COALESCE(NULLIF(BTRIM(network_leader.full_name), ''), NULLIF(BTRIM(CONCAT_WS(' ', network_leader.first_name, network_leader.last_name)), '')) AS network_leader_name
      FROM public.people p
      LEFT JOIN LATERAL (
        SELECT m.lifegroup_id, m.role, m.tier, m.joined_at
        FROM public.lifegroup_memberships m
        WHERE m.person_id = p.id AND m.left_at IS NULL
        ORDER BY m.joined_at DESC, m.id DESC
        LIMIT 1
      ) membership ON true
      LEFT JOIN public.lifegroups group_record ON group_record.id = membership.lifegroup_id
      LEFT JOIN public.networks network ON network.id = group_record.network_id
      LEFT JOIN public.people group_leader
        ON group_leader.id = group_record.leader_person_id
        AND group_leader.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id = group_leader.id)
      LEFT JOIN public.people network_leader
        ON network_leader.id = network.leader_person_id
        AND network_leader.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.vip_registrations vip WHERE vip.person_id = network_leader.id)
      WHERE p.id = $1 AND ${eligible}
      LIMIT 1
    `, [id]);
    if (!rows[0]) throw httpError(404, 'Youth Welfare profile not found.');
    if (!rows[0].membership_role) return { current: null };
    const current = rows[0];
    return {
      current: {
        lifegroup_name: current.lifegroup_name || null,
        network_name: current.network_name || null,
        lifegroup_leader_name: current.lifegroup_leader_name || null,
        network_leader_name: current.network_leader_name || null,
        membership_role: current.membership_role,
        tier: current.tier,
        joined_at: current.joined_at,
      },
    };
  }, { write: false });
}

export async function setYouthWelfareCategory(personId, rawCategory, actor) {
  const id = validId(personId, 'person');
  const category = validateYouthCategory(rawCategory);
  const eligible = eligiblePredicate();
  return transaction(async (client) => {
    const person = await client.query(`SELECT p.id FROM public.people p WHERE p.id=$1 AND ${eligible} FOR UPDATE OF p`,[id]);
    if (!person.rows[0]) throw httpError(404, 'Eligible Youth Welfare profile not found.');
    const previous = await client.query('SELECT category FROM public.youth_welfare_categories WHERE person_id=$1 FOR UPDATE',[id]);
    const before = previous.rows[0]?.category || 'unclassified';
    if (before === category) return { person_id: id, category, category_label: youthCategoryLabel(category) };
    await client.query(`
      INSERT INTO public.youth_welfare_categories(person_id,category,updated_by,created_at,updated_at)
      VALUES($1,$2,$3,now(),now()) ON CONFLICT(person_id) DO UPDATE
      SET category=EXCLUDED.category,updated_by=EXCLUDED.updated_by,updated_at=now()
    `,[id,category,actor.id]);
    await logAction(client,actor,'youth_welfare_categories',id,'category_changed',{from:before,to:category});
    return { person_id:id,category,category_label:youthCategoryLabel(category) };
  });
}

export async function youthWelfareDataQuality({ limit = 50, offset = 0, includePrivate = false } = {}) {
  const eligible = eligiblePredicate();
  const pageSize = integerInRange(limit, 50, 1, 100);
  const pageOffset = integerInRange(offset, 0, 0, 1000000);
  const cte = `
    WITH eligible_people AS (
      SELECT p.id,p.person_code,p.first_name,p.last_name,p.full_name,p.email,p.birthdate,p.sex,p.school,p.ministry,p.privacy_consent_at
      FROM public.people p WHERE ${eligible}
    ), duplicate_emails AS (
      SELECT lower(btrim(email)) AS email,count(*)::int AS matching_count
      FROM eligible_people WHERE NULLIF(btrim(email),'') IS NOT NULL
      GROUP BY lower(btrim(email)) HAVING count(*)>1
    ), flagged AS (
      SELECT p.*,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN ${missingFieldSql.email} THEN 'Email not provided' END,
          CASE WHEN ${missingFieldSql.birthday} THEN 'Birthday not provided' END,
          CASE WHEN ${missingFieldSql.gender} THEN 'Gender not provided' END,
          CASE WHEN ${missingFieldSql.school} THEN 'School not provided' END,
          CASE WHEN ${missingFieldSql.ministry} THEN 'Ministry not provided' END,
          CASE WHEN ${missingFieldSql.consent} THEN 'Consent record missing' END
        ],NULL) AS missing_fields,
        d.matching_count AS duplicate_email_count
      FROM eligible_people p LEFT JOIN duplicate_emails d ON lower(btrim(p.email))=d.email
      WHERE ${missingFieldSql.email} OR ${missingFieldSql.birthday} OR ${missingFieldSql.gender} OR ${missingFieldSql.school} OR ${missingFieldSql.ministry} OR ${missingFieldSql.consent} OR d.email IS NOT NULL
    )
  `;
  return transaction(async (client) => {
    const stats = await client.query(`${cte}
      SELECT (SELECT count(*)::int FROM eligible_people) AS eligible_total,
        count(*)::int AS flagged_people,
        count(*) FILTER (WHERE cardinality(missing_fields)>0)::int AS incomplete_people,
        count(*) FILTER (WHERE duplicate_email_count IS NOT NULL)::int AS possible_duplicate_people,
        (SELECT count(*)::int FROM duplicate_emails) AS duplicate_email_groups
      FROM flagged
    `);
    const issues = includePrivate ? await client.query(`${cte}
      SELECT id,person_code,COALESCE(NULLIF(btrim(full_name),''),concat_ws(' ',first_name,last_name)) AS full_name,
        email,missing_fields,(duplicate_email_count IS NOT NULL) AS possible_duplicate,duplicate_email_count AS duplicate_count
      FROM flagged ORDER BY lower(COALESCE(NULLIF(full_name,''),concat_ws(' ',first_name,last_name))),id
      LIMIT $1 OFFSET $2
    `,[pageSize,pageOffset]) : {rows:[]};
    const result = stats.rows[0];
    return {
      eligible_total: result.eligible_total,
      flagged_people: result.flagged_people,
      incomplete_people: result.incomplete_people,
      possible_duplicate_people: result.possible_duplicate_people,
      duplicate_email_groups: result.duplicate_email_groups,
      issues: issues.rows,
      issues_redacted:!includePrivate,
      limit: pageSize,
      offset: pageOffset,
      limitations: ['Possible matches use the same email address only; no automatic merge is performed.','Conflicting answers cannot be checked without an independent source or response history.'],
      reconciliation: {
        available: false,
        source: 'Only LIFEGEN records are connected; no independent source is available.',
        reason: 'No second source is available to verify discrepancies.',
      },
    };
  }, { write: false });
}

export async function youthWelfareTasks({ status = 'all', q = '', assignee = 'all', limit = 100 } = {}) {
  const eligible = eligiblePredicate();
  const taskStatus = String(status ?? 'all');
  if (taskStatus !== 'all' && !TASK_STATUSES.has(taskStatus)) throw httpError(400, 'Choose a valid task status.');
  const search = String(q ?? '').trim().slice(0, 100);
  const assigned = String(assignee ?? 'all');
  if (assigned !== 'all' && assigned !== 'unassigned' && !/^[0-9]+$/.test(assigned)) throw httpError(400, 'Choose a valid assignee filter.');
  const assigneeId = assigned === 'all' || assigned === 'unassigned' ? null : validId(assigned, 'assignee');
  const max = integerInRange(limit, 100, 1, 250);
  return transaction(async (client) => {
    const { rows } = await client.query(`
      SELECT task.id,task.person_id,task.task_type,task.title,task.notes,task.status,task.assigned_to,
        assigned.display_name AS assigned_to_name,task.due_date::text AS due_date,
        task.created_by,task.created_at,task.updated_at,task.resolved_at::text AS resolved_at,
        COALESCE(NULLIF(btrim(p.full_name),''),concat_ws(' ',p.first_name,p.last_name)) AS person_name,
        p.person_code
      FROM public.youth_welfare_follow_up_tasks task
      JOIN public.people p ON p.id=task.person_id
      LEFT JOIN public.staff_users assigned ON assigned.id=task.assigned_to
      WHERE ${eligible}
        AND ($1::text='all' OR task.status=$1)
        AND ($2::text='' OR concat_ws(' ',task.title,task.notes,p.full_name,p.first_name,p.last_name,p.person_code) ILIKE '%'||$2||'%')
        AND ($3::text='all' OR ($3::text='unassigned' AND task.assigned_to IS NULL) OR task.assigned_to=$4::bigint)
      ORDER BY CASE task.status WHEN 'needs_review' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        task.due_date NULLS LAST,task.updated_at DESC,task.id DESC
      LIMIT $5
    `,[taskStatus,search,assigned,assigneeId,max]);
    return rows;
  }, { write: false });
}

export async function youthWelfareAssignees() {
  return transaction(async (client) => (await client.query('SELECT id,display_name FROM public.staff_users WHERE is_active=true ORDER BY lower(display_name),id')).rows,{write:false});
}

export async function createYouthWelfareTask(raw, actor) {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const personId = validId(body.person_id,'person');
  const type = String(body.task_type ?? 'data_verification');
  if (!TASK_TYPES.has(type)) throw httpError(400,'Choose a valid administrative task type.');
  const title = cleanString(body.title,160,'a task title',{required:true});
  const notes = cleanString(body.notes,500,'task notes');
  const dueDate = validDate(body.due_date,'due date',{optional:true});
  const assignedTo = body.assigned_to == null || body.assigned_to === '' ? null : validId(body.assigned_to,'assignee');
  const eligible = eligiblePredicate();
  try {
    return await transaction(async (client) => {
      const person = await client.query(`SELECT p.id FROM public.people p WHERE p.id=$1 AND ${eligible} FOR SHARE OF p`,[personId]);
      if (!person.rows[0]) throw httpError(404,'Eligible Youth Welfare profile not found.');
      if (assignedTo && !(await client.query('SELECT id FROM public.staff_users WHERE id=$1 AND is_active=true',[assignedTo])).rows[0]) throw httpError(400,'Choose an active staff member.');
      const { rows } = await client.query(`
        INSERT INTO public.youth_welfare_follow_up_tasks(person_id,task_type,title,notes,status,assigned_to,due_date,created_by,updated_by)
        VALUES($1,$2,$3,$4,'needs_review',$5,$6,$7,$7)
        RETURNING id,person_id,task_type,title,notes,status,assigned_to,due_date::text AS due_date,created_at,updated_at
      `,[personId,type,title,notes,assignedTo,dueDate,actor.id]);
      await logAction(client,actor,'youth_welfare_follow_up_tasks',rows[0].id,'task_created',{person_id:personId,task_type:type,status:'needs_review',due_date:dueDate});
      return rows[0];
    });
  } catch (error) {
    if (error?.code === '23505') throw httpError(409,'An open task with this title and type already exists for this person.');
    throw error;
  }
}

export async function updateYouthWelfareTask(taskId, raw, actor) {
  const id = validId(taskId,'task');
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const eligible = eligiblePredicate();
  return transaction(async (client) => {
    const current = (await client.query(`
      SELECT task.* FROM public.youth_welfare_follow_up_tasks task
      JOIN public.people p ON p.id=task.person_id
      WHERE task.id=$1 AND ${eligible}
      FOR UPDATE OF task
    `,[id])).rows[0];
    if (!current) throw httpError(404,'Youth Welfare task not found.');
    const status = body.status === undefined ? current.status : String(body.status);
    if (!TASK_STATUSES.has(status)) throw httpError(400,'Choose a valid task status.');
    const notes = body.notes === undefined ? current.notes : cleanString(body.notes,500,'task notes');
    const dueDate = body.due_date === undefined ? current.due_date : validDate(body.due_date,'due date',{optional:true});
    const assignedTo = body.assigned_to === undefined ? current.assigned_to : (body.assigned_to == null || body.assigned_to === '' ? null : validId(body.assigned_to,'assignee'));
    if (assignedTo && !(await client.query('SELECT id FROM public.staff_users WHERE id=$1 AND is_active=true',[assignedTo])).rows[0]) throw httpError(400,'Choose an active staff member.');
    const resolvedAt = status === 'resolved' ? (current.resolved_at || new Date().toISOString()) : null;
    const { rows } = await client.query(`
      UPDATE public.youth_welfare_follow_up_tasks SET status=$1,notes=$2,due_date=$3,assigned_to=$4,
        updated_by=$5,updated_at=now(),resolved_at=$6
      WHERE id=$7
      RETURNING id,person_id,task_type,title,notes,status,assigned_to,due_date::text AS due_date,created_at,updated_at,resolved_at::text AS resolved_at
    `,[status,notes,dueDate,assignedTo,actor.id,resolvedAt,id]);
    if (current.status !== status) await logAction(client,actor,'youth_welfare_follow_up_tasks',id,'task_status_changed',{from:current.status,to:status,person_id:current.person_id});
    else await logAction(client,actor,'youth_welfare_follow_up_tasks',id,'task_updated',{person_id:current.person_id,due_date:dueDate,assigned_to:assignedTo});
    return rows[0];
  });
}

export async function youthWelfareReminders(actor) {
  const eligible = eligiblePredicate();
  return transaction(async (client) => (await client.query(`
    SELECT task.id AS task_id,task.title,task.status,task.due_date::text AS due_date,
      task.person_id,COALESCE(NULLIF(btrim(p.full_name),''),concat_ws(' ',p.first_name,p.last_name)) AS person_name
    FROM public.youth_welfare_follow_up_tasks task
    JOIN public.people p ON p.id=task.person_id
    LEFT JOIN public.youth_welfare_reminder_dismissals dismissed
      ON dismissed.task_id=task.id AND dismissed.user_id=$1 AND dismissed.due_date=task.due_date
    WHERE ${eligible} AND task.status<>'resolved' AND task.due_date IS NOT NULL
      AND task.due_date<=(now() AT TIME ZONE 'Asia/Manila')::date+7 AND dismissed.task_id IS NULL
    ORDER BY task.due_date,task.id LIMIT 100
  `,[actor.id])).rows,{write:false});
}

export async function dismissYouthWelfareReminder(taskId, dueDateValue, actor) {
  const id=validId(taskId,'task');
  const dueDate=validDate(dueDateValue,'due date');
  const eligible=eligiblePredicate();
  return transaction(async(client)=>{
    const task=(await client.query(`SELECT task.id,task.person_id FROM public.youth_welfare_follow_up_tasks task JOIN public.people p ON p.id=task.person_id WHERE task.id=$1 AND task.due_date=$2 AND task.status<>'resolved' AND ${eligible} FOR UPDATE OF task`,[id,dueDate])).rows[0];
    if(!task)throw httpError(404,'Reminder not found or no longer active.');
    await client.query('INSERT INTO public.youth_welfare_reminder_dismissals(user_id,task_id,due_date) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[actor.id,id,dueDate]);
    await logAction(client,actor,'youth_welfare_reminder_dismissals',`${id}:${dueDate}`,'reminder_dismissed',{task_id:id,person_id:task.person_id});
    return {ok:true};
  });
}

export async function youthWelfareSavedViews(actor) {
  return transaction(async(client)=>(await client.query('SELECT id,name,filters,created_at,updated_at FROM public.youth_welfare_saved_views WHERE user_id=$1 ORDER BY lower(name),id',[actor.id])).rows,{write:false});
}

export async function createYouthWelfareSavedView(raw,actor) {
  const body=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const name=cleanString(body.name,80,'a view name',{required:true});
  const filters=normalizeYouthFilters(body.filters||{});
  try {
    return await transaction(async(client)=>{
      const {rows}=await client.query('INSERT INTO public.youth_welfare_saved_views(user_id,name,filters) VALUES($1,$2,$3::jsonb) RETURNING id,name,filters,created_at,updated_at',[actor.id,name,JSON.stringify(filters)]);
      await logAction(client,actor,'youth_welfare_saved_views',rows[0].id,'saved_view_created',{name});
      return rows[0];
    });
  } catch(error) { if(error?.code==='23505')throw httpError(409,'A saved view with that name already exists.');throw error; }
}

export async function updateYouthWelfareSavedView(viewId,raw,actor) {
  const id=validId(viewId,'saved view');
  const body=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const name=cleanString(body.name,80,'a view name',{required:true});
  const filters=normalizeYouthFilters(body.filters||{});
  try {
    return await transaction(async(client)=>{
      const {rows}=await client.query('UPDATE public.youth_welfare_saved_views SET name=$1,filters=$2::jsonb,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING id,name,filters,created_at,updated_at',[name,JSON.stringify(filters),id,actor.id]);
      if(!rows[0])throw httpError(404,'Saved view not found.');
      await logAction(client,actor,'youth_welfare_saved_views',id,'saved_view_updated',{name});
      return rows[0];
    });
  } catch(error) { if(error?.code==='23505')throw httpError(409,'A saved view with that name already exists.');throw error; }
}

export async function deleteYouthWelfareSavedView(viewId,actor) {
  const id=validId(viewId,'saved view');
  return transaction(async(client)=>{
    const {rows}=await client.query('DELETE FROM public.youth_welfare_saved_views WHERE id=$1 AND user_id=$2 RETURNING id,name',[id,actor.id]);
    if(!rows[0])throw httpError(404,'Saved view not found.');
    await logAction(client,actor,'youth_welfare_saved_views',id,'saved_view_deleted',{name:rows[0].name});
    return {ok:true};
  });
}

export async function youthWelfareReportTemplates(actor) {
  const custom=await transaction(async(client)=>(await client.query('SELECT id,name,config,created_at,updated_at FROM public.youth_welfare_report_templates WHERE user_id=$1 ORDER BY lower(name),id',[actor.id])).rows,{write:false});
  return {built_in:YOUTH_REPORT_TEMPLATES,custom:custom.map(template=>({...template,is_custom:true}))};
}

export async function createYouthWelfareReportTemplate(raw,actor) {
  const body=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const name=cleanString(body.name,80,'a report template name',{required:true});
  const config=normalizeReportConfig(body.config||{});
  try {
    return await transaction(async(client)=>{
      const {rows}=await client.query('INSERT INTO public.youth_welfare_report_templates(user_id,name,config) VALUES($1,$2,$3::jsonb) RETURNING id,name,config,created_at,updated_at',[actor.id,name,JSON.stringify(config)]);
      await logAction(client,actor,'youth_welfare_report_templates',rows[0].id,'report_template_created',{name});
      return rows[0];
    });
  } catch(error) { if(error?.code==='23505')throw httpError(409,'A report template with that name already exists.');throw error; }
}

export async function updateYouthWelfareReportTemplate(templateId,raw,actor) {
  const id=validId(templateId,'report template');
  const body=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const name=cleanString(body.name,80,'a report template name',{required:true});
  const config=normalizeReportConfig(body.config||{});
  try {
    return await transaction(async(client)=>{
      const {rows}=await client.query('UPDATE public.youth_welfare_report_templates SET name=$1,config=$2::jsonb,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING id,name,config,created_at,updated_at',[name,JSON.stringify(config),id,actor.id]);
      if(!rows[0])throw httpError(404,'Report template not found.');
      await logAction(client,actor,'youth_welfare_report_templates',id,'report_template_updated',{name});
      return rows[0];
    });
  } catch(error) { if(error?.code==='23505')throw httpError(409,'A report template with that name already exists.');throw error; }
}

export async function deleteYouthWelfareReportTemplate(templateId,actor) {
  const id=validId(templateId,'report template');
  return transaction(async(client)=>{
    const {rows}=await client.query('DELETE FROM public.youth_welfare_report_templates WHERE id=$1 AND user_id=$2 RETURNING id,name',[id,actor.id]);
    if(!rows[0])throw httpError(404,'Report template not found.');
    await logAction(client,actor,'youth_welfare_report_templates',id,'report_template_deleted',{name:rows[0].name});
    return {ok:true};
  });
}

function normalizeReportConfig(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw httpError(400,'Invalid report template configuration.');
  const type=String(input.type||'registration_summary');
  const period=String(input.period||'month');
  const category=String(input.category||'all');
  if(!REPORT_TYPES.has(type))throw httpError(400,'Choose a supported report type.');
  if(!['all','month','quarter','custom'].includes(period))throw httpError(400,'Choose a supported report period.');
  if(type==='registration_summary'&&period==='all')throw httpError(400,'Registration reports require a month, quarter, or custom date range.');
  if(category!=='all'&&!CATEGORY_IDS.has(category))throw httpError(400,'Choose a valid category.');
  return {type,period,category};
}

export async function youthWelfareRegistrationReport({from,to,compareFrom=null,compareTo=null,category='all'}={}) {
  const start=validDate(from,'report start date');
  const end=validDate(to,'report end date');
  if(start>end)throw httpError(400,'The report start date must be before the end date.');
  const categoryFilter=String(category??'all');
  if(categoryFilter!=='all'&&!CATEGORY_IDS.has(categoryFilter))throw httpError(400,'Choose a valid category filter.');
  let compareStart=null,compareEnd=null;
  if(compareFrom||compareTo){
    compareStart=validDate(compareFrom,'comparison start date');
    compareEnd=validDate(compareTo,'comparison end date');
    if(compareStart>compareEnd)throw httpError(400,'The comparison start date must be before the end date.');
  }
  const eligible=eligiblePredicate();
  return transaction(async(client)=>{
    const period=await registrationPeriodQuery(client,eligible,start,end,categoryFilter);
    const comparison=compareStart?await registrationPeriodQuery(client,eligible,compareStart,compareEnd,categoryFilter):null;
    const current=await client.query(`SELECT count(*)::int AS total,COALESCE(category.category,'unclassified') AS category FROM public.people p LEFT JOIN public.youth_welfare_categories category ON category.person_id=p.id WHERE ${eligible} GROUP BY COALESCE(category.category,'unclassified')`,[]);
    const currentCategories=Object.fromEntries(YOUTH_WELFARE_CATEGORIES.map(({id})=>[id,0]));
    for(const row of current.rows)currentCategories[row.category]=row.total;
    return {
      period:{from:start,to:end,category_filter:categoryFilter,unique_people_registered:period.registrations,current_category_breakdown_for_those_people:period.categories},
      comparison:comparison?{from:compareStart,to:compareEnd,category_filter:categoryFilter,unique_people_registered:comparison.registrations,current_category_breakdown_for_those_people:comparison.categories}:null,
      current_snapshot:{eligible_people:Object.values(currentCategories).reduce((a,b)=>a+b,0),categories:currentCategories},
      limitations:['Registration totals use distinct people with a public_registration audit event created during the selected Asia/Manila period.','Category breakdowns show current Youth Welfare classifications for those people; no historical category snapshots exist.','These are registration counts, not attendance counts or historical population snapshots.'],
      source:'lifegen_database',generated_at:new Date().toISOString(),
    };
  },{write:false});
}

async function registrationPeriodQuery(client,eligible,from,to,categoryFilter='all') {
  const {rows}=await client.query(`
    WITH period_people AS (
      SELECT DISTINCT p.id,COALESCE(category.category,'unclassified') AS category
      FROM public.audit_log registration_event
      JOIN public.people p ON p.id::text=registration_event.entity_id
      LEFT JOIN public.youth_welfare_categories category ON category.person_id=p.id
      WHERE registration_event.entity='people' AND registration_event.action='public_registration'
        AND (registration_event.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date
        AND ${eligible}
        AND ($3::text='all' OR COALESCE(category.category,'unclassified')=$3)
    )
    SELECT count(*)::int AS registrations,
      count(*) FILTER (WHERE category='student')::int AS student,
      count(*) FILTER (WHERE category='working_student')::int AS working_student,
      count(*) FILTER (WHERE category='young_professional')::int AS young_professional,
      count(*) FILTER (WHERE category='working_employed')::int AS working_employed,
      count(*) FILTER (WHERE category='not_studying')::int AS not_studying,
      count(*) FILTER (WHERE category='unable_to_continue')::int AS unable_to_continue,
      count(*) FILTER (WHERE category='unclassified')::int AS unclassified
    FROM period_people
  `,[from,to,categoryFilter]);
  return {registrations:rows[0].registrations,categories:Object.fromEntries(YOUTH_WELFARE_CATEGORIES.map(({id})=>[id,rows[0][id]]))};
}

export async function youthWelfareRegistrationTrend({from=null,to=null,months=12,category='all'}={}) {
  const categoryFilter=String(category??'all');
  if(categoryFilter!=='all'&&!CATEGORY_IDS.has(categoryFilter))throw httpError(400,'Choose a valid category filter.');
  const start=from?validDate(from,'trend start date'):null;
  const end=to?validDate(to,'trend end date'):null;
  if(Boolean(start)!==Boolean(end))throw httpError(400,'Select both trend start and end dates.');
  if(start&&start>end)throw httpError(400,'The trend start date must be before the end date.');
  const monthCount=integerInRange(months,12,1,24);
  if(start){
    const span=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7));
    if(span>47)throw httpError(400,'Monthly trend charts support ranges up to 48 months.');
  }
  const eligible=eligiblePredicate();
  return transaction(async client=>{
    const {rows}=await client.query(`
      WITH bounds AS (
        SELECT
          COALESCE($2::date,(date_trunc('month',now() AT TIME ZONE 'Asia/Manila')-(($4::int-1)*interval '1 month'))::date) AS start_date,
          COALESCE($3::date,(now() AT TIME ZONE 'Asia/Manila')::date) AS end_date
      ),
      months AS (
        SELECT generate_series(date_trunc('month',start_date::timestamp),date_trunc('month',end_date::timestamp),interval '1 month')::date AS month
        FROM bounds
      ),
      monthly_people AS (
        SELECT date_trunc('month',registration_event.created_at AT TIME ZONE 'Asia/Manila')::date AS month,
          count(DISTINCT p.id)::int AS people
        FROM public.audit_log registration_event
        JOIN public.people p ON p.id::text=registration_event.entity_id
        LEFT JOIN public.youth_welfare_categories category_override ON category_override.person_id=p.id
        CROSS JOIN bounds
        WHERE registration_event.entity='people' AND registration_event.action='public_registration'
          AND (registration_event.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN bounds.start_date AND bounds.end_date
          AND ${eligible}
          AND ($1::text='all' OR COALESCE(category_override.category,'unclassified')=$1)
        GROUP BY 1
      ),
      period_total AS (
        SELECT count(DISTINCT p.id)::int AS people
        FROM public.audit_log registration_event
        JOIN public.people p ON p.id::text=registration_event.entity_id
        LEFT JOIN public.youth_welfare_categories category_override ON category_override.person_id=p.id
        CROSS JOIN bounds
        WHERE registration_event.entity='people' AND registration_event.action='public_registration'
          AND (registration_event.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN bounds.start_date AND bounds.end_date
          AND ${eligible}
          AND ($1::text='all' OR COALESCE(category_override.category,'unclassified')=$1)
      )
      SELECT months.month::text AS month,COALESCE(monthly_people.people,0)::int AS people,period_total.people AS period_people,
        (SELECT start_date::text FROM bounds) AS from_date,(SELECT end_date::text FROM bounds) AS to_date
      FROM months LEFT JOIN monthly_people USING(month) CROSS JOIN period_total ORDER BY months.month
    `,[categoryFilter,start,end,monthCount]);
    return {from:rows[0]?.from_date||start,to:rows[0]?.to_date||end,category_filter:categoryFilter,months:rows.map(row=>({month:row.month,people:row.people})),period_unique_people:Number(rows[0]?.period_people||0),source:'public_registration_audit_log',generated_at:new Date().toISOString(),note:'Each month counts distinct eligible people with at least one verified public-registration audit event in that month. The period total counts distinct people across the full selected range; a person with separate events in multiple months may appear in more than one monthly bar. Categories are current assignments; historical category snapshots are unavailable.'};
  },{write:false});
}

function csvCell(value) {
  let text=String(value??'');
  if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}

export async function youthWelfareCsv({q='',category='all',missing='all',education_status='all',lcsol_enrolled='all',tab='all',age_min=null,age_max=null,cell_leader='all',lcsol_status='all',verification_status='all',from=null,to=null}={},actor) {
  const eligible=eligiblePredicate();
  const filters=normalizeYouthFilters({q,category,missing,education_status,lcsol_enrolled,tab,age_min,age_max,cell_leader,lcsol_status,verification_status});
  const start=from?validDate(from,'report start date'):null;
  const end=to?validDate(to,'report end date'):null;
  if(Boolean(start)!==Boolean(end))throw httpError(400,'Select both start and end dates for a registration-period export.');
  if(start&&start>end)throw httpError(400,'The report start date must be before the end date.');
  const missingClause=filters.missing==='all'?'':filters.missing==='review'?`AND (${missingExpression} OR ${duplicateEmailPredicate()})`:filters.missing==='incomplete'?`AND ${missingExpression}`:filters.missing==='duplicates'?`AND ${duplicateEmailPredicate()}`:`AND ${missingFieldSql[filters.missing]}`;
  const ageExpression=`COALESCE(CASE WHEN p.birthdate IS NULL THEN NULL ELSE EXTRACT(YEAR FROM age(current_date,p.birthdate))::int END,p.age)`;
  const selectedTab=YOUTH_WELFARE_PEOPLE_TABS.find(item=>item.id===filters.tab);
  const tabClause=selectedTab.education_status?`AND welfare.education_status='${selectedTab.education_status}'`:filters.tab==='incomplete'?`AND ${welfareIncompletePredicate()}`:'';
  const dateClause=start?`AND EXISTS (SELECT 1 FROM public.audit_log registration_event WHERE registration_event.entity='people' AND registration_event.action='public_registration' AND registration_event.entity_id=p.id::text AND (registration_event.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $10::date AND $11::date)`:'';
  const params=[filters.q,filters.category,filters.education_status,filters.lcsol_enrolled,filters.lcsol_status,filters.verification_status,filters.cell_leader,filters.age_min,filters.age_max];
  if(start)params.push(start,end);
  return transaction(async(client)=>{
    const {rows}=await client.query(`
      ${personSelect()}
      WHERE ${eligible}
        AND ($1::text='' OR CONCAT_WS(' ',p.first_name,p.last_name,p.full_name,p.person_code,p.id::text) ILIKE '%'||$1||'%')
        AND ($2::text='all' OR COALESCE(category.category,'unclassified')=$2)
        AND ($3::text='all' OR welfare.education_status=$3)
        AND ($4::text='all' OR ($4='yes' AND welfare.lcsol_enrolled IS TRUE) OR ($4='no' AND welfare.lcsol_enrolled IS FALSE) OR ($4='unknown' AND welfare.lcsol_enrolled IS NULL))
        AND ($5::text='all' OR ($5='unknown' AND welfare.lcsol_status IS NULL) OR welfare.lcsol_status=$5)
        AND ($6::text='all' OR ($6='verified' AND welfare.verification_status='verified') OR ($6='pending' AND welfare.person_id IS NOT NULL AND COALESCE(welfare.verification_status,'pending')='pending') OR ($6='not_recorded' AND welfare.person_id IS NULL))
        AND ($7::text='all' OR ($7 LIKE 'person:%' AND welfare.cell_leader_person_id=substring($7 FROM 8)::bigint) OR ($7 LIKE 'manual:%' AND lower(btrim(welfare.cell_leader_manual_name))=lower(btrim(substring($7 FROM 8)))))
        AND ($8::int IS NULL OR ${ageExpression}>=$8::int)
        AND ($9::int IS NULL OR ${ageExpression}<=$9::int)
        ${missingClause} ${tabClause} ${dateClause}
      ORDER BY lower(COALESCE(NULLIF(p.full_name,''),concat_ws(' ',p.first_name,p.last_name))),p.id
      LIMIT 10001
    `,params);
    if(rows.length>10000)throw httpError(413,'The export contains more than 10,000 people. Add filters and export a smaller set.');
    await logAction(client,actor,'youth_welfare_reports',null,'csv_exported',{count:rows.length,filters:{...filters,from:start,to:end}});
    const header=['Person code','Name','Email','Birthday','Age','Gender','School','Course / Year','Occupation','Ministry','Invited by','LIFEGEN status','Registration date','Privacy consent recorded','Youth Welfare category','Education status','Grade / year level','School-stop period','Continuation plans','LCSOL enrolled','LCSOL progress','Verification status'];
    const lines=[header.map(csvCell).join(',')];
    for(const row of rows)lines.push([row.person_code,row.full_name,row.email,row.birthdate,row.age,row.gender,row.school,row.course_year,row.occupation,row.ministry,row.inviter,row.status,row.date_registered,row.consent_recorded_at,youthCategoryLabel(row.youth_category),YOUTH_EDUCATION_STATUSES[row.education_status]||row.education_status,YOUTH_GRADE_YEAR_LEVELS[row.grade_year_level]||row.grade_year_level,YOUTH_SCHOOL_STOP_PERIODS[row.school_stop_period]||row.school_stop_period,YOUTH_CONTINUATION_CHOICES[row.continue_studies]||row.continue_studies,row.lcsol_enrolled===true?'Yes':row.lcsol_enrolled===false?'No':'',YOUTH_LCSOL_STATUSES[row.lcsol_status]||row.lcsol_status,row.verification_status].map(csvCell).join(','));
    return {csv:'\uFEFF'+lines.join('\r\n'),count:rows.length};
  });
}
export async function youthWelfareGlobalSearch(q,actor) {
  const search=String(q??'').trim().slice(0,100);
  if(search.length<2)return {people:[],tasks:[],saved_views:[]};
  const [people,tasks,views]=await Promise.all([
    youthWelfarePeople({q:search,limit:8,offset:0},actor),
    actor?.permissions?.includes('youth_welfare:manage')?youthWelfareTasks({q:search,limit:8}):Promise.resolve([]),
    youthWelfareSavedViews(actor),
  ]);
  const term=search.toLowerCase();
  return {people:people.people,tasks:tasks.slice(0,8).map(({id,title,person_id,person_name,status})=>({id,title,person_id,person_name,status})),saved_views:views.filter(view=>view.name.toLowerCase().includes(term)).slice(0,8)};
}

export async function youthWelfareActivity({limit=100}={}) {
  const eligible=eligiblePredicate();
  const max=integerInRange(limit,100,1,250);
  return transaction(async(client)=>{
    const {rows}=await client.query(`
      WITH activity_candidates AS (
        SELECT al.id,al.actor_name,al.entity,al.entity_id,al.action,al.created_at,
          CASE
            WHEN al.entity IN ('people','youth_welfare_categories') THEN NULLIF(al.entity_id,'')::bigint
            WHEN al.entity='youth_welfare_follow_up_tasks' THEN task.person_id
            ELSE NULL
          END AS person_id
        FROM public.audit_log al
        LEFT JOIN public.youth_welfare_follow_up_tasks task ON al.entity='youth_welfare_follow_up_tasks' AND task.id::text=al.entity_id
        WHERE al.entity IN ('people','youth_welfare_categories','youth_welfare_follow_up_tasks','youth_welfare_saved_views','youth_welfare_report_templates','youth_welfare_reports','youth_welfare_reminder_dismissals')
      ), eligible_activity AS (
        SELECT candidate.id,candidate.actor_name,candidate.entity,candidate.action,candidate.created_at,
          p.id AS person_id,COALESCE(NULLIF(btrim(p.full_name),''),concat_ws(' ',p.first_name,p.last_name)) AS person_name,p.person_code
        FROM activity_candidates candidate
        LEFT JOIN public.people p ON p.id=candidate.person_id
        WHERE candidate.person_id IS NULL OR (p.id IS NOT NULL AND ${eligible})
        ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT $1
      )
      SELECT * FROM eligible_activity ORDER BY created_at DESC,id DESC
    `,[max]);
    return rows.map(row=>({...row,event_label:activityLabel(row.entity,row.action)}));
  },{write:false});
}

function activityLabel(entity,action) {
  const labels={
    'people:public_registration':'Regular website registration received',
    'youth_welfare_categories:category_changed':'Youth Welfare category changed',
    'youth_welfare_follow_up_tasks:task_created':'Administrative review task created',
    'youth_welfare_follow_up_tasks:task_status_changed':'Administrative review task status changed',
    'youth_welfare_follow_up_tasks:task_updated':'Administrative review task updated',
    'youth_welfare_saved_views:saved_view_created':'Saved view created',
    'youth_welfare_saved_views:saved_view_updated':'Saved view updated',
    'youth_welfare_saved_views:saved_view_deleted':'Saved view deleted',
    'youth_welfare_report_templates:report_template_created':'Report template created',
    'youth_welfare_report_templates:report_template_updated':'Report template updated',
    'youth_welfare_report_templates:report_template_deleted':'Report template deleted',
    'youth_welfare_reports:csv_exported':'CSV report exported',
    'youth_welfare_reminder_dismissals:reminder_dismissed':'Reminder dismissed',
  };
  return labels[`${entity}:${action}`]||`${entity}: ${action}`;
}

const YOUTH_WELFARE_ACCESS_ROLES=new Set(['youth_welfare_admin','youth_welfare_staff','youth_welfare_viewer']);

export async function youthWelfareAccessList() {
  return transaction(async client=>{
    const {rows}=await client.query(`
      SELECT u.id,u.username,u.display_name,u.role_id,u.is_active,u.created_at,u.last_login_at,
        access.role_id AS access_role_id,access.status AS access_status,access.granted_at,access.revoked_at,
        CASE WHEN access.status='active' THEN access.role_id
          WHEN access.status='revoked' THEN NULL
          WHEN u.role_id IN ('youth_welfare_admin','youth_welfare_staff','youth_welfare_viewer') THEN u.role_id
          WHEN u.role_id='admin' THEN 'youth_welfare_admin' ELSE NULL END AS effective_role,
        CASE WHEN u.role_id='admin' THEN 'lifegen_admin'
          WHEN access.status IS NOT NULL THEN 'managed_assignment'
          ELSE 'existing_youth_welfare_role' END AS access_source,
        (u.role_id<>'admin') AS can_change_access
      FROM public.staff_users u
      LEFT JOIN public.youth_welfare_access access ON access.user_id=u.id
      WHERE access.user_id IS NOT NULL OR u.role_id IN ('admin','youth_welfare_admin','youth_welfare_staff','youth_welfare_viewer')
      ORDER BY CASE WHEN access.status='active' OR (access.status IS NULL AND u.role_id IN ('admin','youth_welfare_admin','youth_welfare_staff','youth_welfare_viewer')) THEN 0 ELSE 1 END,
        lower(u.display_name),u.id
    `);
    return {users:rows};
  },{write:false});
}

export async function youthWelfareAccessSearch(rawQuery='') {
  const q=String(rawQuery??'').trim().slice(0,100);
  if(q.length<2)return {users:[]};
  return transaction(async client=>{
    const {rows}=await client.query(`
      SELECT u.id,u.username,u.display_name,u.role_id,u.is_active,
        access.role_id AS access_role_id,access.status AS access_status,
        (u.role_id='admin') AS is_lifegen_admin
      FROM public.staff_users u
      LEFT JOIN public.youth_welfare_access access ON access.user_id=u.id
      WHERE u.is_active=true
        AND (u.username ILIKE '%'||$1||'%' OR u.display_name ILIKE '%'||$1||'%')
      ORDER BY lower(u.display_name),u.id LIMIT 30
    `,[q]);
    return {users:rows};
  },{write:false});
}

export async function setYouthWelfareAccess(userId,rawRole,actor) {
  const id=validId(userId,'staff user');
  const role=String(rawRole??'');
  if(!YOUTH_WELFARE_ACCESS_ROLES.has(role))throw httpError(400,'Choose Youth Welfare Admin, Youth Welfare Staff, or Youth Welfare Viewer.');
  if(id===Number(actor?.id))throw httpError(400,'You cannot change your own Youth Welfare access.');
  return transaction(async client=>{
    const account=(await client.query('SELECT id,role_id,is_active FROM public.staff_users WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!account)throw httpError(404,'LIFEGEN account not found.');
    if(!account.is_active)throw httpError(409,'Enable the LIFEGEN account before granting Youth Welfare access.');
    if(account.role_id==='admin')throw httpError(409,'A LIFEGEN Admin already has full Youth Welfare access and cannot be restricted here.');
    const current=(await client.query('SELECT role_id,status FROM public.youth_welfare_access WHERE user_id=$1 FOR UPDATE',[id])).rows[0];
    if(current?.status==='active'&&current.role_id===role)return {ok:true,user_id:id,role_id:role,status:'active',unchanged:true};
    await client.query(`
      INSERT INTO public.youth_welfare_access(user_id,role_id,status,granted_by,updated_by,granted_at,revoked_at,updated_at)
      VALUES($1,$2,'active',$3,$3,now(),NULL,now())
      ON CONFLICT(user_id) DO UPDATE SET role_id=EXCLUDED.role_id,status='active',granted_by=EXCLUDED.granted_by,
        updated_by=EXCLUDED.updated_by,granted_at=now(),revoked_at=NULL,updated_at=now()
    `,[id,role,actor.id]);
    const action=current?.status==='active'?'access_role_changed':'access_granted';
    await logAction(client,actor,'youth_welfare_access',id,action,{from:current?.role_id||account.role_id||null,to:role});
    return {ok:true,user_id:id,role_id:role,status:'active'};
  });
}

export async function revokeYouthWelfareAccess(userId,actor) {
  const id=validId(userId,'staff user');
  if(id===Number(actor?.id))throw httpError(400,'You cannot revoke your own Youth Welfare access.');
  return transaction(async client=>{
    const account=(await client.query('SELECT id,role_id,is_active FROM public.staff_users WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!account)throw httpError(404,'LIFEGEN account not found.');
    if(account.role_id==='admin')throw httpError(409,'LIFEGEN Admin access is managed by the existing administrator account policy.');
    const current=(await client.query('SELECT role_id,status FROM public.youth_welfare_access WHERE user_id=$1 FOR UPDATE',[id])).rows[0];
    if(current?.status==='revoked')return {ok:true,user_id:id,status:'revoked',unchanged:true};
    const previousRole=current?.role_id||(YOUTH_WELFARE_ACCESS_ROLES.has(account.role_id)?account.role_id:null);
    if(!previousRole)throw httpError(404,'Youth Welfare access assignment not found.');
    await client.query(`
      INSERT INTO public.youth_welfare_access(user_id,role_id,status,granted_by,updated_by,granted_at,revoked_at,updated_at)
      VALUES($1,$2,'revoked',NULL,$3,now(),now(),now())
      ON CONFLICT(user_id) DO UPDATE SET status='revoked',updated_by=EXCLUDED.updated_by,revoked_at=now(),updated_at=now()
    `,[id,previousRole,actor.id]);
    await logAction(client,actor,'youth_welfare_access',id,'access_revoked',{from:previousRole,to:null});
    return {ok:true,user_id:id,status:'revoked'};
  });
}

export async function youthWelfareAccessActivity({limit=100}={}) {
  const max=integerInRange(limit,100,1,200);
  return transaction(async client=>{
    const {rows}=await client.query(`
      SELECT audit.id,audit.actor_name,audit.action,audit.details,audit.created_at,
        audit.entity_id AS user_id,target.username AS target_username,target.display_name AS target_name
      FROM public.audit_log audit
      LEFT JOIN public.staff_users target ON target.id::text=audit.entity_id
      WHERE audit.entity='youth_welfare_access'
      ORDER BY audit.created_at DESC,audit.id DESC LIMIT $1
    `,[max]);
    return {events:rows.map(row=>({...row,event_label:({access_granted:'Youth Welfare access granted',access_role_changed:'Youth Welfare role changed',access_revoked:'Youth Welfare access revoked'})[row.action]||`Access change: ${row.action}`}))};
  },{write:false});
}

export async function youthWelfareDataStatus() {
  const eligible=eligiblePredicate();
  return transaction(async client=>{
    const checkedAt=new Date().toISOString();
    const {rows}=await client.query(`
      SELECT
        to_regclass('public.people') IS NOT NULL AS people_table,
        to_regclass('public.audit_log') IS NOT NULL AS audit_table,
        to_regclass('public.vip_registrations') IS NOT NULL AS vip_table,
        to_regclass('public.lifegroups') IS NOT NULL AS lifegroups_table,
        to_regclass('public.lifegroup_memberships') IS NOT NULL AS memberships_table,
        to_regclass('public.networks') IS NOT NULL AS networks_table,
        to_regclass('public.youth_welfare_access') IS NOT NULL AS access_table,
        to_regclass('public.youth_welfare_records') IS NOT NULL AS welfare_records_table,
        to_regclass('public.youth_welfare_record_updates') IS NOT NULL AS welfare_updates_table,
        to_regclass('public.youth_welfare_record_history') IS NOT NULL AS welfare_history_table
    `);
    const source=rows[0];
    const registrationOk=source.people_table&&source.audit_table&&source.vip_table;
    const lastRegistrationEvent=registrationOk?(await client.query(`SELECT max(registration_event.created_at)::text AS latest
      FROM public.audit_log registration_event JOIN public.people p ON p.id::text=registration_event.entity_id
      WHERE registration_event.entity='people' AND registration_event.action='public_registration' AND ${eligible}`)).rows[0].latest:null;
    let eligibleCount=0,trackerCount=null;
    if(registrationOk){
      eligibleCount=Number((await client.query(`SELECT count(*)::int AS n FROM public.people p WHERE ${eligible}`)).rows[0].n);
    }
    let trackerOk=registrationOk&&source.lifegroups_table&&source.memberships_table&&source.networks_table;
    if(trackerOk){
      try{
        trackerCount=Number((await client.query(`SELECT count(DISTINCT p.id)::int AS n FROM public.people p
          JOIN public.lifegroup_memberships membership ON membership.person_id=p.id AND membership.left_at IS NULL
          JOIN public.lifegroups group_record ON group_record.id=membership.lifegroup_id AND group_record.is_active=true
          WHERE ${eligible}`)).rows[0].n);
      }catch{trackerOk=false;trackerCount=null;}
    }
    return {
      checked_at:checkedAt,
      sources:[
        {id:'public_registration',label:'LIFEGEN registration',status:registrationOk?'connected':'unavailable',connection:registrationOk?'Registration source available':'Registration source unavailable',last_recorded_event:lastRegistrationEvent,sync_mode:'Shared LIFEGEN records · no background sync or test registration'},
        {id:'people_tracker',label:'People records',status:registrationOk?'connected':'unavailable',connection:registrationOk?'Eligible People records available':'Source unavailable · count not shown',eligible_records:registrationOk?eligibleCount:null,sync_mode:'Same LIFEGEN source · no background sync'},

        {id:'lifegroup_tracker',label:'LifeGroup Tracker',status:trackerOk?'connected':'unavailable',connection:trackerOk?'Current memberships available':'LifeGroup membership data unavailable',eligible_current_members:trackerOk?trackerCount:null,sync_mode:'Current assignments · no background sync'},
        {id:'youth_welfare_access',label:'Youth Welfare access',status:source.access_table?'connected':'unavailable',connection:source.access_table?'Available':'Unavailable · ask a LIFEGEN Admin to check setup',sync_mode:'Uses LIFEGEN accounts · no direct database access'},
        {id:'youth_welfare_records',label:'Youth Welfare answers',status:source.welfare_records_table?'connected':'unavailable',connection:source.welfare_records_table?'Protected answers and consent are available': 'Unavailable · ask a LIFEGEN Admin to check setup',review_queue_available:source.welfare_updates_table,history_available:source.welfare_history_table,sync_mode:'Linked to existing People records · no duplicates'},
      ],
      synchronization:{mode:'direct_database_queries',last_successful_sync:null,failed_syncs:null,note:'This portal reads the shared LIFEGEN source live; there is no background sync. The timestamp is when this check ran.'},
      reconciliation:{available:false,missing_records:null,conflicts:null,reason:'No second source is available to verify missing or conflicting records. Counts are unavailable, not zero.'},
    };
  },{write:false});
}

export async function youthWelfareReconciliationStatus() {
  return {
    available:false,
    source:'The verified regular-registration source is the shared LIFEGEN PostgreSQL database.',
    reason:'No independent source snapshot or separate synchronization job is configured. External reconciliation is therefore unavailable; no discrepancy count is guessed.',
  };
}
