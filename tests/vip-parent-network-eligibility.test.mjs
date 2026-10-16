import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/lifegroups.js',import.meta.url),'utf8');
test('VIP assignment rechecks parent Network under transactional row lock',()=>{
 const start=source.indexOf('async function assignMember(');
 const end=source.indexOf('async function ',start+20);
 const body=source.slice(start,end);
 assert.match(body,/if \(extra\.auto_assign\) \{[\s\S]*?SELECT id,is_active,gender,is_demo FROM networks WHERE id=\$1 FOR SHARE/);
 assert.match(body,/!parentNetwork\.is_active/);
 assert.match(body,/parentNetwork\.is_demo/);
 assert.match(body,/parentNetwork\.gender!==group\.gender/);
});
