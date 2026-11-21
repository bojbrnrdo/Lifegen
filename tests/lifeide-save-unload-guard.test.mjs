import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/lifeide/app.js',import.meta.url),'utf8');

test('LifeIDE warns before unload for unsaved edits and pending saves or commits',()=>{
 const start=source.indexOf("window.addEventListener('beforeunload'");
 assert.ok(start>=0);
 const guard=source.slice(start,source.indexOf("const draftKey=",start));
 assert.match(guard,/!repoMode\|\|\(!repoDirty&&!saveBusy&&!commitBusy&&!devBusy\)/);
 assert.match(guard,/event\.preventDefault\(\)/);
 assert.match(guard,/event\.returnValue=''/);
});

test('Save and Cmd-S or Ctrl-S use the same active-file save path',()=>{
 assert.match(source,/\$\('saveFile'\)\.addEventListener\('click',saveActiveFile\)/);
 assert.match(source,/e\.metaKey\|\|e\.ctrlKey/);
 assert.match(source,/e\.key\.toLowerCase\(\)!=='s'/);
 assert.match(source,/e\.preventDefault\(\);\s*if\(e\.repeat\)return;\s*saveActiveFile\(\)/);
});

test('repository save preserves edits typed while an earlier save is pending',()=>{
 assert.match(source,/const path=current,f=repoFiles\.get\(path\)/);
 assert.match(source,/const content=\$\('editor'\)\.value/);
 assert.match(source,/if\(current===path&&\$\('editor'\)\.value===content\)\{repoDirty=false/);
 assert.match(source,/File saved; newer edits remain unsaved/);
});
