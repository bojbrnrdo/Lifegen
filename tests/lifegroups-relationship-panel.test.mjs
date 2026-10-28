import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../frontend/lifegroups/Map.jsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../frontend/lifegroups/map.css',import.meta.url),'utf8');
test('Details panel focuses on real relationships instead of unrelated contact fields',()=>{
 assert.match(source,/Lifegroup relationships/);
 assert.match(source,/function RelationshipGallery/);
 assert.match(source,/title=\{relationTitle\}/);
 assert.doesNotMatch(source,/Phone not recorded|Email not recorded|Schedule not recorded|Venue not recorded|Meeting type not recorded|Apprentice not recorded/);
 assert.doesNotMatch(source,/className="lg-r-info"/);
 assert.match(source,/manage&&role==='cell'/);
 assert.match(source,/View Attendance/);
});
test('Network Leader panel displays the Cell Leaders in their assigned Network',()=>{
 assert.match(source,/if\(selected\.role==='network'\)return data\.groups/);
 assert.match(source,/Number\(g\.network_id\)===Number\(selected\.person\.id\)/);
 assert.match(source,/Number\(g\.leader_person_id\)!==Number\(selected\.person\.leader_person_id\)/);
 assert.match(source,/\.map\(g=>\(\{id:'c'\+g\.id,role:'cell'/);
});
test('Cell Leaders show their Members, and Members link back to their Cell Leader',()=>{
 assert.match(source,/if\(selected\.role==='cell'\)return \(members\.get\(selected\.groupId\)\|\|\[\]\)/);
 assert.match(source,/\.filter\(m=>!m\.left_at\)/);
 assert.match(source,/if\(selected\.role==='member'\)/);
 assert.match(source,/return parent\?\[\{id:'c'\+parent\.id/);
});
test('Circular avatars expose accessible hover names and click navigation',()=>{
 assert.match(source,/className="lg-r-relation-avatar"/);
 assert.match(source,/title=\{name\(item\.person\)\}/);
 assert.match(source,/aria-label=\{'View '\+name\(item\.person\)/);
 assert.match(source,/className="lg-r-relation-tooltip"/);
 assert.match(source,/onClick=\{\(\)=>onChoose\(item\)\}/);
 assert.match(source,/setExpanded\(prev=>\{/);
 assert.match(source,/next\.add\('n'\+networkId\)/);
 assert.match(source,/next\.add\('c'\+item\.groupId\)/);
 assert.match(source,/setSearch\(''\)/);
 assert.match(css,/\.lg-r-relation-avatar:hover \.lg-r-relation-tooltip/);
 assert.match(css,/\.lg-r-relation-avatar:focus \.lg-r-relation-tooltip/);
});
