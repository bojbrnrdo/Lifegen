import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const view=read('../public/admin/js/views/lifegroups.js');
const source=read('../frontend/lifegroups/Map.jsx');
const pkg=JSON.parse(read('../package.json'));
const index=read('../public/admin/index.html');

test('React Flow is built into actual LIFEGEN admin portal while keeping SVG fallback',()=>{
 assert.ok(pkg.scripts.build.includes('build:lifegroups'));
 assert.ok(pkg.devDependencies['@xyflow/react']);
 assert.ok(pkg.devDependencies['react']);
 assert.match(view,/import\('\/admin\/react-lifegroups\.js'\)/);
 assert.match(view,/mount\(canvas,\{/);
 assert.match(view,/networks:cache\.nets,groups:cache\.groups/);
 assert.match(view,/api\.lifegroup\(id\)/);
 assert.match(view,/api\.lifegroupProgress\(id,12\)/);
 assert.match(view,/api\.person\(id\)/);
 assert.match(view,/renderHierarchy\(canvas,cache\.nets,cache\.groups,filters,\{onRemove:removeContext\}\)/);
 assert.match(index,/\/admin\/react-lifegroups\.css/);
 for(const p of ['../public/admin/react-lifegroups.js','../public/admin/react-lifegroups.css'])
  assert.ok(statSync(new URL(p,import.meta.url)).size>1000);
});
test('LIFEGEN permissions and existing Add/Remove workflows drive React actions',()=>{
 assert.match(view,/manage:can\('lifegroups:manage'\)/);
 assert.match(view,/createAddNewModal\(/);
 assert.match(view,/openRemoveFromLifegroups\(/);
 assert.match(view,/groupForm\(selection\.person/);
 assert.match(view,/networkForm\(selection\.person/);
 assert.match(view,/data-react-mounted/);
 assert.match(source,/onRemove\(selection\)/);
 assert.match(source,/onReassign\(selection\)/);
 assert.match(source,/onAdd\(selection\)/);
});
test('React Flow hierarchy connects real Network→Cell→Member records and supports search-to-focus',()=>{
 assert.match(source,/import \{ReactFlow,ReactFlowProvider/);
 assert.match(source,/ReactFlow nodes=\{nodes\} edges=\{edges\}/);
 assert.match(source,/dagre\.layout\(graph\)/);
 assert.match(source,/const groupSet=groups\.filter/);
 assert.match(source,/for\(const m of members\.get\(g\.id\)/);
 assert.match(source,/rf\.setCenter\(/);
 assert.match(source,/rf\.fitView\(/);
 assert.match(source,/loadProgress\(g\.id\)/);
 assert.match(source,/met_this_week/);
});
