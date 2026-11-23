import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildLifegroupTree} from '../public/admin/js/views/hierarchy.js';
const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');

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
