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
