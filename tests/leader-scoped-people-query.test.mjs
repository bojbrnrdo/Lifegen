import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=fs.readFileSync(new URL('../src/read-model.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
test('People directory restricts results in SQL through active assigned memberships',()=>{
 assert.match(read,/export async function peopleList\(params = \{\}, allowedCellIds = null\)/);
 assert.match(read,/lm\.person_id=p\.id AND lm\.left_at IS NULL AND lg\.is_active=true AND lg\.id=ANY\(\$7::bigint\[\]\)/);
 assert.match(read,/query\(sql,\[\.\.\.paramsSql,limit,offset,scopeCells\]\)/);
 assert.match(read,/where\.replaceAll\('\$7::bigint\[\]','\$5::bigint\[\]'\)/);
 assert.match(read,/\[\.\.\.paramsSql,scopeCells\]/);
});
test('API passes authenticated server scope rather than client-supplied cell IDs',()=>{
 assert.match(app,/req\.leaderCellIds=leaderPolicy\.allowedCellIds/);
 assert.match(app,/peopleList\(args\[0\]\|\|\{\},req\.leaderCellIds\?\?null\)/);
});
