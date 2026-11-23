import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const dev=readFileSync(new URL('../public/admin/js/views/devWorkspace.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin/styles.css',import.meta.url),'utf8');
test('Git comparison includes an explicit selection and packaging handoff',()=>{
 for(const id of ['gitReviewPackage','gitSelectedCount'])assert.ok(dev.includes('id="'+id+'"'));
 assert.match(dev,/checkbox\.className='devgit__select-file'/);
 assert.match(dev,/if\(file\.status!=='removed'\)/);
 assert.match(dev,/if\(selectedFiles\.size>=40\)/);
 assert.match(dev,/window\.location\.hash=devLink\('packaging',branch\)\+'\&review=selected'/);
 assert.match(css,/\.devgit__review-controls/);
});
test('Git-to-Packaging selection is short-lived, branch-specific and limited',()=>{
 assert.match(dev,/const reviewKey='lifegen\.dev\.reviewed-package-files\.v1'/);
 assert.match(dev,/sessionStorage\.removeItem\(reviewKey\)/);
 assert.match(dev,/payload\.branch!==branch/);
 assert.match(dev,/Date\.now\(\)-payload\.createdAt>10\*60\*1000/);
 assert.match(dev,/payload\.paths\.length>40/);
 assert.match(dev,/new Set\(payload\.paths\)\.size!==payload\.paths\.length/);
 assert.match(dev,/saveReview\(branch,paths\)/);
});
test('Packaging rechecks reviewed files against fresh remote changes',()=>{
 assert.match(dev,/api\('branch-status\?branch='/);
 assert.match(dev,/const eligible=new Set\(files\.map\(file=>file\.path\)\)/);
 assert.match(dev,/branch===reviewBranch\?reviewedPaths:null/);
 assert.match(dev,/currentReview\?\.filter\(path=>eligible\.has\(path\)\)/);
 assert.match(dev,/check\.checked=validatedReview\?validatedReview\.includes\(file\.path\):index<40/);
 assert.match(dev,/if\(currentReview\)\{\s*reviewedPaths=null/);
 assert.match(dev,/if\(reviewedPaths\)el\('findPackageFiles'\)\.click\(\)/);
 assert.match(dev,/if\(onlySelected&&\(!paths\.length\|\|paths\.length>40\)\)/);
});
test('Reviewing never triggers a package write or circumvents production restrictions',()=>{
 assert.match(dev,/el\('runPackage'\)\.onclick=async\(\)=>\{/);
 assert.match(dev,/if\(!confirm\('Start '/);
 assert.match(dev,/api\('package',\{method:'POST'/);
 assert.match(dev,/data\.writesEnabled\?'':'disabled'/);
});
