-- LIFEGEN VIP auto-assignment structural eligibility (READ ONLY).
-- Actual placement additionally checks gender, preferences, capacity and transaction state.
SELECT g.id AS cell_id,g.network_id,
 CASE
  WHEN NOT g.is_active THEN 'INELIGIBLE_INACTIVE_CELL'
  WHEN g.is_demo THEN 'INELIGIBLE_DEMO_CELL'
  WHEN g.leader_person_id IS NULL THEN 'INELIGIBLE_UNASSIGNED_LEADER'
  WHEN p.id IS NULL OR p.archived_at IS NOT NULL OR p.status='inactive' THEN 'INELIGIBLE_LEADER'
  WHEN n.id IS NULL OR NOT n.is_active THEN 'INELIGIBLE_INACTIVE_OR_MISSING_NETWORK'
  WHEN n.is_demo THEN 'INELIGIBLE_DEMO_NETWORK'
  WHEN n.gender<>g.gender THEN 'INELIGIBLE_GENDER_MISMATCH'
  WHEN EXISTS(SELECT 1 FROM public.networks other
    WHERE other.leader_person_id=g.leader_person_id AND other.is_active AND other.id<>g.network_id)
    THEN 'INELIGIBLE_CROSS_NETWORK_LEADERSHIP'
  ELSE 'STRUCTURALLY_ELIGIBLE_NEEDS_CAPACITY_AND_PREFS_CHECK' END AS assessment
FROM public.lifegroups g
LEFT JOIN public.networks n ON n.id=g.network_id
LEFT JOIN public.people p ON p.id=g.leader_person_id
ORDER BY g.id;