-- PROPOSED DATA MIGRATION; NOT APPROVED FOR PRODUCTION EXECUTION.
-- Keep outside database/ because the application automatically runs those scripts.
-- Run in a restored STAGING database only after verifying a backup.
-- The three candidates are gated by live relationships and absent classification.
BEGIN;
DO $$
DECLARE problems integer;
BEGIN
  -- Do not silently resolve dual leadership or ambiguous People records.
  SELECT count(*) INTO problems FROM public.people p WHERE p.archived_at IS NULL
    AND EXISTS (SELECT 1 FROM public.networks n WHERE n.leader_person_id=p.id AND n.is_active)
    AND EXISTS (SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active);
  IF problems > 0 THEN
    RAISE EXCEPTION 'Stop: % person(s) have concurrent active Network and Cell leadership. Resolve before production migration.',problems;
  END IF;
END $$;

-- Deliberately does NOT classify People with no reliable role evidence.
-- The update is conditional and idempotent; no assumptions are made about VIPs.
WITH candidates AS (
  SELECT p.id, CASE
    WHEN EXISTS (SELECT 1 FROM public.networks n WHERE n.leader_person_id=p.id AND n.is_active)
      THEN 'network_leader'
    WHEN EXISTS (SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active)
      THEN 'cell_leader'
    ELSE NULL END AS classification
  FROM public.people p
  WHERE p.archived_at IS NULL
    AND coalesce(p.extras->>'discipleship_classification','')=''
)
UPDATE public.people p
SET extras=jsonb_set(coalesce(p.extras,'{}'::jsonb),'{discipleship_classification}',
  to_jsonb(c.classification),true),updated_at=now()
FROM candidates c
WHERE p.id=c.id AND c.classification IS NOT NULL
  AND coalesce(p.extras->>'discipleship_classification','')='';

-- Member and VIP status must be reviewed individually. An active membership
-- alone is not reliable evidence of VIP-to-Member transition.
-- Check updated rows and the read-only audit before choosing COMMIT.
-- The script ends in ROLLBACK intentionally; no data persists even in staging.
ROLLBACK;
