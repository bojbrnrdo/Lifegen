import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
const html=readFileSync(new URL('../public/lifeide/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../frontend/lifeide/codemirror.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/lifeide/styles.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/lifeide/app.js',import.meta.url),'utf8');
test('LifeIDE now loads a compiled CodeMirror 6 editor',()=>{
 assert.match(html,/\/lifeide\/codemirror\.bundle\.js/);
 assert.doesNotMatch(html,/<script src="\/lifeide\/syntax\.js"/);
 assert.ok(statSync(new URL('../public/lifeide/codemirror.bundle.js',import.meta.url)).size>100000);
 assert.match(js,/@codemirror\/view/);
 assert.match(js,/@codemirror\/state/);
});
test('CodeMirror provides real language grammars rather than a regex coloring layer',()=>{
 for(const lang of ['lang-javascript','lang-css','lang-html','lang-json','lang-python','lang-markdown','lang-sql','lang-xml','lang-yaml','lang-php'])assert.ok(js.includes('@codemirror/'+lang),lang);
 assert.match(js,/autocompletion\(\)/);
 assert.match(js,/history\(\)/);
 assert.match(js,/oneDark/);
});
test('Existing file opening and saving bridge preserves textarea value contracts',()=>{
 assert.match(js,/Object\.defineProperty\(textarea,'value'/);
 assert.match(js,/originalValue\.set\.call\(textarea,update\.state\.doc\.toString\(\)\)/);
 assert.match(js,/textarea\.dispatchEvent\(new Event\('input'/);
 assert.match(js,/textarea\.disabled/);
 assert.match(js,/fileTitle\.textContent/);
 assert.match(js,/key:'Mod-s'/);
 assert.match(html,/id="editor"/);
 assert.match(app,/\$\('saveFile'\)\.addEventListener\('click',saveActiveFile\)/);
});
test('Old textarea remains a fallback if CodeMirror cannot load',()=>{
 assert.match(css,/\.editor-wrap\.cm-active textarea#editor\{display:none\}/);
 assert.match(js,/wrap\.classList\.add\('cm-active'\)/);
 assert.match(js,/window\.lifeideCodeMirror=view/);
});
