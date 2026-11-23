import test from 'node:test';
import assert from 'node:assert/strict';
import {
  staffPersonLinkColumnAvailable,
  listStaffAccounts,
  insertStaffAccountRow,
  updateStaffAccountRow,
} from '../src/auth.js';

function fakeDb(hasPersonLink, rows=[]) {
  const calls=[];
  return {
    calls,
    async query(sql,params=[]) {
      calls.push({sql,params});
      if(sql.includes('information_schema.columns'))return {rows:[{available:hasPersonLink}]};
      return {rows};
    },
  };
}

test('detects whether the optional staff-to-People link column is installed',async()=>{
  assert.equal(await staffPersonLinkColumnAvailable(fakeDb(true)),true);
  assert.equal(await staffPersonLinkColumnAvailable(fakeDb(false)),false);
});

test('staff account listing works before the optional person_id column is installed',async()=>{
  const db=fakeDb(false,[{id:12,username:'welfare.admin',display_name:'Welfare Admin',role_id:'youth_welfare_admin',person_id:null,is_active:true}]);
  const users=await listStaffAccounts(db);
  assert.match(db.calls[1].sql,/NULL::bigint AS person_id/);
  assert.deepEqual(users,[{id:12,username:'welfare.admin',display_name:'Welfare Admin',role_id:'youth_welfare_admin',person_id:null,is_active:true,role_name:'youth_welfare_admin'}]);
});

test('staff account listing uses the linked People column when the migration is installed',async()=>{
  const db=fakeDb(true,[{id:12,username:'welfare.admin',display_name:'Welfare Admin',role_id:'youth_welfare_admin',person_id:7,is_active:true}]);
  const users=await listStaffAccounts(db);
  assert.match(db.calls[1].sql,/role_id,person_id,is_active/);
  assert.equal(users[0].person_id,7);
});

test('staff account creation and edits do not require the optional link column',async()=>{
  const db=fakeDb(false);
  db.query=async(sql,params=[])=>{
    db.calls.push({sql,params});
    return {rows:[{id:12,username:'welfare.admin',display_name:'Welfare Admin',role_id:'youth_welfare_admin',is_active:true}]};
  };
  const created=await insertStaffAccountRow(db,{hasPersonLink:false,username:'welfare.admin',display:'Welfare Admin',roleId:'youth_welfare_admin',hash:'hash',personId:undefined});
  assert.match(db.calls[0].sql,/INSERT INTO staff_users\(username,display_name,role_id,password_hash\)/);
  assert.doesNotMatch(db.calls[0].sql,/person_id/);
  assert.deepEqual(db.calls[0].params,['welfare.admin','Welfare Admin','youth_welfare_admin','hash']);

  const current={id:12,person_id:undefined};
  const edited=await updateStaffAccountRow(db,{hasPersonLink:false,current,username:'welfare.admin',display:'Welfare Admin',roleId:'youth_welfare_admin',active:true,hash:null,personId:undefined});
  assert.match(db.calls[1].sql,/UPDATE staff_users SET username=/);
  assert.doesNotMatch(db.calls[1].sql,/person_id/);
  assert.deepEqual(db.calls[1].params,['welfare.admin','Welfare Admin','youth_welfare_admin',true,null,12]);
  assert.equal(created.id,12);
  assert.equal(edited.id,12);
});

test('a requested People link fails clearly if its optional migration is absent',async()=>{
  const db=fakeDb(false);
  await assert.rejects(
    insertStaffAccountRow(db,{hasPersonLink:false,username:'linked.staff',display:'Linked Staff',roleId:'staff',hash:'hash',personId:7}),
    error=>error.status===503&&/011_staff_people_link\.sql/.test(error.message),
  );
  assert.equal(db.calls.length,0);
});

test('staff account linking still validates active People records when available',async()=>{
  const calls=[];
  const client={async query(sql,params=[]){
    calls.push({sql,params});
    if(sql.includes('FROM people WHERE id=$1'))return {rows:[{id:7,archived_at:null}]};
    if(sql.includes('FROM staff_users WHERE person_id=$1'))return {rows:[]};
    if(sql.startsWith('INSERT INTO staff_users'))return {rows:[{id:13,person_id:7}]};
    return {rows:[]};
  }};
  const result=await insertStaffAccountRow(client,{hasPersonLink:true,username:'linked.staff',display:'Linked Staff',roleId:'staff',hash:'hash',personId:7});
  assert.equal(result.person_id,7);
  assert.match(calls.at(-1).sql,/person_id/);
});
