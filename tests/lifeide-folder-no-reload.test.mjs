import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/lifeide/app.js',import.meta.url),'utf8');

test('browser-local folder click only toggles tree rows',()=>{
 const start=source.indexOf('function renderTree()');
 const end=source.indexOf('// Standard Explorer arrow keys',start);
 assert.ok(start>=0&&end>start);
 const tree=source.slice(start,end);
 assert.match(tree,/button\.type='button'/);
 assert.match(tree,/if\(f\.type==='folder'\)\{selectedFolder=f\.id;expanded\.has\(f\.id\)\?expanded\.delete\(f\.id\):expanded\.add\(f\.id\);renderTree\(\)/);
 assert.doesNotMatch(tree,/location\.(?:reload|assign|replace|href)|window\.location|history\.go\(/);
});

test('repository folder click uses in-page expanded state without reload',()=>{
 const start=source.indexOf('async function treeFolder()');
 const end=source.indexOf('async function createRepoEntry(',start);
 assert.ok(start>=0&&end>start);
 const tree=source.slice(start,end);
 assert.match(tree,/el\.type='button'/);
 assert.match(tree,/el\.addEventListener\('click',toggle\)/);
 assert.match(tree,/children\.hidden=false/);
 assert.match(tree,/repoExpanded\.add\(rel\)/);
 assert.doesNotMatch(tree,/location\.(?:reload|assign|replace|href)|window\.location|history\.go\(/);
});
