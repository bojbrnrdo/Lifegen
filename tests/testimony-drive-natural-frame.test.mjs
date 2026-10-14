import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');
const markup=source('../public/lifegen/index.html');
const script=source('../public/lifegen/videos.js');
const styles=source('../public/lifegen/styles.css');
const versions=JSON.parse(source('../asset-versions.json'));

test('Janime stays in the testimony grid and opts out of Google Drive toolbar cropping',()=>{
 const card=markup.match(/<div class="story-grid">\s*<article class="vcard reveal"[^>]*>(.*?)<\/article>/s)?.[1];
 assert.ok(card,'The two-column testimonial layout is retained');
 assert.match(markup,/data-unboxed-video="true"/);
 assert.match(card,/data-drive-fit="natural"/);
 assert.match(card,/data-ratio="16\/9"/);
 assert.match(card,/data-label="Janime Rivera"/);
 assert.match(card,/data-poster="\/brand\/gallery\/drive\/janime-rivera-testimony-cover\.webp"/);
 assert.doesNotMatch(card,/data-fullscreen=/);
});

test('Google Drive iframe uses full natural geometry for selected video only',()=>{
 assert.match(script,/embed\.provider === "Google Drive" && frame\.dataset\.driveFit !== "natural"/);
 assert.match(script,/frame\.classList\.add\("vframe-gdrive"\)/);
 assert.match(styles,/\.vframe iframe,\.vframe video\{position:absolute;inset:0;width:100%;height:100%/);
 assert.match(styles,/\.vframe\.vframe-gdrive iframe\{position:absolute;top:-56px/);
 assert.equal((markup.match(/data-drive-fit="natural"/g)||[]).length,1);
 assert.match(markup,/data-label="Grand Campus Hangout"/);
});

test('embed stays click-to-play with direct Google Drive fallback and asset cache bump',()=>{
 assert.doesNotMatch(markup,/<iframe/);
 assert.match(script,/btn\.addEventListener\("click", play\)/);
 assert.match(script,/document\.createElement\("iframe"\)/);
 assert.match(markup,/7 min 19 sec · Plays on Google Drive/);
 assert.match(markup,/\/lifegen\/videos\.js\?v=2\.4\.7/);
 assert.equal(versions['/lifegen/videos.js'].version,'2.4.7');
});
