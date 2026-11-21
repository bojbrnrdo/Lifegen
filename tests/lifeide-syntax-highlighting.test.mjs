import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const syntax=require('../public/lifeide/syntax.js');
const html=readFileSync(new URL('../public/lifeide/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/lifeide/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/lifeide/syntax.css',import.meta.url),'utf8');

test('code highlights keywords, strings, comments and numbers',()=>{
 const result=syntax.highlight('const answer = 42; // note\nconsole.log("hello");','example.js');
 for(const role of ['keyword','number','comment','string','function'])assert.match(result,new RegExp('syn-'+role));
});
test('HTML source is safely escaped, not executed as markup',()=>{
 const result=syntax.highlight('<script>alert("x")</script>','index.html');
 assert.ok(!result.includes('<script>'));
 assert.match(result,/&lt;script&gt;/);
 assert.match(result,/syn-tag/);
 assert.equal(syntax.escapeHTML('<img src=x onerror="boom">'),'&lt;img src=x onerror=&quot;boom&quot;&gt;');
});
test('supports common file formats and leaves plain text untouched',()=>{
 assert.equal(syntax.language('src/a.tsx'),'code');
 assert.equal(syntax.language('README.md'),'markdown');
 assert.equal(syntax.language('styles.css'),'css');
 assert.equal(syntax.language('main.py'),'python');
 assert.match(syntax.highlight('# heading','README.md'),/syn-keyword/);
 assert.match(syntax.highlight('# comment\nprint(3)','main.py'),/syn-comment/);
 assert.equal(syntax.highlight('one < two','notes.txt'),'one &lt; two');
});
test('LifeIDE mounts syntax mirror without replacing actual textarea editor',()=>{
 assert.match(html,/\/lifeide\/syntax\.css/);
 assert.match(html,/\/lifeide\/syntax\.js/);
 assert.match(html,/id="editor"/);
 assert.match(app,/window\.lifeideHighlight\?\.\(\)/);
 assert.match(css,/caret-color/);
 assert.match(css,/pointer-events:none/);
});
