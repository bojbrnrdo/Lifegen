# LIFEGEN — People archive/restore staging verification

**Review-only checklist. Do not run against production.** Use a separate staging Supabase project containing synthetic People, Cells, service attendance, and VIP registration records. Never copy identifiable production People or VIP records into staging without an approved data-handling process.

## Preconditions
- Staging application points exclusively to staging database.
- Test admin has `people:delete`; restricted operator has `people:write` but not `people:delete`.
- Create a synthetic Person with one membership, service attendance record, lifegroup meeting attendance record, VIP registration and, if available, gift handout. Record IDs and counts.
- Create an unrelated Person as a control.

## Verification matrix
1. **Authorized Archive:** Archive synthetic Person from the profile. Verify `archived_at` set, and membership, VIP and attendance rows plus historical reports are unchanged.
2. **Authorized Restore:** Restore. Verify `archived_at` cleared, identity and previous records retained, no duplicate People or registrations.
3. **Restricted operator:** `people:write` only must not see Archive/Restore. Attempting those actions directly through API must be forbidden by RBAC; normal status changes may remain available.
4. **Permanent deletion endpoint:** Authorized administrator attempting legacy `deletePerson` receives HTTP 409 and no People, attendance, audit, membership, VIP or gift rows change.
5. **Missing Person:** Attempting delete of a nonexistent Person returns HTTP 404 and does not mutate other records.
6. **State synchronization:** In tests, a removed Person in the proposed snapshot must cause HTTP 409 before any SQL statement is issued.
7. **Control Person:** Confirm all unrelated People and linked data remain unchanged.
8. **UI:** Person profile offers Archive and Restore as appropriate, never Delete permanently.

## Read-only verification template
Replace the placeholder ID in `docs/sql/lifegen-person-deletion-impact-preview.sql` **only on staging**, and run before and after the above steps. Record totals for each related table. For archive and restore, verify the counts stay equal; for delete rejection, also verify the People record remains present.

## Release criteria
- Automated CI and security checks are green.
- Staging test results and evidence reviewed by a maintainer.
- API permission enforcement observed, not inferred solely from hidden UI controls.
- Separately approve merging PR and deploying production. No production database migration is implied.
