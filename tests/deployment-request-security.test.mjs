import test from 'node:test';
import assert from 'node:assert/strict';
import { safeKey, safeArchiveHash, safeScope, safePublishBody } from '../src/deployment.js';

test('deployment IDs reject objects, arrays, empty strings and path separators',()=>{
 for(const value of [null,undefined,{},[],['team_1'],42,'','../../api','team/id'])
  assert.throws(()=>safeKey(value,'project ID'));
 assert.equal(safeKey('prj_ABC-123','project ID'),'prj_ABC-123');
});
test('deployment scope accepts personal account but rejects tampered types',()=>{
 assert.equal(safeScope(''),'');
 assert.equal(safeScope('team_123'),'team_123');
 for(const value of [null,{},[],['team_123'],2])assert.throws(()=>safeScope(value));
});
test('archive hash must be exactly a hexadecimal SHA-256 string',()=>{
 const hash='a'.repeat(64);
 assert.equal(safeArchiveHash(hash),hash);
 for(const value of [null,{},42,'A'.repeat(64),'a'.repeat(63),'x'.repeat(64)])
  assert.throws(()=>safeArchiveHash(value));
});
test('publish body rejects tampered parameter types and requires literal confirmation',()=>{
 const base={project_id:'prj_abc',archive_hash:'f'.repeat(64),confirm:true};
 assert.deepEqual(safePublishBody(base),base);
 assert.equal(safePublishBody({...base,confirm:'true'}).confirm,false);
 for(const payload of [undefined,null,[],{...base,project_id:{}},{...base,archive_hash:['f'.repeat(64)]}])
  assert.throws(()=>safePublishBody(payload));
});
