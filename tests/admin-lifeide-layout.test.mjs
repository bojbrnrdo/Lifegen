import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const view=await readFile(new URL('../public/admin/js/views/devWorkspace.js',import.meta.url),'utf8');
const routes=await readFile(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/admin/styles.css',import.meta.url),'utf8');
const standalone=await readFile(new URL('../public/lifeide/index.html',import.meta.url),'utf8');

test('Admin LifeIDE route embeds the full Explorer and editor workspace',()=>{
 assert.match(routes,/path:\s*\/\^\\\/dev\\\/ide\$\/.*view:\s*renderDevIDE/);
 assert.match(view,/export async function renderDevIDE\(/);
 assert.match(view,/iframe class="admin-lifeide__frame"[^>]+src="\/lifeide\/"/);
 assert.match(standalone,/id="tree"/);
 assert.match(standalone,/id="editor"/);
 assert.match(css,/\.admin-lifeide__frame\s*\{/);
});

test('Admin LifeIDE keeps the existing GitHub editor available separately',()=>{
 assert.match(view,/id="ideLegacyEditor"/);
 assert.match(view,/async function renderDevIDEGitHub\(/);
 assert.match(view,/legacyCleanup\?\.\(\)/);
 assert.match(view,/GitHub integration is not yet configured on the server/);
});
