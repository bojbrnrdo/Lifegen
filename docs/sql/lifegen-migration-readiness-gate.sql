-- LIFEGEN: PRE-MIGRATION READINESS GATE (READ-ONLY)
-- Returns blockers and follow-up items. Does not change any records.
WITH facts AS (
 SELECT
 (SELECT count(*) FROM public.people p WHERE p.archived_at IS NULL AND
   EXISTS(SELECT 1 FROM public.networks n WHERE n.leader_person_id=p.id AND n.is_active) AND
   EXISTS(SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active)) AS dual_leaders,
 (SELECT count(*) FROM public.people p WHERE p.archived_at IS NULL AND
   coalesce(p.extras->>'discipleship_classification','')='') AS missing_classifications,
 (SELECT count(*) FROM public.lifegroups WHERE is_active AND leader_person_id IS NULL) AS unled_cells,
 (SELECT count(*) FROM public.networks WHERE is_active AND leader_person_id IS NULL) AS unled_networks,
 (SELECT count(*) FROM (
   SELECT person_id FROM public.lifegroup_memberships WHERE left_at IS NULL
   GROUP BY person_id HAVING count(*)>1
 ) d) AS duplicate_active_memberships
)
SELECT 'dual_network_cell_leadership' AS check_name,dual_leaders AS affected,
       CASE WHEN dual_leaders>0 THEN 'BLOCKED_REQUIRES_POLICY_DECISION' ELSE 'PASS' END AS result FROM facts
UNION ALL SELECT 'missing_classifications',missing_classifications,
       CASE WHEN missing_classifications>0 THEN 'MANUAL_RECONCILIATION' ELSE 'PASS' END FROM facts
UNION ALL SELECT 'active_unled_cells',unled_cells,
       CASE WHEN unled_cells>0 THEN 'REVIEW_PLACEHOLDERS' ELSE 'PASS' END FROM facts
UNION ALL SELECT 'active_unled_networks',unled_networks,
       CASE WHEN unled_networks>0 THEN 'REVIEW_PLACEHOLDERS' ELSE 'PASS' END FROM facts
UNION ALL SELECT 'duplicate_active_memberships',duplicate_active_memberships,
       CASE WHEN duplicate_active_memberships>0 THEN 'BLOCKED_INTEGRITY' ELSE 'PASS' END FROM facts;
