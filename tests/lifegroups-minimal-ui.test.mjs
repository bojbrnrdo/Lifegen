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
 assert.match(page, /id="treeCanvas"/);
 assert.match(page, /loadReactLifegroups\(\)/);
 assert.match(page, /mount\(canvas,\{/);
 assert.match(page, /renderHierarchy\(canvas,cache\.nets,cache\.groups,filters,\{onRemove:removeContext\}\)/);
 assert.match(page, /createAddNewModal/);
 assert.match(page, /id="treeRefresh"/);
 assert.match(page, /id="treeStatus"/);
});

test('diagram remains a three-level interactive SVG network with always-fit tools',()=>{
 assert.match(tree, /<svg class="lfg__svg"/);
 for(const name of ['fit','collapse','plus','minus'])assert.match(tree,new RegExp('data-action="'+name+'"'));
 assert.match(tree, /treeControlIcon/);
 assert.match(tree, /aria-label="Interactive Lifegroup network/);
 assert.doesNotMatch(tree, /data-action="focus"/);
 assert.match(tree, /target\.querySelector\('\[data-action="fit"\]'\)\.onclick/);
 assert.match(tree, /profileAvatar\(n\)/);
 assert.match(tree, /target\.querySelector\('\.lfg__svg'\)/);
 assert.match(tree, /api\.lifegroup\(node\.record\.id\)/);
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
 assert.match(detail, /renderProgressCard\(main\.querySelector\('#progressCard'\)/);
 assert.match(detail, /Former members/);
 assert.match(detail, /api\.setTier/);
 assert.match(detail, /bindMemberActions/);
});
