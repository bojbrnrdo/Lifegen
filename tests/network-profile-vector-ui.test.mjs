import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safeSocialLink,nodePhoto,buildLifegroupTree} from '../public/admin/js/views/hierarchy.js';
const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('social profiles allow HTTPS on a matching provider host only',()=>{
 assert.equal(safeSocialLink('https://www.instagram.com/test/', ['instagram.com']),'https://www.instagram.com/test/');
 assert.equal(safeSocialLink('https://x.com/test', ['x.com']),'https://x.com/test');
 assert.equal(safeSocialLink('javascript:alert(1)', ['instagram.com']),null);
 assert.equal(safeSocialLink('https://instagram.com.evil.example/test',['instagram.com']),null);
 assert.equal(safeSocialLink('http://www.instagram.com/test', ['instagram.com']),null);
 assert.equal(safeSocialLink('https://user:pass@instagram.com/test', ['instagram.com']),null);
});

test('only JPEG, PNG and WebP data-photo URLs render; vector fallback for other values',()=>{
 const photo='data:image/png;base64,aGVsbG8=';
 assert.equal(nodePhoto({kind:'member',record:{photo}}),photo);
 assert.equal(nodePhoto({kind:'group',record:{leader_photo:photo}}),photo);
 assert.equal(nodePhoto({kind:'network',record:{leader_photo:'javascript:alert(1)'}}),null);
 assert.equal(nodePhoto({kind:'member',record:{photo:'data:image/svg+xml;base64,AAAA'}}),null);
});

test('network leader, cell leader and member inherit their own photo metadata',()=>{
 const photo='data:image/png;base64,aGVsbG8=';
 const networks=[{id:1,leader_name:'Network',leader_photo:photo,gender:'boys',is_active:true}];
 const groups=[{id:2,network_id:1,leader_name:'Cell',leader_photo:photo,member_count:1,is_active:true}];
 const expanded=new Set(['network:1','group:2']);
 const members=new Map([['group:2',[{id:3,first_name:'A',last_name:'Person',photo}]]]);
 const nodes=buildLifegroupTree(networks,groups,{},expanded,members,new Set());
 assert.equal(nodePhoto(nodes[0]),photo);
 assert.equal(nodePhoto(nodes[0].children[0]),photo);
 assert.equal(nodePhoto(nodes[0].children[0].children[0]),photo);
});

test('Network registration reveals sections progressively and uses vector step icons',()=>{
 const code=file('../public/admin/js/views/networkFourField.js');
 assert.match(code,/network-four__steps/);
 assert.match(code,/const max=state\.leader&&state\.gender/);
 assert.match(code,/showStep\(2\)/);
 assert.match(code,/showStep\(3\)/);
 assert.match(code,/icon\('user',17\)/);
 assert.match(code,/icon\('group',17\)/);
 assert.match(code,/icon\('people',17\)/);
});

test('person form edits social links and existing circular profile photo',()=>{
 const form=file('../public/admin/js/views/personForm.js');
 for(const name of ['facebook_url','instagram_url','tiktok_url','x_url','youtube_url'])assert.ok(form.includes(name));
 assert.match(form,/id="photoPreview"/);
 assert.match(form,/fileToDataUrl/);
});

test('social data is redacted from viewer response',()=>{
 const code=file('../src/auth.js');
 for(const key of ['facebook_url','instagram_url','tiktok_url','x_url','youtube_url','leader_photo'])assert.ok(code.includes("'"+key+"'"));
});
