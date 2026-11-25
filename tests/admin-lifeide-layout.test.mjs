import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const view=await readFile(new URL('../public/admin/js/views/devWorkspace.js',import.meta.url),'utf8');
const routes=await readFile(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/admin/styles.css',import.meta.url),'utf8');
const standalone=await readFile(new URL('../public/lifeide/index.html',import.meta.url),'utf8');

test('Dev tabs and legacy Admin routes are absent from the active Admin UI',()=>{
 assert.doesNotMatch(routes,/from '.\/views\/devWorkspace\.js'/);
 assert.doesNotMatch(routes,/#\/dev\/(?:ide|git|packaging)/);
 assert.doesNotMatch(routes,/view: renderDev(?:IDE|Git|Packaging)/);
 assert.doesNotMatch(routes,/devMenuToggle|devMenu/);
 // Retired source is retained for future recovery; the application no longer mounts it.
 assert.match(view,/export async function renderDevIDE\(/);
 assert.match(standalone,/id="tree"/);
 assert.match(css,/\.admin-lifeide__frame\s*\{/);
});

test('Git branch file links open in the same CodeMirror LifeIDE iframe',()=>{
 assert.match(view,/params\.set\('path',query\.path\)/);
 assert.match(view,/params\.set\('branch',query\.branch\|\|'develop'\)/);
 assert.doesNotMatch(view,/if\(query\.path\)return renderDevIDEGitHub/);
});
