# LIFEGEN People workflows — release review

Branch: `feature/people-workflows-reorganization`. Pull request: #51.

## Architecture
- `people` remains the canonical record; all modules use the existing Supabase PostgreSQL-backed API.
- Discipleship classification is stored in the existing `people.extras.discipleship_classification` JSONB field, separate from `people.status` and `staff_users` permissions. Changes are authorized and written to `audit_log`.
- The optional normalized schema in `docs/proposed-people-classification-migration.md` is **not** included in the automated `database/` runner and **must not** be applied without approval.
- Public and staff VIP registrations create a VIP record linked to People, then attempt guarded assignment. If none is possible, they remain in Needs Cell.
- Automatic matching is gender-compatible, capacity-aware, deterministic and configurable. Actual assignment uses existing transactional `assignMember`, with person and Cell row locks and membership audit.
- Existing attendance, membership and VIP prize records remain in their canonical tables.

## Validation commands (isolated environment)
1. `npm ci`
2. `npm run build` (includes React Flow bundle and asset checks)
3. `node --test tests/lifegroup-match.test.mjs`
4. `npm test` with a correctly provisioned non-production database.
5. Verify all 36 acceptance scenarios in the original LIFEGEN prompt, including narrow/mobile viewports.

## Manual scenario matrix
- People expands, highlights Lifegroups / Attendance / Registration and remains accessible to keyboard users.
- Registered Network Leaders, Cell Leaders, Members and VIPs appear under the same People ID; existing-person reuse does not create duplicates.
- VIP public and staff signups preserve recovery, gifts, check-ins, Sunday's attendance, People profile and follow-up records.
- Two simultaneous signups under limited Cell capacity never exceed 12 members or close a second active membership.
- No gender match, missing gender, inactive leader, unled group, full Cell or no eligible Cell yields Needs Cell without lost registration.
- Changing assignment priorities changes deterministic matching while leaving existing memberships unchanged.
- Network and Cell leadership changes preserve prior audit and relationship history.
- Classification transitions preserve People identity and attendance without granting staff permissions; invalid leadership transitions are refused.
- Deactivating Members/VIPs closes active memberships without erasing histories; active leaders must be reassigned before deactivation.
- Sunday and Cell meeting attendance read and write only their existing records, and filtered links return correctly to Lifegroups.
- No global Find a Person, no duplicate React Flow search or duplicate top-level menu entries.
- Verify circular nodes, connection lines, zoom, keyboard navigation, modals, and responsive layout on desktop/tablet/mobile.

## Current QA limitations
Only syntax-level source checks and isolated deterministic matcher checks were executed through the available connector. The complete Node build, PostgreSQL integration suite, rendered browser QA, and simultaneous registration tests have not yet been executed. GitHub Actions workflow `.github/workflows/lifegen-validation.yml` has been committed to automate build and matching tests; do not report it passing unless a successful run is visible.

## Production release gate
Do not merge or deploy until:
- required CI checks are green,
- test database migration/relationship integrity and public VIP workflows have passed,
- deployment environment is confirmed to use the intended Supabase project `kmcvszqkrnzhexbdbbig`,
- a production backup and rollback plan are verified,
- explicit production deployment approval is received.
