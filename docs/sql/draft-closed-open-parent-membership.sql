-- APPLIED to LIFEGEN Supabase project kmcvszqkrnzhexbdbbig on 2026-10-17.
-- Kept in repository for review/audit; do not rerun on this database.
-- Additive schema for Network → Cell Leader → Closed Cell → Open Cell.
-- Existing memberships preserved; application rollout still requires tests and approval.
-- Before enabling writes, backend must enforce cross-row rules transactionally.
ALTER TABLE public.lifegroup_memberships
  ADD COLUMN parent_membership_id bigint NULL;
ALTER TABLE public.lifegroup_memberships
  ADD CONSTRAINT lifegroup_membership_parent_fk
  FOREIGN KEY (parent_membership_id)
  REFERENCES public.lifegroup_memberships(id)
  ON DELETE RESTRICT;
ALTER TABLE public.lifegroup_memberships
  ADD CONSTRAINT lifegroup_membership_not_self_parent
  CHECK (parent_membership_id IS NULL OR parent_membership_id <> id);
ALTER TABLE public.lifegroup_memberships
  ADD CONSTRAINT lifegroup_parent_requires_open_tier
  CHECK (parent_membership_id IS NULL OR tier = 'new');
CREATE INDEX lifegroup_memberships_parent_idx
  ON public.lifegroup_memberships(parent_membership_id)
  WHERE parent_membership_id IS NOT NULL;

-- Deliberately no backfill: legacy 'new' memberships must NOT be
-- automatically attached to an arbitrary 'solid' membership.
-- Rollout is initially nullable for backward compatibility.
-- Application validation must require that assigned Open Cell children have:
--  * tier='new', parent tier='solid',
--  * same lifegroup_id,
--  * active parent and child memberships,
--  * distinct person_id values,
--  * authorized administrator and audited relationship changes.
-- A row CHECK cannot validate another row's tier; avoid pretending
-- this migration alone is sufficient.
