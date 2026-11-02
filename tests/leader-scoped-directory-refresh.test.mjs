import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/admin/js/views/lifegroups.js',import.meta.url),'utf8');
test('scoped leader directory displays count and refreshes using authenticated scope',()=>{
 assert.match(source,/My People \(\$\{people\.length\}\)/);
 assert.match(source,/id="leaderPeopleRefresh"/);
 assert.match(source,/leaderPeopleRefresh'\)\?\.addEventListener\('click',\(\)=>renderLifegroups\(\{main,query\}\)/);
});
