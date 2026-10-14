import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The Grand Campus Hangout highlight used to sit inside the same bordered
// .vcard-feature box (border + card background + rounded corners + shadow)
// that wrapped its description text, so the video looked framed rather than
// filling the frame the site gives its videos. The testimony block above it
// is already unboxed. These checks keep the highlight on that same framing:
// no container around the video, the description alone in a card.
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../public/lifegen/index.html');
const css=read('../public/lifegen/styles.css');
const player=read('../public/lifegen/videos.js');
const versions=JSON.parse(read('../asset-versions.json'));
// styles.css must be AT LEAST the version that shipped the unboxed highlight
// CSS (2.4.20). Later public-CSS changes legitimately bump it further, so an
// exact pin would force a stale-cache version to be reused.
const atLeast=(v,min)=>{const a=v.split('.').map(Number),b=min.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return true;};
const highlight=()=>page.match(/<article class="vcard reveal vcard-feature"([^>]*)>(.*?)<\/article>/s);
const url='https://drive.google.com/file/d/1rZt48LpaSTRQM3dvfbxkb-ta7cwtSAUb/view';

test('the highlight video is unboxed and only its description is carded',()=>{
 const match=highlight();
 assert.ok(match,'Grand Campus Hangout stays in the widescreen highlight slot');
 assert.match(match[1],/data-unboxed-video="true"/,'highlight must reuse the unboxed framing');
 assert.match(match[2],/class="vframe" data-video="/,'the frame keeps its click-to-load Drive embed');
 assert.match(match[2],/class="vmeta vmeta--text-card"/,'description moves into its own text card');
 assert.ok(!/class="vmeta">/.test(match[2]),'no bare carded vmeta left in the highlight');
 assert.match(match[2],/<h4>Grand Campus Hangout<\/h4>/);
 assert.ok(match[2].includes(`href="${url}"`),'direct Drive fallback link remains');
});

test('the frame keeps the 16:9 ratio the site gives its videos',()=>{
 const match=highlight();
 assert.match(match[2],/data-ratio="16\/9"/);
 assert.match(match[2],/data-poster="\/brand\/gallery\/drive\/grand-campus-hangout-cover\.webp"/);
 // The Drive iframe keeps the site's standard presentation (the toolbar crop
 // that makes the provider player fill the frame). No one-off overrides.
 assert.doesNotMatch(page,/data-drive-fit|data-trim-bottom/);
 assert.doesNotMatch(player,/vframe--playing-trimmed/);
 assert.doesNotMatch(css,/vframe--playing-trimmed/);
 assert.doesNotMatch(page,/<iframe/); // No eager third-party player request.
});

test('CSS removes the container around the highlight video',()=>{
 // The shared unboxed rule (id-scoped, so it outranks the class-only
 // .vcard-feature card rules) must strip border, radius, background, shadow.
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\],[\s\S]*?border:0;[\s\S]*?background:transparent;[\s\S]*?box-shadow:none;[\s\S]*?overflow:visible;/);
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vframe \{[\s\S]*?aspect-ratio:16 \/ 9;[\s\S]*?border:0;[\s\S]*?border-radius:0;[\s\S]*?background:transparent;/);
 // The highlight variant keeps its centred widescreen width, and the
 // .vcard-feature side-by-side card geometry must not survive into it.
 assert.match(css,/#stories \.vcard-feature\[data-unboxed-video="true"\] \{[\s\S]*?max-width: 960px;[\s\S]*?margin-inline: auto;/);
 assert.match(css,/#stories \.vcard-feature\[data-unboxed-video="true"\] \.vframe \{[\s\S]*?height: auto;[\s\S]*?border-radius: 0;/);
 assert.match(css,/#stories \.vcard-feature\[data-unboxed-video="true"\] \.vmeta--text-card \{/);
 // Only the text card may still look like a card.
 assert.match(css,/#stories \.vcard\[data-unboxed-video="true"\] \.vmeta--text-card \{[\s\S]*?border:1px solid var\(--line\)/);
});

test('the unboxed highlight CSS is cache-busted',()=>{
 const pageVersion=page.match(/\/lifegen\/styles\.css\?v=(\d+\.\d+\.\d+)/)?.[1];
 assert.ok(pageVersion&&atLeast(pageVersion,'2.4.20'),`styles.css?v=${pageVersion} must be >= 2.4.20`);
 assert.equal(versions['/lifegen/styles.css'].version,pageVersion);
});
