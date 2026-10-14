import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, statSync, openSync, readSync, closeSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../public/lifegen/index.html');
const player=read('../public/lifegen/videos.js');
const assetVersion=JSON.parse(read('../asset-versions.json'));
const media=new URL('../public/brand/videos/janime-rivera-testimony-720p.mp4',import.meta.url);

test('Janime uses a first-party MP4, with no Google iframe or crop',()=>{
 const card=page.match(/<div class="story-grid">\s*<article class="vcard reveal"[^>]*>(.*?)<\/article>/s)?.[1];
 assert.ok(card,'Janime remains in testimonies');
 assert.match(card,/class="vframe vframe--native"/);
 assert.match(card,/data-video="\/brand\/videos\/janime-rivera-testimony-720p\.mp4"/);
 assert.match(card,/data-ratio="16\/9"/);
 assert.match(card,/data-label="Janime Rivera"/);
 assert.match(card,/data-poster="\/brand\/gallery\/drive\/janime-rivera-testimony-cover\.webp"/);
 assert.doesNotMatch(card,/data-drive-fit|data-trim-bottom/);
 assert.match(page,/data-label="Grand Campus Hangout"/);
 assert.match(page,/data-label="Testimony coming soon"/);
});

test('optimized MP4 is present, deployable, and has the correct file signature',()=>{
 const file=statSync(media);
 assert.ok(file.size>5_000_000,'not a truncated file');
 assert.ok(file.size<90_000_000,'below GitHub file size limit');
 const fd=openSync(media,'r'),buf=Buffer.alloc(12);
 try{assert.equal(readSync(fd,buf,0,12,0),12);}finally{closeSync(fd);}
 assert.equal(buf.toString('ascii',4,8),'ftyp');
});

test('native HTML5 playback uses built-in controls and preserves original fallback link',()=>{
 assert.ok(player.includes('if (embed.type === "video")'));
 assert.ok(player.includes('document.createElement("video")'));
 assert.ok(player.includes('controls: true'));
 assert.ok(player.includes('playsInline: true'));
 assert.ok(player.includes('frame.replaceChildren(v)'));
 assert.match(page,/7 min 19 sec · Plays on LIFEGEN/);
 assert.match(page,/Open original in Google Vids/);
 assert.doesNotMatch(page,/<iframe/);
});

test('CSS cache version is updated for native video player',()=>{
 assert.match(page,/\/lifegen\/styles\.css\?v=2\.4\.18/);
 assert.equal(assetVersion['/lifegen/styles.css'].version,'2.4.18');
});
