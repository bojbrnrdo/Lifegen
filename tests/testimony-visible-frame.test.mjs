import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../public/lifegen/index.html');
const css=read('../public/lifegen/styles.css');
const player=read('../public/lifegen/videos.js');
const versions=JSON.parse(read('../asset-versions.json'));
// styles.css must be AT LEAST the version that shipped the native-video CSS
// (2.4.18). Later public-CSS changes legitimately bump it further, so an exact
// pin would force a stale-cache version to be reused.
const atLeast=(v,min)=>{const a=v.split('.').map(Number),b=min.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return true;};

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
 const pageVersion=page.match(/\/lifegen\/styles\.css\?v=(\d+\.\d+\.\d+)/)?.[1];
 assert.ok(pageVersion&&atLeast(pageVersion,'2.4.18'),`styles.css?v=${pageVersion} must be >= 2.4.18`);
 assert.equal(versions['/lifegen/styles.css'].version,pageVersion);
});
