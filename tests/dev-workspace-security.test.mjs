import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedBranch,allowedPath,editableBranch,editablePath} from '../src/dev-workspace.js';

test('only development branches can be browsed',()=>{
 for(const name of ['develop','feature/lifeide','fix/editor-123'])assert.equal(allowedBranch(name),true);
 for(const name of ['main','production','release/v1','feature/../main','feature/foo bar'])assert.equal(allowedBranch(name),false);
});
test('only feature and fix branches can be edited',()=>{
 for(const name of ['feature/lifeide','fix/editor'])assert.equal(editableBranch(name),true);
 for(const name of ['develop','main','feature/../main'])assert.equal(editableBranch(name),false);
});
test('reject sensitive and traversing paths',()=>{
 for(const path of ['../src/app.js','/etc/passwd','src/../../.env','.env','.env.production','src/private.key','secrets/token.json','node_modules/x.js'])assert.equal(allowedPath(path),false,path);
 for(const path of ['src/app.js','public/admin/js/app.js','README.md'])assert.equal(allowedPath(path),true,path);
});
test('protect security and deployment infrastructure from browser edits',()=>{
 for(const path of ['.github/workflows/codeql.yml','src/auth.js','src/db.js','src/deployment.js','src/dev-workspace.js','vercel.json','package.json','package-lock.json'])assert.equal(editablePath(path),false,path);
 assert.equal(editablePath('public/admin/js/views/dashboard.js'),true);
});

test('hide credential stores, SSH keys and database backups from the IDE',()=>{
 for(const path of ['.npmrc','.aws/credentials','.ssh/id_ed25519','config/.netrc','secrets.json','config/credentials.json','data/backup.sqlite','data/backup.db','keys/signing.asc','certs/chain.p8','config/service-account.json']){
  assert.equal(allowedPath(path),false,path);
 }
});
