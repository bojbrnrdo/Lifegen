import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { networkLeaderRegistrationHtml } from '../public/admin/js/views/networkLeaderRegistration.js';

const lifegroupView = readFileSync(new URL('../public/admin/js/views/lifegroups.js', import.meta.url),'utf8');
const networkUI = readFileSync(new URL('../public/admin/js/views/networkDetailUI.js', import.meta.url),'utf8');
const helper = readFileSync(new URL('../public/admin/js/views/networkLeaderRegistration.js', import.meta.url),'utf8');
const icons = readFileSync(new URL('../public/admin/js/ui.js', import.meta.url),'utf8');

test('Network Leader registration uses its own form with consent and a duplicate guard', () => {
  const markup = networkLeaderRegistrationHtml();
  assert.match(markup, /id="netRegisterPanel"/);
  assert.match(markup, /id="netRegisterForm"/);
  assert.match(markup, /id="netRegFirst"/);
  assert.match(markup, /id="netRegLast"/);
  assert.match(markup, /id="netRegConsent"/);
  assert.match(helper, /duplicateGuard\(data, duplicates\)/);
  assert.match(helper, /api\.createPerson\(data\)/);
  assert.match(helper, /privacy_consent: true/);
  assert.match(helper, /status: 'leader'/);
  assert.match(helper, /onRegistered\(\{ id: person\.id/);
});

test('Network form links a selected Person ID and prevents manual name from faking registration', () => {
  assert.match(lifegroupView, /id="netLeaderId" name="leader_person_id"/);
  assert.match(lifegroupView, /id="netLeaderPickResults"/);
  assert.match(lifegroupView, /networkLeaderRegistrationHtml\(\)/);
  assert.match(lifegroupView, /bindNetworkLeaderRegistration\(modal,/);
  assert.match(lifegroupView, /Select an existing registered person from the search results/);
  assert.match(lifegroupView, /data\.leader_person_id = personId\.value \|\| null/);
  assert.match(lifegroupView, /data\.leader_name = data\.leader_person_id \? null/);
  assert.match(lifegroupView, /explicitlyCleared/);
});

test('Network category change clears stale leader search and requires a new selection', () => {
  assert.match(lifegroupView, /personPick\.value\.trim\(\)/);
  assert.match(lifegroupView, /pickerResults\.hidden = true/);
  assert.match(lifegroupView, /Network category changed\. Choose an eligible leader again/);
});

test('Category symbols are accessible without exposing Boys and Girls text on the cards', () => {
  assert.match(icons, /mars: '<circle/);
  assert.match(icons, /venus: '<circle/);
  assert.match(lifegroupView, /gbadge--icon/);
  assert.match(lifegroupView, /aria-label="Boys network"/);
  assert.match(lifegroupView, /aria-label="Girls network"/);
  assert.match(lifegroupView, /data-gender-filter="boys"/);
  assert.match(lifegroupView, /data-gender-filter="girls"/);
  assert.match(lifegroupView, /aria-pressed/);
});

test('Unregistered Network Leaders have a permission-gated link action', () => {
  assert.match(networkUI, /if \(!leaderRegistered\) quickButton\('netLinkLeader'/);
  assert.match(lifegroupView, /main\.querySelector\('#netLinkLeader'\)/);
  assert.match(lifegroupView, /leaderRegistered: Boolean\(n\.leader_person_id\)/);
});
