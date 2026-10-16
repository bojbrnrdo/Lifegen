-- LIFEGEN classification reconciliation queue; read-only and non-destructive.
-- No Member/VIP classification is inferred from membership alone.
SELECT p.id AS person_id,
 NULLIF(p.extras->>'discipleship_classification','') AS existing_classification,
 CASE
  WHEN EXISTS(SELECT 1 FROM public.networks n WHERE n.leader_person_id=p.id AND n.is_active)
   THEN 'network_leader'
  WHEN EXISTS(SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active)
   THEN 'cell_leader'
  ELSE NULL END AS evidence_based_leader_candidate,
 CASE
  WHEN NULLIF(p.extras->>'discipleship_classification','') IS NOT NULL THEN 'verify_existing_classification'
  WHEN EXISTS(SELECT 1 FROM public.networks n WHERE n.leader_person_id=p.id AND n.is_active)
   THEN 'review_network_leader_primary'
  WHEN EXISTS(SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active)
   THEN 'review_cell_leader_primary'
  WHEN EXISTS(SELECT 1 FROM public.lifegroup_memberships m WHERE m.person_id=p.id AND m.left_at IS NULL)
   THEN 'review_member_or_vip_registration_evidence'
  ELSE 'manual_review_no_role_evidence' END AS review_action
FROM public.people p WHERE p.archived_at IS NULL ORDER BY p.id;
