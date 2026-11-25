import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const dev=readFileSync(new URL('../public/admin/js/views/devWorkspace.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin/styles.css',import.meta.url),'utf8');
test('Git and Packaging provide persistent connected developer navigation',()=>{
 assert.match(dev,/const devTabs=/);
 assert.match(dev,/devTabs\('git',safeBranch\(query\.branch\)\)/);
 assert.match(dev,/devTabs\('packaging',safeBranch\(query\.branch\)\)/);
 assert.match(dev,/id="gitPackageBranch"/);
 assert.match(dev,/id="packageReviewGit"/);
 assert.match(dev,/el\('gitPackageBranch'\)\.href=devLink\('packaging',value\)/);
 assert.match(dev,/el\('packageReviewGit'\)\.href=devLink\('git',safeBranch\(branchInput\.value\.trim\(\)\)\)/);
});
test('Navigation validates branch names and encodes them, never treating names as URLs',()=>{
 assert.match(dev,/const safeBranch=name=>/);
 assert.match(dev,/encodeURIComponent\(branch\)/);
 assert.match(dev,/esc\(safeBranch\(branch\)\)/);
 assert.match(dev,/result\.branches\.some\(b=>b\.name===safeBranch\(query\.branch\)\)/);
});
test('Live read-only Git can still open the actual LifeIDE editor',()=>{
 assert.match(dev,/id="gitPush" \$\{connected\?'':'disabled'\}>Open LifeIDE/);
 assert.match(dev,/el\('gitPush'\)\.onclick=\(\)=>\{if\(!connected\)return;/);
 assert.match(dev,/window\.location\.hash='#\/dev\/ide'/);
 assert.match(dev,/Production always blocks Git writes/);
});
test('Dev tabs use accessible labels and visibly indicate current page',()=>{
 assert.match(dev,/aria-label="Developer workspace sections"/);
 assert.match(dev,/aria-current="page"/);
 assert.match(css,/\.dev-tabs__link\.is-active/);
 assert.match(css,/\.dev-tabs__link:focus-visible/);
});

const app=readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
test('Git responses are ignored after navigating to LifeIDE or Packaging',()=>{
 assert.match(dev,/const visit=Symbol\('dev-git'\);main\.__devGitVisit=visit;/);
 assert.match(dev,/const gitRoute=\(\)=>main\.__devGitVisit===visit/);
 assert.match(dev,/const active=\(\)=>gitRoute\(\)/);
 assert.match(dev,/const result=await api\('branches'\);if\(!active\(\)\)return;/);
 assert.match(dev,/if\(!active\(\)\|\|seq!==revision\|\|request!==historyRequest\)return false;/);
 assert.match(dev,/if\(!active\(\)\|\|seq!==revision\|\|request!==statusRequest\)return false;/);
});
test('Stale Admin route completions cannot replace newer views',()=>{
 assert.match(app,/let routeSequence = 0;/);
 assert.match(app,/const routeTicket = \+\+routeSequence;/);
 assert.match(app,/if \(routeTicket !== routeSequence\) return;/);
});
