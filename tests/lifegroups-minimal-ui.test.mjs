import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildLifegroupTree,arrangeLifegroupTree} from '../public/admin/js/views/hierarchy.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const nav=read('../public/admin/js/app.js');
const views=read('../public/admin/js/views/lifegroups.js');
const tree=read('../public/admin/js/views/hierarchy.js');
const css=read('../public/admin/styles.css');
const slice=(begin,end)=>{
 const start=views.indexOf(begin),stop=views.indexOf(end,start+begin.length);
 assert.ok(start>=0&&stop>start, 'Missing UI block: '+begin);
 return views.slice(start,stop);
};

test('sidebar and page are named Lifegroups, without changing its route',()=>{
 assert.match(nav, /navLink\('#\/lifegroups',\s*'lifegroups',\s*'Lifegroups',\s*'group'(?:,\s*true)?\)/);
 const page=slice('export async function renderLifegroups(', 'async function drawNeeds(');
 assert.match(page, /<h1>Lifegroups<\/h1>/);
 assert.match(page, /id="lifegroupsDirectory"/);
 assert.match(page, /id="findPersonPanel"/);
 assert.match(page, /createAddNewModal/);
 assert.match(page, /id="treeRefresh"/);
 assert.match(page, /id="treeStatus"/);
 // No map: no canvas, no React Flow loader, no SVG fallback.
 for(const dead of ['treeCanvas','showGroupMap','react-lifegroups','renderHierarchy','mountMap'])
  assert.ok(!page.includes(dead), 'the removed network map is gone: '+dead);
});

test('the shared Lifegroup tree model keeps its three levels',()=>{
 const networks=[{id:1,name:'Network',leader_name:'Network Leader',is_active:true,gender:'boys'}];
 const groups=[{id:2,network_id:1,name:'Cell',leader_name:'Cell Leader',member_count:1,is_active:true,gender:'boys'}];
 const initial=buildLifegroupTree(networks,groups,{},new Set(),new Map(),new Set());
 assert.equal(arrangeLifegroupTree(initial).nodes.length,1);
 const opened=buildLifegroupTree(networks,groups,{},new Set(['network:1']),new Map(),new Set());
 assert.equal(arrangeLifegroupTree(opened).nodes.length,2);
});

test('Lifegroups toolbar and optional extras remain functional but compact',()=>{
 const page=slice('export async function renderLifegroups(', 'async function drawNeeds(');
 for(const id of ['treeQ','treeStatus','treeRefresh','needsPanel','progressPanel','treeSummary'])
  assert.ok(page.includes('id="'+id+'"'));
 for(const name of ['genderButtons','drawNeeds','drawProgressTab','findUnassignedGroups'])
  assert.ok(page.includes(name));
 assert.match(css, /\.lifegroups-page__summary/);
 assert.match(css, /\.lifegroups-page__extras/);
});

test('Cell Leader details prioritize an avatar and a unified member list',()=>{
 const detail=slice('export async function renderLifegroup(', '// Networks:');
 assert.match(detail, /class="lifegroup-detail"/);
 assert.match(detail, /photo:g\.leader_photo/);
 assert.match(detail, /lifegroup-detail__person-photo/);
 assert.match(detail, /lifegroup-detail__member-actions/);
 assert.match(detail, /memberActions\(m,g\)/);
 assert.match(detail, /data-tier=/);
 assert.match(detail, /id="membersCard"/);
 assert.match(css, /\.lifegroup-detail__people/);
});

test('leadership, attendance and history remain available as expandable sections',()=>{
 const detail=slice('export async function renderLifegroup(', '// Networks:');
 assert.match(detail, /lifegroup-detail__info/);
 assert.match(detail, /lifegroup-detail__progress/);
 assert.match(detail, /progressDisclosure\.addEventListener\('toggle'/);
 assert.match(detail, /renderProgressCard\(progressCard, g\.id/);
 assert.match(detail, /const progressCard=main\.querySelector\('#progressCard'\)/);
 assert.match(detail, /Former members/);
 assert.match(detail, /api\.setTier/);
 assert.match(detail, /bindMemberActions/);
});

test('Lifegroups has a single, list-first view with no map toggle',()=>{
 const page=slice('export async function renderLifegroups(', 'async function drawNeeds(');
 assert.match(page,/const renderDirectory=/);
 assert.match(page,/renderDirectory\(\)/);
 assert.match(page,/href="#\/lifegroups\/\$\{g.id\}"/);
 assert.match(css,/\.lifegroups-page__directory-grid/);
 assert.doesNotMatch(page,/aria-label="Lifegroups view"/);
});

test('the directory is the only view and the map build is gone from the project',()=>{
 const page=slice('export async function renderLifegroups(', 'async function drawNeeds(');
 assert.match(page,/let cache=null,sequence=0/);
 for(const label of ['Everyone','Boys','Girls'])
  assert.ok(page.includes('<span>'+label+'</span>'),label);
 const pkg=JSON.parse(read('../package.json'));
 assert.ok(!pkg.scripts['build:lifegroups']);
 assert.ok(!pkg.scripts.build.includes('lifegroups'));
 for(const dep of ['react','react-dom','@xyflow/react','dagre'])
  assert.ok(!pkg.devDependencies[dep],'removed dependency: '+dep);
 const index=read('../public/admin/index.html');
 assert.ok(!index.includes('react-lifegroups'));
});
