import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { availableCommands, matchCommands } from '../public/admin/js/workspaceCommands.js';
const shell=readFileSync(new URL('../public/admin/js/app.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../public/admin/reference-layout.css',import.meta.url),'utf8');

test('Workspace search navigates modules and tasks; does not search People records',()=>{
 assert.match(shell,/id="workspaceCommandSearch"/);
 assert.match(shell,/Jump to a section or action/);
 assert.doesNotMatch(shell,/id="headerPeopleSearch"|placeholder="Search People"/);
 assert.match(shell,/mountWorkspaceCommandSearch/);
 assert.match(styles,/\.workspace-command-results/);
 assert.match(styles,/\.workspace-command-option\[aria-selected/);
});
test('Workspace command list honors roles and deployment availability',()=>{
 const all=()=>true;
 const admin=availableCommands({can:all,deployHelper:true});
 assert.ok(admin.find(x=>x.title==='People'));
 assert.ok(admin.find(x=>x.title==='Add person'));
 assert.ok(admin.find(x=>x.title==='Lifegroups'));
 assert.ok(admin.find(x=>x.title==='Publish website'));
 assert.ok(admin.find(x=>x.title==='Registration'));
 const viewer=availableCommands({can:permission=>permission==='dashboard:view',standalone:true});
 for(const x of ['People','Add person','Lifegroups','Registration','Community board','VIP Designs','Publish website'])assert.ok(!viewer.some(c=>c.title===x),x);
 assert.ok(viewer.some(c=>c.title==='Calendar'));
 assert.ok(viewer.some(c=>c.title==='Settings'));
 const standalone=availableCommands({can:all,standalone:true});
 assert.ok(!standalone.some(c=>c.title==='Registration'||c.title==='Check-in QR'));
});
test('Search filters workspace commands, not names or private records',()=>{
 const list=availableCommands({can:()=>true,deployHelper:true});
 assert.deepEqual(matchCommands(list,'attendance').map(x=>x.title),['Check-in QR']);
 assert.ok(matchCommands(list,'network').some(x=>x.title==='Lifegroups'));
 assert.ok(matchCommands(list,'VIP reg').some(x=>x.title==='Registration'));
 assert.deepEqual(matchCommands(list,'nonexistentperson record 123'),[]);
 assert.equal(matchCommands(list,'').length,list.length);
});
test('Keyboard shortcuts, arrows, Escape and cleanup are implemented',()=>{
 const source=readFileSync(new URL('../public/admin/js/workspaceCommands.js',import.meta.url),'utf8');
 for(const term of ['event.ctrlKey||event.metaKey','ArrowDown','ArrowUp','Escape','Enter','onOutside','aria-activedescendant','hashchange','removeEventListener'])assert.ok(source.includes(term),term);
});
