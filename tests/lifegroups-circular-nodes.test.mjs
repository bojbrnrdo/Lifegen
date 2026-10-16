import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../frontend/lifegroups/Map.jsx',import.meta.url),'utf8');
const style=readFileSync(new URL('../frontend/lifegroups/map.css',import.meta.url),'utf8');

test('Profile tree nodes use circular photos, not rectangular cards',()=>{
 assert.match(source,/className="lg-r-circle"/);
 assert.match(source,/className="lg-r-expand-indicator"/);
 assert.match(style,/\.lg-r-circle\{[^}]*border-radius:50%/);
 assert.match(style,/\.lg-r-node\{[^}]*background:transparent;[^}]*border:0/);
 assert.match(style,/\.lg-r-circle \.lg-r-avatar\{[^}]*border-radius:50%/);
 assert.doesNotMatch(source,/className="lg-r-toggle/);
 assert.doesNotMatch(source,/<Chevron(?:Down|Right)/);
});
test('Clicking the leader profile expands and collapses the network, while also opening details',()=>{
 assert.match(source,/onClick=\{e=>\{e\.stopPropagation\(\);activate\(entry\)\}\}/);
 assert.match(source,/if\(row\.role!=='member'\)toggle\(row\.id\)/);
 assert.match(source,/select\(row\)/);
 assert.match(source,/onKeyDown=\{onKeyDown\}/);
 assert.match(source,/if\(e\.key!=='Enter'&&e\.key!==' '\)return/);
 assert.match(source,/aria-expanded=\{expandable\?expanded:undefined\}/);
 assert.doesNotMatch(source,/onNodeClick=\{onNodeClick\}/);
});
test('Hierarchy still maintains separate connected levels and node details',()=>{
 assert.match(source,/role==='network'\?'Network Leader':entry\.role==='cell'\?'Cell Leader':'Member'/);
 assert.match(source,/edges\.push\(\{source:parent,target:id/);
 assert.match(source,/for\(const m of members\.get\(g\.id\)/);
 assert.match(source,/const nodeTypes=\{person:TreeNode\}/);
 assert.match(source,/<Panel selection=\{selected\}/);
});
