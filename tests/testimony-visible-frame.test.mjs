import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../public/lifegen/index.html');
const css=read('../public/lifegen/styles.css');
const player=read('../public/lifegen/videos.js');
const versions=JSON.parse(read('../asset-versions.json'));

test('only Janime testimonial shortens its visible frame during playback',()=>{
 const match=page.match(/<div class="story-grid">\s*<article class="vcard reveal"[^>]*>(.*?)<\/article>/s);
 assert.ok(match);
 assert.match(match[1],/data-label="Janime Rivera"/);
 assert.match(match[1],/data-ratio="16\/9"/);
 assert.match(match[1],/data-trim-bottom="true"/);
 assert.match(match[1],/data-drive-fit="natural"/);
 assert.match(page,/Testimony coming soon/);
 assert.equal((page.match(/data-trim-bottom="true"/g)||[]).length,1);
 assert.match(player,/frame\.dataset\.trimBottom === "true" && embed\.provider === "Google Drive"/);
 assert.match(player,/frame\.classList\.add\("vframe--playing-trimmed"\)/);
});

test('poster keeps 16:9 ratio while played iframe stays full size inside a shorter frame',()=>{
 assert.match(player,/if \(frame\.dataset\.poster\)/);
 assert.match(player,/btn\.addEventListener\("click", play\)/);
 assert.match(css,/#stories \.vframe\[data-trim-bottom="true"\]\.vframe--playing-trimmed \{\s*aspect-ratio: 2\.05 \/ 1/s);
 assert.match(css,/#stories \.vframe\[data-trim-bottom="true"\]\.vframe--playing-trimmed iframe \{[\s\S]*?height: 115\.3125%/);
 assert.match(css,/\.vframe\{position:relative;aspect-ratio:var\(--ratio,16 \/ 9\)/);
});

test('Google Drive fallback remains and CSS JS assets are cache-busted',()=>{
 assert.match(page,/Open video in a new tab/);
 assert.match(page,/\/lifegen\/styles\.css\?v=2\.4\.15/);
 assert.match(page,/\/lifegen\/videos\.js\?v=2\.4\.6/);
 assert.equal(versions['/lifegen/styles.css'].version,'2.4.15');
 assert.equal(versions['/lifegen/videos.js'].version,'2.4.6');
});
