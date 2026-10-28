# Linked leader release gate (draft PR #134)

## Test environment — mandatory

- Use an isolated, disposable **local** PostgreSQL database, never production or Supabase production credentials.
- Apply all migrations through `database/011_staff_people_link.sql` to the isolated database only.
- Create distinct fixture accounts: administrator; unlinked Staff; Network Leader linked to an active Person; Cell Leader linked to an active Person; linked but unassigned Staff; and linked archived/inactive Person.
- Create two unrelated Networks and multiple Cells with non-overlapping People. Preserve separate Person IDs, including duplicate names.
- Use a local HTTP server, a real browser session, and separate account sign-ins. Record browser and viewport for each result.
- Do not merge or deploy if any linked user can read or mutate out-of-scope People or Cells.

## Authenticated checks

- [ ] Administrator sign-in and unrestricted existing workflow remain functional.
- [ ] Unlinked Staff still follows legacy permission checks.
- [ ] Network Leader sees only assigned Network, its active Cells and members.
- [ ] Cell Leader sees only personally led active Cells; parent Network and other Cells are denied.
- [ ] Linked account without active assignment sees an empty scoped directory, never global records.
- [ ] Linked account with archived/inactive/missing Person cannot inherit legacy access.
- [ ] Inactive Staff account cannot access scoped or legacy tracker APIs.
- [ ] Direct API requests with missing, malformed, or out-of-scope IDs return 403.
- [ ] Cross-network Person profile, assignment, removal and tier updates are blocked.
- [ ] Leadership memberships cannot be removed or reclassified by linked leaders.
- [ ] Assigned member operations work and preserve membership history.
- [ ] Global search, dashboard, reports exports, backup and VIP Design administrative routes reject linked accounts.
- [ ] Pagination, invalid pages, last-page recovery and refresh work with 101+ scoped members.
- [ ] Sign-in, browser back/forward, direct URLs and mobile navigation stay inside scoped views.
- [ ] Test desktop and mobile layouts; verify no personal information appears in console logs.

## Execution status (local only)

- [x] Isolated loopback PostgreSQL migration applied and replayed successfully (`node tests/leader-migration-local.mjs`).
- [x] Authenticated local API checks: cross-Network visibility, in-scope membership mutations, blocked leadership mutations, protected Person fields, and inactive account revocation (`node tests/leader-http-local.mjs`).
- [x] Chrome desktop 1440px and mobile-width 390px: linked Cell Leader sign-in, scoped directory, Person profile privacy and back navigation. Mobile sidebar open/dismiss and overflow checks (`LIFEGEN_BROWSER_TEST=1`).
- [x] Safari 26.5 desktop: authenticated Cell Leader sign-in, scoped directory and restricted Person profile (`LIFEGEN_SAFARI_TEST=1`, with safaridriver on loopback port 55435).
- [x] Safari 26.5 at mobile-width 390px: no page-level overflow and sidebar opens/closes.
- [x] Automated suite (333 tests at 3625d93) and production build.
- [ ] Complete the remaining individual checklist items not explicitly covered above, including administrator and unlinked Staff browser regression, 101+ members, malformed inputs and all auxiliary routes.
- [ ] Physical iPhone/Android touch-device verification; desktop Safari resized to 390px is not iOS Safari.
- [ ] Deployment approval and production migration/rollback planning.

**Runbook (isolated local database only):** Set `LIFEGEN_INTEGRATION_DATABASE_URL` to a loopback PostgreSQL URL. Run `node tests/leader-migration-local.mjs`, `node tests/leader-http-local.mjs`, and the same HTTP test with `LIFEGEN_BROWSER_TEST=1` (Chrome/optional playwright-core) or `LIFEGEN_SAFARI_TEST=1` (Safari and local safaridriver). Run `npm test` and `npm run build`. Never use production credentials for these tests. Do not merge or deploy until all remaining gates are completed.
