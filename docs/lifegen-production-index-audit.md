# LIFEGEN production database index audit (read-only)

Inspected `pg_indexes` for `people`, `networks`, `lifegroups`, `lifegroup_memberships`, and `vip_registrations`. No schema changes made.

## Existing integrity safeguards verified
- `lifegroup_memberships_current_person_unique`: unique `person_id` while `left_at IS NULL`; already prevents duplicate simultaneous active memberships.
- `networks_active_leader_unique`: prevents one person leading multiple active Networks.
- `people_person_code_key`: People codes unique.
- `vip_registrations_service_person_uniq`: one record per `(service_date,person_id)` when a service date exists.
- `vip_registrations_service_identity_uniq`: enforces service-day name/inviter identity uniqueness; assess false collisions when planning future registration changes.

## Review before any migration
- There is no observed unique index on active `lifegroups.leader_person_id` (only a nonunique leader index); role multiplicity is currently an application-policy decision, not a database-enforced invariant.
- No observed unique `vip_registrations.person_id` index across all time; this may be intentional because VIP history can span service dates. **Do not add** a blanket unique index without understanding intended history.
- Discipleship classification currently resides in `people.extras`; no index or constraint on that JSON field was observed. Confirm policy and run reconciliation before introducing one.
- The five incomplete groups remain business review items, not grounds for auto-deletion.

**No production migration authorization implied.** Verify the full constraint catalog and run staging tests before proposing any DDL.

## Confirmed database constraints (pg_constraint)
- `lifegroups.network_id` references `networks.id` with `ON DELETE RESTRICT`; `lifegroups.leader_person_id` references People with `ON DELETE SET NULL`. Neither foreign key enforces whether parent Network is **active** or led.
- `lifegroup_memberships.lifegroup_id` is restricted from deletion while referenced. Its `person_id` reference uses `ON DELETE CASCADE`: a hard-delete of a person can erase membership history. Prefer archive flows and verify deletion policies.
- Active-membership uniqueness is provided by the partial unique **index**, not a named `pg_constraint`; do not mistake its absence from `pg_constraint` for missing protection.
- Membership `role` can be `member`, `leader`, or `assistant`; `tier` can be `solid` or `new`. These are **not** the same as the primary four discipleship classifications.
- `people.status` independently allows `first_timer`, `new_believer`, `regular`, `member`, `leader`, `volunteer`, `inactive`. Do **not** overwrite it as a substitute for the proposed four-way classification.
- `vip_registrations.service_date` is constrained to Sundays when present, and review status is `new` or `reviewed`. The registration workflow must preserve these rules; any change to other worship days needs a separately approved schema decision.
- The `vip_registrations.person_id` foreign key is `DEFERRABLE INITIALLY DEFERRED`, so test any staging transaction at commit, not only before commit.

### Gaps not enforceable with the listed row checks alone
The inspected constraints do not enforce a Network being active before its Cell is active, or require leaders on active Networks/Cells. These are currently guarded by application validation and should be covered in integration tests. Database-level enforcement would require a separately reviewed design, not an automatic check-constraint addition.

## Expanded People deletion impact (verified foreign keys)
Hard deletion of a Person invokes `ON DELETE CASCADE` on `lifegroup_memberships`, `lifegroup_meeting_attendance`, `records` (service attendance), `vip_registrations`, and `vip_gift_handouts`. Network/Cell leadership foreign keys instead set the leader ID to NULL, potentially leaving leaderless active structures. `audit.person_id` also becomes NULL, reducing person-level audit traceability. These are **database-enforced effects**, regardless of UI permission checks.

**Safety requirement:** Retain archive/restore as normal business flows; do not authorize irreversible Person hard deletion solely because the People tab has a delete action. Review the actual backend deletion handler and data-retention policy before changing its behavior. Use `docs/sql/lifegen-person-deletion-impact-preview.sql` for a read-only, per-person preflight; the example person ID is a placeholder, not a live deletion target. No migration is authorized.
