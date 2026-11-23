import test from 'node:test';
import assert from 'node:assert/strict';
import {convertLeadingTabs,longLines,jsonDiagnostic} from '../frontend/lifeide/formatting.js';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/lifeide/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../frontend/lifeide/codemirror.js',import.meta.url),'utf8');
test('leading tabs convert to four spaces without changing internal string tabs',()=>{
 const text='\tconst a = "x\ty";\n  \tlet b=2;\nplain\ttext\n';
 const result=convertLeadingTabs(text);
 assert.equal(result.changed,2);
 assert.equal(result.content,'    const a = "x\ty";\n      let b=2;\nplain\ttext\n');
});
test('already formatted text is unchanged',()=>{
 assert.deepEqual(convertLeadingTabs('    const a=1;\n'),{content:'    const a=1;\n',changed:0});
});
test('long-line check reports line number and character count',()=>{
 const list=longLines('short\n'+'a'.repeat(81)+'\n'+'b'.repeat(80));
 assert.deepEqual(list,[{line:2,length:81}]);
});
test('JSON diagnostics reject broken JSON while accepting valid JSON',()=>{
 assert.equal(jsonDiagnostic('{"ok":true}'),null);
 assert.match(jsonDiagnostic('{bad}')?.message,/Invalid JSON/);
});
test('LifeIDE exposes formatting controls and actual CodeMirror diagnostics',()=>{
 for(const id of ['formatTabs','formatLongLine','formatLint','formatWrap'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(js,/indentUnit\.of\('    '\)/);
 assert.match(js,/lintGutter\(\)/);
 assert.match(js,/openLintPanel\(view\)/);
 assert.match(js,/EditorView\.lineWrapping/);
});
