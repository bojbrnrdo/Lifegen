import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../public/lifegen/index.html');
const css=read('../public/lifegen/styles.css');
const player=read('../public/lifegen/videos.js');
const versions=JSON.parse(read('../asset-versions.json'));

test('Janime media has no visual card; text underneath has the only card styling',()=>{
 const match=page.match(/<div class="story-grid">\s*<article class="vcard reveal"([^>]*)>(.*?)<\/article>/s);
 assert.ok(match);
 assert.match(match[1],/data-unboxed-video="true"/);
 assert.match(match[2],/data-label="Janime Rivera"/);
 assert.match(match[2],/class="vmeta vmeta--text-card"/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\],[\s\S]*?border:0/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vmeta--text-card \{[\s\S]*?border:1px solid var\(--line\)/);
 assert.equal((page.match(/data-unboxed-video="true"/g)||[]).length,1);
 assert.equal((page.match(/class="vmeta vmeta--text-card"/g)||[]).length,1);
 assert.match(page,/Testimony coming soon/);
});

test('video displays naturally at 16:9 with no forced frame crop',()=>{
 assert.match(page,/data-ratio="16\/9" data-drive-fit="natural" data-label="Janime Rivera"/);
 assert.doesNotMatch(page,/data-trim-bottom/);
 assert.doesNotMatch(player,/vframe--playing-trimmed/);
 assert.doesNotMatch(css,/vframe--playing-trimmed/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vframe \{[\s\S]*?aspect-ratio:16 \/ 9/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vframe iframe,[\s\S]*?background:transparent/);
 assert.match(player,/btn\.addEventListener\("click", play\)/);
});

test('Google Drive fallback remains, and CSS + JS assets are cache-busted',()=>{
 assert.match(page,/Open video in a new tab/);
 assert.match(page,/\/lifegen\/styles\.css\?v=2\.4\.17/);
 assert.match(page,/\/lifegen\/videos\.js\?v=2\.4\.7/);
 assert.equal(versions['/lifegen/styles.css'].version,'2.4.17');
 assert.equal(versions['/lifegen/videos.js'].version,'2.4.7');
});
