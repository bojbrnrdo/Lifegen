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
 for(const id of ['gitPull','gitPush','gitCreateBranch','gitBranchSelect','gitCreatePr','gitCheck','gitStatus','gitHistory','gitPrPanel'])
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
