import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const policy=readFileSync(new URL('../src/leader-tracker-policy.js',import.meta.url),'utf8');
test('VIP design route applies linked-account export policy before its handlers',()=>{
 assert.match(app,/vipDesigns\.use\(requireStaff,async\(req,res,next\)=>\{try\{requirePermission\(req\.actor,'settings:manage'\);await assertGlobalExportAccess/);
});
test('linked leader profile lookup cannot retrieve archived People',()=>{
 assert.match(policy,/JOIN people p ON p\.id=lm\.person_id WHERE lm\.person_id=\$1 AND p\.archived_at IS NULL/);
});
