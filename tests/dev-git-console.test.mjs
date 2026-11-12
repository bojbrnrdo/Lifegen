import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/dev-workspace.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/admin/js/views/devWorkspace.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../public/admin/styles.css',import.meta.url),'utf8');

test('Git console history, branch list and comparison are admin-only and read-only',()=>{
 for(const path of ['branches','branch-status','history']){
  assert.match(server,new RegExp("app\\.get\\('/api/admin/dev/"+path+"',requireStaff,ensureAdmin"));
 }
 assert.match(server,/app\.get\('\/api\/admin\/dev\/history'[\s\S]*?allowedBranch\(branch\)/);
 assert.match(server,/app\.get\('\/api\/admin\/dev\/branch-status'[\s\S]*?allowedBranch\(branch\)/);
 assert.match(server,/apiRoot\+'\/compare\/'.*develop/);
 assert.match(server,/per_page=25/);
 assert.match(server,/Cache-Control','no-store'/);
});

test('Git controls show remote status, branches, commit history and safe workflow actions',()=>{
 assert.match(client,/Git Version Control/);
 for(const id of ['gitPull','gitOpenBranchFile','gitPush','gitCreateBranch','gitBranchSelect','gitCreatePr','gitCheck','gitStatus','gitHistory','gitPrPanel'])
  assert.ok(client.includes('id="'+id+'"'),id);
 assert.match(client,/api\('branches'\)/);
 assert.match(client,/api\('branch-status\?branch='/);
 assert.match(client,/api\('history\?branch='/);
 assert.match(client,/api\('pull-request',\{method:'POST'/);
 assert.match(client,/if\(!writable\)return/);
 assert.match(client,/revert\.disabled=true/);
 assert.match(client,/Refresh Remote/);
 assert.match(client,/Open IDE to Commit/);
 assert.match(client,/Neither button performs a Git pull or push/);
 assert.match(styles,/\.devgit__history/);
});


test('Refresh Remote distinguishes failed requests from successful refreshes',()=>{
 assert.match(client,/return Promise\.all\(\[check\(\),loadHistory\(\)\]\)/);
 assert.match(client,/results\.every\(Boolean\)/);
 assert.match(client,/Remote refresh incomplete/);
 assert.match(client,/Status unavailable/);
 assert.match(client,/return false/);
});


test('Concurrent same-branch refreshes cannot publish stale status, history or completion messages',()=>{
 assert.match(client,/request=\+\+statusRequest/);
 assert.match(client,/request!==statusRequest/);
 assert.match(client,/request=\+\+historyRequest/);
 assert.match(client,/request!==historyRequest/);
 assert.match(client,/request=\+\+refreshRequest/);
 assert.match(client,/request!==refreshRequest/);
});


test('Git console opens selected branch and file without requiring write permissions',()=>{
 assert.match(client,/id="gitOpenBranchFile"/);
 assert.match(client,/gitOpenBranchFile'\)\.onclick/);
 assert.match(client,/const selected=branch/);
 assert.match(client,/if\(!connected\)return/);
 assert.match(client,/\/dev\/ide\?branch='\+encodeURIComponent\(selected\)\+'&path='\+encodeURIComponent\(file\)/);
 assert.match(client,/if\(query\.path\)return renderDevIDEGitHub\(\{main,query\}\)/);
 assert.match(client,/file\.split\('\/'\)\.some/);
});


test('TransferBuilder-style packaging stages verified changed files and keeps full export',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/lifegen-package.yml',import.meta.url),'utf8');
 assert.match(client,/id="findPackageFiles"/);
 assert.match(client,/id="packageSelectedOnly"/);
 assert.match(client,/\.package-file:checked/);
 assert.match(client,/api\('branch-status\?branch='/);
 assert.match(client,/onlySelected\?\{paths\}:\{\}/);
 assert.match(client,/stagedBranch!==branch/);
 assert.match(server,/Select 1–40 unique, permitted source files/);
 assert.match(server,/path=>!eligible\.has\(path\)/);
 assert.match(server,/item\.status!=='removed'/);
 assert.match(server,/inputs:\{paths:paths\?paths\.join/);
 assert.match(workflow,/PACKAGE_PATHS: \$\{\{ inputs\.paths \}\}/);
 assert.match(workflow,/path not in tracked/);
 assert.match(workflow,/git', 'archive', '--format=zip'/);
 assert.match(workflow,/npm run build/);
 assert.match(workflow,/npm test/);
});

test('Git branch comparison can open changed files but not deleted files',()=>{
 assert.match(client,/const openBranchFile=\(selected,file\)=>/);
 assert.match(client,/if\(file\.status!=='removed'\)/);
 assert.match(client,/open\.onclick=\(\)=>openBranchFile\(which,file\.path\)/);
 assert.match(client,/open\.setAttribute\('aria-label','Open '/);
 assert.match(client,/window\.location\.hash='#\/dev\/ide\?branch='/);
 assert.match(client,/openBranchFile\(selected,file\)/);
});

test('Git file diff is read-only, path restricted, and rendered as text',()=>{
 assert.match(server,/app\.get\('\/api\/admin\/dev\/file-diff',requireStaff,ensureAdmin/);
 assert.match(server,/!allowedBranch\(branch\)\|\|!allowedPath\(file\)/);
 assert.match(server,/item\.filename===file/);
 assert.match(server,/patch\.slice\(0,120000\)/);
 assert.match(server,/Cache-Control','no-store'/);
 assert.match(client,/id="gitDiffPanel"/);
 assert.match(client,/id="gitDiffContent"/);
 assert.match(client,/file-diff\?branch=/);
 assert.match(client,/devgit__view-diff/);
 assert.match(client,/el\('gitDiffContent'\)\.textContent=result\.unavailable/);
 assert.match(client,/request!==diffRequest\|\|seq!==revision/);
 assert.match(client,/diffRequest\+\+/);
 assert.match(styles,/\.devgit__patch/);
});


test('Git commit inspector fetches only recent branch commits and displays safe read-only patches',()=>{
 assert.match(server,/app\.get\('\/api\/admin\/dev\/commit-detail',requireStaff,ensureAdmin/);
 assert.match(server,/!allowedBranch\(branch\)\|\|!\/\^\[a-f0-9\]\{40\}\$\//);
 assert.match(server,/recent\.some\(item=>item\.sha===sha\)/);
 assert.match(server,/filter\(item=>allowedPath\(item\.filename\)\)/);
 assert.match(server,/patch\.slice\(0,Math\.min\(16000,remaining\)\)/);
 assert.match(client,/id="gitCommitDetail"/);
 assert.match(client,/commit-detail\?branch=/);
 assert.match(client,/devgit__inspect-commit/);
 assert.match(client,/inspect\.onclick=\(\)=>inspectCommit\(which,c\.sha\)/);
 assert.match(client,/patch\.textContent=file\.unavailable/);
 assert.match(client,/commitDetailRequest\+\+/);
 assert.match(styles,/\.devgit__commit-file/);
});
