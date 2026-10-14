import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../public/lifegen/index.html');
const css=read('../public/lifegen/styles.css');
const player=read('../public/lifegen/videos.js');
const versions=JSON.parse(read('../asset-versions.json'));

test('Janime has an unboxed video while only the descriptive text uses a card',()=>{
 const match=page.match(/<div class="story-grid">\s*<article class="vcard reveal"([^>]*)>(.*?)<\/article>/s);
 assert.ok(match);
 assert.match(match[1],/data-unboxed-video="true"/);
 assert.match(match[2],/class="vmeta vmeta--text-card"/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\],[\s\S]*?border:0/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vmeta--text-card \{[\s\S]*?border:1px solid var\(--line\)/);
 assert.equal((page.match(/data-unboxed-video="true"/g)||[]).length,1);
 assert.match(page,/Testimony coming soon/);
});

test('first-party video uses 16:9 without iframe offset or frame cropping',()=>{
 assert.match(page,/data-video="\/brand\/videos\/janime-rivera-testimony-720p\.mp4" data-ratio="16\/9"/);
 assert.doesNotMatch(page,/data-trim-bottom|data-drive-fit/);
 assert.doesNotMatch(player,/vframe--playing-trimmed/);
 assert.doesNotMatch(css,/vframe--playing-trimmed/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vframe \{[\s\S]*?aspect-ratio:16 \/ 9/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vframe--native video \{[\s\S]*?object-fit: contain/);
 assert.ok(player.includes('embed.type === "video"'));
});

test('original Google Vids link remains available and native CSS is cache-busted',()=>{
 assert.match(page,/Open original in Google Vids/);
 assert.match(page,/\/lifegen\/styles\.css\?v=2\.4\.18/);
 assert.equal(versions['/lifegen/styles.css'].version,'2.4.18');
});
