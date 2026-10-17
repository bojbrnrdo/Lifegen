import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/admin/js/views/unifiedAddNew.js',import.meta.url),'utf8');

test('Member registration exposes Closed Cell and Open Cell choices',()=>{
 assert.match(source,/name=\\"member_tier\\" value=\\"solid\\" checked/);
 assert.match(source,/name=\\"member_tier\\" value=\\"new\\"/);
});

test('Open Cell registration fails closed until parent relationship is implemented',()=>{
 const guard=source.indexOf("if(mode==='member'&&memberTier==='new')return error");
 const create=source.indexOf('await api.createPerson(person)');
 const assign=source.indexOf('await api.assignLifegroup(cellId,created.id');
 assert.ok(guard>0 && create>guard && assign>guard);
 assert.match(source,/requires selecting a Closed Cell parent/);
});

test('Closed Cell classification is sent to the membership API',()=>{
 assert.match(source,/api.assignLifegroup\(cellId,created.id,\{role:'member',tier:memberTier/);
});
