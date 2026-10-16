-- LIFEGEN: classification reconciliation PREVIEW ONLY.
-- READ-ONLY. No inserts, updates, deletes, or schema changes.
-- Classification is separate from attendance status.
WITH evidence AS (
 SELECT p.id AS person_id,
        nullif(p.extras->>'discipleship_classification','') AS existing_classification,
        EXISTS (SELECT 1 FROM public.networks n WHERE n.leader_person_id=p.id AND n.is_active) AS leads_network,
        EXISTS (SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active) AS leads_cell,
        EXISTS (SELECT 1 FROM public.vip_registrations v WHERE v.person_id=p.id) AS has_vip_registration,
        EXISTS (SELECT 1 FROM public.lifegroup_memberships m WHERE m.person_id=p.id AND m.left_at IS NULL) AS has_active_membership
 FROM public.people p WHERE p.archived_at IS NULL
), recommendations AS (
 SELECT *,
 CASE
  WHEN existing_classification IS NOT NULL THEN existing_classification
  WHEN leads_network AND leads_cell THEN NULL
  WHEN leads_network THEN 'network_leader'
  WHEN leads_cell THEN 'cell_leader'
  WHEN has_vip_registration AND NOT has_active_membership THEN 'vip'
  WHEN has_active_membership AND NOT has_vip_registration THEN 'member'
  ELSE NULL
 END AS proposed_classification,
 CASE
  WHEN existing_classification IS NOT NULL THEN 'already_classified_review_for_consistency'
  WHEN leads_network AND leads_cell THEN 'manual_review_dual_leadership'
  WHEN leads_network THEN 'candidate_network_leader'
  WHEN leads_cell THEN 'candidate_cell_leader'
  WHEN has_vip_registration AND has_active_membership THEN 'manual_review_vip_and_membership'
  WHEN has_vip_registration THEN 'candidate_vip_verify_conversion_history'
  WHEN has_active_membership THEN 'candidate_member_verify_registration_history'
  ELSE 'manual_review_no_role_evidence'
 END AS review_reason
 FROM evidence
)
SELECT person_id,existing_classification,leads_network,leads_cell,has_vip_registration,
       has_active_membership,proposed_classification,review_reason
FROM recommendations ORDER BY person_id;
