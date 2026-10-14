import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nodePhoto} from '../public/admin/js/views/hierarchy.js';

const source=readFileSync(new URL('../public/admin/js/views/hierarchy.js',import.meta.url),'utf8');

test('the photo is loaded from each role-specific Person record',()=>{
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
 assert.equal(nodePhoto({kind:'network',record:{leader_photo:photo}}),photo);
 assert.equal(nodePhoto({kind:'group',record:{leader_photo:photo}}),photo);
 assert.equal(nodePhoto({kind:'member',record:{photo}}),photo);
});

test('circle borders cannot cover uploaded profile images',()=>{
 assert.doesNotMatch(source, /circle:not\(\.touch-hit\)/);
 assert.doesNotMatch(source, /\.lfg__node circle\{/);
 assert.doesNotMatch(source, /circle\{stroke:#d2a95e;fill:#fff6e5\}/);
 assert.doesNotMatch(source, /circle\{stroke:#609784;fill:#eef7f2\}/);
 assert.ok(source.includes("aria-expanded=") && source.includes(".lfg__avatar-background{fill:#dbf1e2}"));
 assert.match(source,/\.lfg__node \.lfg__avatar-ring\{fill:none/);
 assert.match(source, /profileAvatar\(n\)/);
});

test('photo ring styling is scoped to the outline; background colors stay separate',()=>{
 assert.match(source,/data-kind=.*member.*avatar-background\{fill:#fff6e5/);
 assert.match(source,/data-kind=.*group.*avatar-background\{fill:#eef7f2/);
 assert.match(source,/\.lfg__node:hover \.lfg__avatar-ring/);
 assert.match(source,/\.lfg__node:focus-visible \.lfg__avatar-ring/);
});

