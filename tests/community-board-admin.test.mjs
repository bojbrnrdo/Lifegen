// Community board moderation (admin portal).
//
// The edit / hide / delete surface is asserted against the shipped source the
// way this repository checks migrations and admin screens; the live SQL and
// HTTP behaviour is covered by tests/community-board-integration.mjs
// (npm run test:community-integration).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const server = read('../src/app.js');
const view = read('../public/admin/js/views/community.js');
const adminApp = read('../public/admin/js/app.js');
const adminApi = read('../public/admin/js/api.js');
const settings = read('../public/admin/js/views/settings.js');

test('the tracker exposes editPost and deletePost for settings:manage', () => {
  assert.match(server, /editPost:\['settings:manage',true\]/);
  assert.match(server, /deletePost:\['settings:manage',true\]/);
  // The existing moderation operations stay available alongside the new ones.
  assert.match(server, /postsAdmin:\['settings:manage',false\]/);
  assert.match(server, /moderatePost:\['settings:manage',true\]/);
});

test('editPost rewrites the message but respects the anonymous constraint', () => {
  assert.match(server, /\['prayer','testimony','praise'\]\.includes\(type\)/);
  assert.match(server, /content\.length>1000/);
  // CHECK(NOT is_anonymous OR author IS NULL) in 001_init.sql: the update must
  // clear the author whenever the post is anonymous.
  assert.match(server, /UPDATE community_posts SET type=\$1,author=\$2,content=\$3,is_anonymous=\$4 WHERE id=\$5/);
  assert.match(server, /if\(!anonymous\)\{author=String\(f\.author\|\|''\)\.trim\(\)\.slice\(0,60\);if\(!author\)throw httpError\(400/);
  assert.match(server, /await logAction\(client,actor,'community_posts',id,'update'/);
});

test('deletePost removes the post for good and leaves an audit trail', () => {
  assert.match(server, /DELETE FROM community_posts WHERE id=\$1 RETURNING id,type,is_anonymous/);
  assert.match(server, /await logAction\(client,actor,'community_posts',id,'delete'/);
  // Nothing ever updates a post to a "deleted" flag instead — the row is gone,
  // and prayer_reactions cascade with it (FK ON DELETE CASCADE).
  assert.match(server, /if\(name==='deletePost'\)return transaction/);
});

test('postsAdmin feeds the moderation table with prayer reaction counts', () => {
  assert.match(server, /SELECT id,type,author,content,is_anonymous,is_hidden,created_at,\(SELECT count\(\*\)::int FROM prayer_reactions r WHERE r\.post_id=community_posts\.id\) AS prayer_count FROM community_posts/);
});

test('the Community board view edits, hides and deletes posts', () => {
  assert.match(view, /export async function renderCommunity/);
  // Edit modal keeps every field the wall displays.
  assert.match(view, /id="cbfType"/);
  assert.match(view, /id="cbfText"[^>]*maxlength="1000"/);
  assert.match(view, /id="cbfAnon"/);
  assert.match(view, /id="cbfAuthor"/);
  assert.match(view, /api\.editPost\(p\.id, \{/);
  assert.match(view, /api\.moderatePost\(p\.id, !p\.is_hidden\)/);
  assert.match(view, /api\.deletePost\(p\.id\)/);
  // Deleting is destructive: it must go through a danger confirmation first.
  assert.match(view, /confirmDialog\(\{[\s\S]*?danger: true/);
  assert.match(view, /confirmText: 'Delete post'/);
});

test('the view keeps the public wall filters: All, Requests, Testimonies, Praise', () => {
  for (const label of ["key: 'all', label: 'All'", "key: 'prayer', label: 'Requests'", "key: 'testimony', label: 'Testimonies'", "key: 'praise', label: 'Praise'"]) {
    assert.ok(view.includes(label), `missing filter tab ${label}`);
  }
  // Hidden posts stay manageable instead of disappearing from admin.
  assert.match(view, /key: 'hidden', label: 'Hidden'/);
  assert.match(view, /filters\.status === 'hidden'/);
});

test('the admin portal routes and links to the new section', () => {
  assert.match(adminApp, /path: \/\^\\\/community\$\/, view: renderCommunity, nav: 'community', perm: 'settings:manage'/);
  assert.match(adminApp, /navLink\('#\/community', 'community', 'Community board', 'inbox'\)/);
  assert.match(adminApi, /'editPost','deletePost'/);
});

test('Settings points to the Community board instead of duplicating moderation', () => {
  assert.match(settings, /href="#\/community"/);
  assert.doesNotMatch(settings, /moderationList/);
  assert.doesNotMatch(settings, /moderatePost/);
});

test('admin assets are cache-busted at a version that includes the section', () => {
  const version = server.match(/ADMIN_ASSET_VERSION='(\d+\.\d+\.\d+)'/)?.[1];
  const [a, b, c] = (version || '0.0.0').split('.').map(Number);
  const atLeast = a > 2 || (a === 2 && (b > 4 || (b === 4 && c >= 5)));
  assert.ok(atLeast, `ADMIN_ASSET_VERSION=${version} must be >= 2.4.5`);
});
