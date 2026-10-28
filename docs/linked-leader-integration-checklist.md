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

## Execution status

The automated unit/regression suite and build are necessary but not sufficient. Real authenticated integration testing is **not executed** by this checklist. Run it only after local PostgreSQL and disposable accounts are available. Keep PR #134 in draft until all checks pass.

## Safari browser gate

Safari 26.5 was present on the Mac, but safaridriver rejected an automation session because **Allow Remote Automation** was disabled. This is an outstanding browser test, not a Safari compatibility pass. To enable a future local run, open Safari → Settings → Developer, enable **Allow Remote Automation**, then repeat sign-in, My Lifegroups directory, restricted Person profile, profile back navigation, and mobile-width sidebar checks. Do not alter Safari's security settings as part of unattended tests.
