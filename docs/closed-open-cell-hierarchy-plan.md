# LIFEGEN — Closed Cell → Open Cell hierarchy (implementation plan)

Status: proposed, review-only. This branch does not modify the production database.

## Confirmed hierarchy
Network Leader → Cell Leader → Closed Cell Member → Open Cell Member.

Current schema uses `lifegroup_memberships.tier` values `solid` (Closed Cell) and `new` (Open Cell). The active membership table has no parent membership reference, so tier alone cannot identify which Closed Cell Member supervises each Open Cell Member.

## Proposed additive schema migration (NOT APPLIED)
Add nullable `parent_membership_id bigint` referencing `lifegroup_memberships(id)` with `ON DELETE RESTRICT`, plus an index. Initially leave all existing rows unchanged. A nullable column allows legacy assignments to remain valid until they are verified and assigned by authorized staff.

Before implementation, review whether Closed Cell members need to be able to supervise multiple Open Cell members, and whether VIPs awaiting assignment should stay in the Needs Cell queue. Proposed default: one active parent per active Open Cell membership; each Closed Cell parent may supervise multiple Open Cell memberships; unparented existing Open Cell memberships appear under an explicit Needs Parent grouping, never as fabricated relationships.

## Backend invariants (transactionally enforced)
- Only an active Open Cell membership (`tier='new'`) can have an active parent; parent must be a different active membership (`tier='solid'`).
- Parent and child belong to the same `lifegroup_id`; persons must differ.
- On assignment or transfer lock both memberships and relevant group rows before updating; reject archived/inactive people and closed/inactive groups as policy requires.
- Prevent parent changes if a parent is demoted, moved, ended or archived until their Open Cell children are reassigned or moved into Needs Parent. Preserve prior links in an audit trail.
- Verify leadership paths from the active Cell to its Network; never infer parents from tier or ordering.
- API reads return member IDs, tier and parent membership IDs; enforce RBAC for changes.
- VIP registration and VIP status remain independent of these two tiers. Automatic VIP Cell placement must not silently choose an Open Cell parent absent an explicit documented rule.

## UI
Render circular nodes for Network Leader → Cell Leader → Closed Cell → Open Cell. Click to expand/collapse children. Show unattached active Open Cell members in a clearly identified Needs Parent queue, not beneath an arbitrary Closed Cell member. Preserve All People search, contextual profiles, and Attendance links.

## Release gates
1. Verify migration compatibility and production database identity (Supabase project `kmcvszqkrnzhexbdbbig`).
2. Obtain explicit approval before applying schema changes or reassigning existing records.
3. Validate constraints and transaction behavior on isolated staging data.
4. Add tests for ordinary assignment, duplicate parent, cross-Cell parent, wrong tier, self-parent, parent deactivation, transfer, archiving, concurrency, VIP and historic attendance integrity.
5. Run full automated tests and UI tests. Prepare a reviewed PR before any merge or deployment.

## Read-only preflight SQL
```sql
SELECT tier, count(*)::int AS memberships
FROM public.lifegroup_memberships
WHERE left_at IS NULL
GROUP BY tier ORDER BY tier;
```
