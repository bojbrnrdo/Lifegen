import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {mp4Info, formatDuration} from '../scripts/add-video.mjs';

// Where the "extra" black framing and the second play button came from:
// the Grand Campus Hangout highlight plays through *Google Drive's* preview
// player, which draws its own black surround and its own play button inside
// whatever frame it is given — that cannot be styled away from this page.
// The site therefore plays the church's own copy of the video in the same
// first-party player the testimony videos use, and only falls back to the
// provider when that file is not deployed yet. These checks keep both halves
// of that behaviour: first-party first, provider as the fallback.
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../public/lifegen/index.html');
const css=read('../public/lifegen/styles.css');
const player=read('../public/lifegen/videos.js');
const versions=JSON.parse(read('../asset-versions.json'));
const atLeast=(v,min)=>{const a=v.split('.').map(Number),b=min.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return true;};
const highlight=()=>page.match(/<article class="vcard reveal vcard-feature"([^>]*)>(.*?)<\/article>/s)[2];
// Body of one player function, so the assertions stay about that path only.
const fn=name=>player.match(new RegExp(`function ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n        \\}`))?.[2]||'';

test('the highlight declares the church-owned file that plays first-party',()=>{
 const card=highlight();
 assert.match(card,/data-native-src="\/brand\/videos\/grand-campus-hangout\.mp4"/,
  'the highlight must name the site-owned copy of the video');
 // The provider link stays as the fallback while that file is missing.
 assert.match(card,/data-video="https:\/\/drive\.google\.com\/file\/d\/1rZt48LpaSTRQM3dvfbxkb-ta7cwtSAUb\/view"/);
 assert.match(card,/href="https:\/\/drive\.google\.com\/file\/d\/1rZt48LpaSTRQM3dvfbxkb-ta7cwtSAUb\/view"/);
 // No provider chrome is requested until a visitor actually taps the cover.
 assert.match(card,/data-poster="\/brand\/gallery\/drive\/grand-campus-hangout-cover\.webp"/);
 assert.doesNotMatch(page,/<iframe/);
 // The card names the provider while the fallback is what plays, and the
 // first-party path rewrites that note (the testimony's own note is untouched).
 assert.match(card,/<span data-play-note="Plays on LIFEGEN\.">Plays on Google Drive\.<\/span>/);
});

test('a slot with a site-owned file is probed once and played in the first-party player',()=>{
 assert.match(player,/dataset\.nativeSrc/,'videos.js reads the site-owned file from the slot');
 const probe=fn('nativeAvailable');
 assert.match(probe,/fetch\(src, \{ method: "HEAD", cache: "no-store" \}\)/,'cheap same-origin HEAD probe, no provider request');
 assert.match(probe,/\.catch\(\(\) => false\)/,'a failed probe is an answer, not an error');
 assert.match(probe,/nativeProbe\.set\(frame, probe\)/,'one probe per slot, not one per click');
 const start=fn('start');
 assert.match(start,/ok \? playNative\(own, provider\) : provider\(\)/,'own file when it exists, provider only when it does not');
 const native=fn('playNative');
 assert.match(native,/document\.createElement\("video"\)/);
 assert.match(native,/controls: true/);
 assert.match(native,/playsInline: true/);
 assert.match(native,/frame\.replaceChildren\(v\)/);
 assert.match(native,/note\.textContent = note\.dataset\.playNote/,'the "Plays on…" note follows the player that actually runs');
 assert.doesNotMatch(native,/vplay-btn/,'the real player replaces the cover and its decorative button entirely');
 assert.doesNotMatch(native,/iframe/,'no provider player on the first-party path');
});

test('the provider fallback keeps working exactly as before',()=>{
 const provider=fn('provider');
 assert.match(provider,/embed\.type === "video"/,'direct files still mount natively');
 assert.match(provider,/play\(\)/,'third-party providers still mount their own player');
 const play=fn('play');
 assert.match(play,/https:\/\/drive\.google\.com\/file\/\$\{id\}\/preview|embed\.src/);
 assert.match(play,/vframe-gdrive/,'Drive keeps the site\'s standard presentation');
 assert.match(play,/driveFit !== "natural"/);
});

test('the first-party player uses the same framing rules as the testimonies',()=>{
 // .vframe--native is what the testimony video mounts into; the highlight card
 // carries the same data-unboxed-video attribute, so it inherits the identical
 // object-fit/transparent-background treatment for its own file.
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vframe--native video \{[\s\S]*?object-fit: contain/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vframe--native video \{[\s\S]*?background: transparent/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vframe \{[\s\S]*?aspect-ratio:16 \/ 9/);
 const playerVersion=page.match(/\/lifegen\/videos\.js\?v=(\d+\.\d+\.\d+)/)?.[1];
 assert.ok(playerVersion&&atLeast(playerVersion,'2.4.8'),`videos.js?v=${playerVersion} must be >= 2.4.8`);
 assert.equal(versions['/lifegen/videos.js'].version,playerVersion,'run: npm run assets:version');
});

test('the hangout video that ships is the one the page describes',()=>{
 const file=new URL('../public/brand/videos/grand-campus-hangout.mp4',import.meta.url);
 assert.ok(existsSync(file),'the site-owned hangout video must be committed, not just declared');
 const size=statSync(file).size;
 assert.ok(size>5_000_000,'not a truncated file');
 assert.ok(size<90_000_000,`GitHub rejects nothing here yet, but keep it deployable (${(size/1048576).toFixed(1)} MB)`);
 const {duration,width,height}=mp4Info(readFileSync(file));
 // The caption is the promise to the visitor; the file has to keep it.
 const label=formatDuration(duration);
 assert.equal(label,'2 min 13 sec','the caption says 2 min 13 sec');
 assert.ok(highlight().includes(label),'the highlight caption carries that running time');
 assert.ok(width>=1280&&height>=720,'at least as sharp as the 960 px frame it plays in');
 // Browsers only play what they can decode: H.264/AVC video, AAC audio.
 const buf=readFileSync(file);
 assert.equal(buf.toString('ascii',4,8),'ftyp','a real MP4');
 assert.ok(buf.includes(Buffer.from('avc1')),'H.264 video track — universally decodable');
 assert.ok(buf.includes(Buffer.from('mp4a')),'AAC audio track');
 assert.ok(buf.includes(Buffer.from('avcC')),'an AVC configuration record, so the profile is explicit');
});
