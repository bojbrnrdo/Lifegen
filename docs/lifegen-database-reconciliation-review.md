# LIFEGEN database reconciliation — review before migration

Audit date: 2026-10-17 (Philippine time). Supabase project `kmcvszqkrnzhexbdbbig`.
**Read-only analysis. No production data or schema mutated.**

## Observed state
- 6 People records; all 6 lack `people.extras.discipleship_classification`.
- 4 active Networks, 3 without a leader.
- 4 active Cells, 2 without a leader. Those unled Cells have no active memberships.
- One person leads both an active Network and an active Cell (person ID 3); this is incompatible with the four exclusive user-facing classifications unless leadership hierarchy is explicitly resolved.
- Two distinct active leaders lack classification.
- 3 membership records overall; no duplicate active memberships found.
- No VIP registrations, Sunday services, or attendance records yet.

## Decisions requiring a human
1. Confirm whether active unled Networks/Cells are intended placeholders, should receive a designated leader, or should be deactivated. Do not automatically appoint someone.
2. Resolve dual leadership for person ID 3: either transfer the Cell leadership, or explicitly specify a rule permitting a Network Leader to lead a Cell. Current classification logic disallows simultaneous roles; avoid blindly backfilling.
3. Determine Member versus VIP classification for ordinary People from verified registration history or staff review, not from absent values alone.
4. Decide whether classifications should remain in `people.extras` or become normalized typed database fields in a dedicated future migration. Keep existing application read/write paths compatible.

## Safe remediation sequence
- Back up the current production database and verify a restore to a separate environment.
- Resolve leader ownership and placeholder state manually in staging first.
- Draft **idempotent, guarded** classification backfill for unambiguous records; report ambiguous rows without changing them.
- Add/check constraints for a single active membership per person, foreign keys, compatible gender/roles, and uniqueness of leadership assignments only after evaluating existing data.
- Apply migration only after approval and successful staging integration tests.
- Rerun `docs/sql/lifegen-readonly-reconciliation-audit.sql`; verify no unexpected record loss and registration/attendance flows.

**Warning:** Do not put SQL migrations into `database/` until the release is explicitly approved: `scripts/migrate.mjs` may run SQL at build/deploy time. This is a review document, not migration authorization.
