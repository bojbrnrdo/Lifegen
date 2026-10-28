# Proposed pull request: Add LifeIDE workspace and local repository editing

**Source:** `feature/lifeide-workspace`  
**Target:** `main` (confirm current upstream branch and rebase/conflicts immediately before opening)

## Summary

Add LifeIDE, a responsive browser-based editor in the LifeGen design language, with browser-local files and an explicitly enabled, administrator-only local repository mode.

## Changes

- New LifeIDE web UI: file tree, tabs, editing, browser-local persistence, and mobile layouts.
- Local-only repository API for tree browsing, UTF-8 file reads, version-checked saves, new files/folders, Git status/diff, and selected-file commits.
- Repository editing stays disabled unless `LIFEIDE_LOCAL_EDIT=true` in a non-production/non-hosted environment.
- Git operations do not push, merge, or deploy. Local commits are restricted to feature branches.
- Automated API/security tests, Chrome desktop/mobile browser tests, and optional database-backed real-admin browser acceptance mode.
- Release review checklist with test coverage and operational restrictions.

## Verification

- `npm test` — 220 tests passed at review.
- `npm run test:lifeide-browser` — local and repository modes, Git commit, stale-save conflict, cancel/discard behavior, and 320px/390px layouts passed.
- Opt-in real-admin browser mode was successfully run using a disposable loopback PostgreSQL database and temporary Git repository.
- `npm run build` and `git diff --check origin/main...HEAD` passed.

## Reviewer checklist

- [ ] Verify repository editing is inaccessible in production and hosted previews.
- [ ] Confirm the admin-only permission boundary, Origin/CSRF protection, path restrictions, and Git scope.
- [ ] Review how concurrent writes and filesystem races are handled; this local-only editing API does not guarantee protection against a malicious concurrent filesystem actor.
- [ ] Check manual cross-browser behavior, keyboard navigation and narrow-screen usability.
- [ ] Refresh upstream refs, check for merge conflicts, and repeat checks before merge.
- [ ] Explicitly approve merge/deployment separately; do **not** enable repository editing on production.

## Not included

No production database migration, hosted source-code editing, Git push, merge, or deployment.
