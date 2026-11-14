import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const people=readFileSync(new URL('../public/admin/js/views/people.js',import.meta.url),'utf8');
const profile=readFileSync(new URL('../public/admin/js/views/person.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin/styles.css',import.meta.url),'utf8');

test('People directory provides accessible filters and profiles',()=>{
 for(const id of ['peopleResultCount','peopleRange','clearPeopleSearch','peopleSort'])
  assert.ok(people.includes('id="'+id+'"'),id);
 assert.match(people,/people-directory__tab/);
 assert.match(people,/aria-pressed/);
 assert.match(people,/data-status/);
 assert.match(people,/aria-label="View profile for/);
 assert.match(people,/href="#\/people\/\$\{p.id\}"/);
 assert.match(people,/api.people\(\{ \.\.\.filters, paged: 1, limit: PAGE, offset \}\)/);
 assert.match(people,/api.people\(\{ \.\.\.filters, limit: 2000 \}\)/);
});

test('People search, pagination and empty states remain available',()=>{
 assert.match(people,/debounce\(/);
 assert.match(people,/reqId/);
 assert.match(people,/loadMore/);
 assert.match(people,/clearFilters/);
 assert.match(people,/clearPeopleSearch/);
 assert.match(people,/peopleSort/);
 assert.match(people,/can\('people:write'\)/);
});

test('People profile has readable navigable sections',()=>{
 assert.match(profile,/id="personDetails"/);
 assert.match(profile,/id="personAttendance"/);
 assert.match(profile,/aria-label="Profile sections"/);
 assert.match(css,/\.people-directory__tabs/);
 assert.match(css,/\.people-profile__tab/);
});
