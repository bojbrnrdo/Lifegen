import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/lifeide.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/lifeide/app.js',import.meta.url),'utf8');
test('repository routes are disabled except on opted-in local development',()=>{
 assert.match(server,/LIFEIDE_LOCAL_EDIT==='true'/);
 assert.match(server,/NODE_ENV!=='production'/);
 assert.match(server,/!process\.env\.VERCEL/);
 assert.match(server,/router\.use\(access,authenticate,checkRole,requestLimit\)/);
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

test('commit button is disabled while a commit request is pending',()=>{
 assert.match(client,/commitBusy=true;\$\('commit'\)\.disabled=true/);
 assert.match(client,/finally\{commitBusy=false/);
});

test('repository save captures path and content before awaiting and preserves new edits',()=>{
 assert.match(client,/const path=current,f=repoFiles\.get\(path\)/);
 assert.match(client,/if\(current===path&&\$\('editor'\)\.value===content\)/);
 assert.match(client,/finally\{saveBusy=false;\}/);
});

test('repository navigation blocks file and workspace switches while a save is in flight',()=>{
 assert.match(client,/async function openRepoFile\(rel\)\{\s*if\(saveBusy\|\|commitBusy\)/);
 assert.match(client,/async function repositoryConnect\(\)\{\s*if\(saveBusy\|\|commitBusy\)/);
});

test('repository refresh and entry creation refuse pending saves',()=>{
 assert.match(client,/if\(repoMode\)\{if\(saveBusy\|\|commitBusy\)/);
 assert.match(client,/async function createRepoEntry\(type,name\)\{\s*if\(saveBusy\|\|commitBusy\)/);
});

test('Git commit waits for an active repository save',()=>{
 assert.match(client,/if\(saveBusy\)\{\$\('status'\)\.textContent='Wait for the current save to finish before committing\.'/);
});

test('Git review cannot replace the editor during an active save or commit',()=>{
 assert.match(client,/if\(saveBusy\|\|commitBusy\)\{\$\('status'\)\.textContent='Finish the pending save or commit before reviewing Git changes\.'/);
});

test('file tabs use sibling buttons for open and close controls',()=>{
 assert.match(client,/const tab=document.createElement\('div'\)/);
 assert.match(client,/const open=document.createElement\('button'\)/);
 assert.match(client,/tab.append\(open,close\)/);
});

test('repository operations are rate-limited and avoid following file symlinks',()=>{
 assert.match(server,/expressRateLimit\(/);
 assert.match(server,/O_NOFOLLOW/);
 assert.match(server,/handle\.stat\(\)/);
});
