# Proposed LIFEGEN leadership rule — decision record

**Status: PROPOSED; not yet user-approved.** No production migration or role change is authorized by this file.

## Recommended model
- Each person has one **primary discipleship classification**: `network_leader`, `cell_leader`, `member`, or `vip`.
- A Network Leader may also temporarily lead a Cell **inside their own Network**. This is a secondary operational assignment and does not change their primary classification from Network Leader.
- A Cell Leader who does not lead a Network has primary classification Cell Leader.
- People with an active Cell membership are not automatically Members: VIP and Member distinction requires verified registration/promotion evidence.
- No active unled Network or Cell is eligible for automatic VIP assignment. Incomplete groups need a distinct operational readiness state (initially inferred by leader presence; do not alter current `is_active` silently).

## Application compatibility work required before rollout
Current `setDiscipleshipClassification` and Cell autoassignment logic treat simultaneous Network/Cell leadership as a conflict. Before adopting the proposed model, adjust this safely: permit network_leader as primary with a secondary active Cell leadership only if `lifegroups.network_id` belongs to a Network they actively lead. Prevent primary downgrade while either leadership remains. Audit every leadership reassignment and verify permission checks.

## Migration guardrails
Do not classify ambiguous records automatically. Only backfill role values when corresponding leadership relationships satisfy the approved policy. Retain historical attendance and VIP registrations; do not rename or reuse `people.status` as discipleship classification. Test on a database restore and run read-only readiness checks before approval for production.
