import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/lifeide.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/lifeide/app.js',import.meta.url),'utf8');
test('repository routes are disabled except on opted-in local development',()=>{
 assert.match(server,/LIFEIDE_LOCAL_EDIT==='true'/);
 assert.match(server,/NODE_ENV!=='production'/);
 assert.match(server,/!process\.env\.VERCEL/);
 assert.match(server,/router\.use\(access,authenticate,checkRole\)/);
});
test('writes require origin, csrf, and optimistic file version checks',()=>{
 assert.match(server,/origin\(req\);csrf\(req\)/);
 assert.match(server,/hash!==version/);
 assert.match(server,/status\(409\)|httpError\(409/);
});
test('paths restrict traversal, hidden entries and symbolic links',()=>{
 assert.match(server,/x==='\.\.'/);
 assert.match(server,/x\.startsWith\('\.'\)/);
 assert.match(server,/stat\.isSymbolicLink\(\)/);
 assert.match(server,/!e\.isSymbolicLink\(\)/);
});
test('repository editing preserves manual save and browser-local mode',()=>{
 assert.match(client,/repoMode/);
 assert.match(client,/method:'PUT'/);
 assert.match(client,/localStorage\.setItem/);
});
test('Git review remains read only and disabled commit control remains on screen',()=>{
 assert.match(server,/router\.get\('\/git\/status'/);
 assert.match(server,/router\.get\('\/git\/diff'/);
 const html=readFileSync(new URL('../public/lifeide/index.html',import.meta.url),'utf8');
 assert.match(html,/id="commit"[^>]*disabled/);
});

test('opening a repository file clears stale Git commit selections',()=>{
 assert.match(client,/selectedGit\.clear\(\);\$\('commit'\)\.disabled=true;\s*repoFiles\.set\(rel,file\)/);
});

test('Git commit requires no unsaved repository edits',()=>{
 assert.match(client,/if\(repoDirty\)\{\$\('status'\)\.textContent='Save or discard unsaved changes before committing\.'/);
});
