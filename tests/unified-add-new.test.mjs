import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const view=readFileSync(new URL('../public/admin/js/views/lifegroups.js',import.meta.url),'utf8');
const modal=readFileSync(new URL('../public/admin/js/views/unifiedAddNew.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin/styles.css',import.meta.url),'utf8');

test('one Add New action replaces New Network and Add Cell Leader',()=>{
 const section=view.slice(view.indexOf('export async function renderLifegroups('),view.indexOf('const genderButtons=',view.indexOf('export async function renderLifegroups(')));
 assert.match(section,/id="addNew"/);
 assert.doesNotMatch(section,/id="newNetwork"/);
 assert.doesNotMatch(section,/id="newGroup"/);
 assert.match(section,/createAddNewModal\(\{onSaved/);
});

test('one tabbed modal exposes Network Leader, Cell Leader and Members',()=>{
 assert.match(modal,/role="tablist"/);
 for(const mode of ['network','cell','member']) {
   assert.ok(modal.includes("const modes=['network','cell','member']"));
   assert.ok(modal.includes("data-form="));
 }
 assert.match(modal,/ArrowRight/);
 assert.match(modal,/ArrowLeft/);
});

test('profile picture upload and preview are present in every role tab',()=>{
 assert.match(modal,/data-photo/);
 assert.match(modal,/data-photo-preview/);
 assert.match(modal,/image\/jpeg,image\/png,image\/webp/);
 assert.match(modal,/fileToDataUrl\(file,320\)/);
 assert.match(css,/unified-add__photo-preview img/);
});

test('existing Networks and their Cell Leaders are selectable',()=>{
 assert.match(modal,/api\.networks\(\{status:'active'\}\)/);
 assert.match(modal,/api\.lifegroups\(\{network_id:netId,status:'active'\}\)/);
 assert.match(modal,/data-field=network/);
 assert.match(modal,/data-field=cell/);
 assert.match(modal,/g\.leader_person_id&&!g\.leads_network/);
});

test('Cell Leaders and Members are directly added as People records, never user accounts',()=>{
 assert.match(modal,/api\.createPerson\(person\)/);
 assert.match(modal,/api\.createNetworkStructure\(/);
 assert.match(modal,/api\.createLifegroup\(/);
 assert.match(modal,/api\.assignLifegroup\(/);
 assert.doesNotMatch(modal,/api\.createUser\(/);
 assert.match(modal,/registration_source:'staff'/);
});

test('duplicates, role assignments and interrupted saves are handled',()=>{
 assert.match(modal,/duplicateGuard\(person/);
 assert.match(modal,/state\.pending\[mode\]/);
 assert.match(modal,/state\.pending\[mode\]\.group=result/);
 assert.match(modal,/state\.pending\[mode\]\.network=result/);
 assert.match(modal,/api\.ensureNetworkLeaderGroup\(network\.id\)/);
 assert.match(modal,/role:'leader'/);
 assert.match(modal,/role:'member'/);
});

test('social fields and consent are preserved and UI is responsive',()=>{
 for(const k of ['facebook_url','instagram_url','tiktok_url','x_url','youtube_url'])assert.ok(modal.includes(k));
 assert.match(modal,/privacy_consent:true/);
 assert.match(modal,/data-consent/);
 assert.match(css,/@media\(max-width:580px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

