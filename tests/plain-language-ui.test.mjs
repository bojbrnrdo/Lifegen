import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const views=['lifegroups','progress','unifiedAddNew','removeFromLifegroups','networkDetailUI']
  .map(name=>[name,read('../public/admin/js/views/'+name+'.js')]);
const backend=read('../src/lifegroups.js');

// Internal vocabulary that leaked into screens church volunteers use.
const jargon=[/Closed cell/i,/Open cell/i,/Closed Cell/i,/Open Cell/i,/is_solid/,/tier=/i];

test('Lifegroups screens use Settled / New instead of Closed cell / Open cell',()=>{
  for(const [name,source] of views){
    const errors=[...source.matchAll(/error\([^)]*'[^']*'|toast\([^)]*'[^']*'/g)].map(m=>m[0]).join('\n');
    for(const pattern of jargon) assert.doesNotMatch(errors,pattern,name+' shows internal tier wording in a message');
  }
});

test('no user-facing string explains the database or the data model to staff',()=>{
  for(const [name,source] of views){
    assert.doesNotMatch(source,/not yet supported by the current database/i,name);
    assert.doesNotMatch(source,/awaiting its database relationship/i,name);
    assert.doesNotMatch(source,/database relationship/i,name);
  }
});

test('server errors shown in the UI avoid Closed cell / Open cell and Lifegroup',()=>{
  const messages=[...backend.matchAll(/httpError\(\s*4\d\d\s*,\s*'([^']*)'/g)].map(m=>m[1]);
  assert.ok(messages.length>50,'every thrown validation message is checked');
  for(const message of messages){
    assert.doesNotMatch(message,/Closed cell|Open cell/i,'still says: '+message);
    assert.doesNotMatch(message,/Lifegroup/i,'still says: '+message);
  }
});

test('the Add New tabs are named for the task, not the record type',()=>{
  const source=views.find(([name])=>name==='unifiedAddNew')[1];
  assert.match(source,/const tabLabel=\{network:'Start a Network',cell:'Start a Cell',member:'Add a person',vip:'Add a VIP guest'\}/);
  assert.match(source,/const purposeOf=\{/);
});
