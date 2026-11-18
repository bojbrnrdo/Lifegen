import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const people=readFileSync(new URL('../public/admin/js/views/people.js',import.meta.url),'utf8');
const form=readFileSync(new URL('../public/admin/js/views/personForm.js',import.meta.url),'utf8');
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

test('Person registration shows essential fields first without dropping optional data',()=>{
 assert.match(form,/Basic information/);
 assert.match(form,/people-form__optional/);
 assert.match(form,/p\?\.id \? 'open' : ''/);
 for(const field of ['first_name','last_name','contact_number','status','privacy_consent','birthdate','date_first_attended','notes'])
  assert.ok(form.includes(field),field);
 assert.match(form,/duplicateGuard/);
 assert.match(form,/collectPerson\(form\)/);
 assert.match(css,/\.people-form__optional-summary/);
});

test('Invalid registration fields are revealed and focused before saving',()=>{
 assert.match(form,/const optionalDetails=form\.querySelector\('\.people-form__optional'\)/);
 assert.match(form,/optionalDetails\?\.contains\(field\)\)optionalDetails\.open=true/);
 assert.match(form,/field\?\.focus\(\)/);
 assert.match(form,/field\?\.scrollIntoView/);
 assert.match(form,/!field\.validity\.valid/);
 assert.match(form,/invalid\.setAttribute\('aria-invalid','true'\)/);
 assert.match(form,/showFieldError\(invalid,invalid\.validationMessage/);
 assert.match(form,/duplicateGuard\(data/);
});
