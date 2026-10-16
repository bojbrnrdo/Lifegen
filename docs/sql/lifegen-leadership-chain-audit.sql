-- Read-only LIFEGEN leadership-chain audit.
-- A Cell Leader may be a 'leader' member in an upstream Cell. This is not
-- a duplicate Cell membership or reason to change classification.
SELECT m.person_id,m.lifegroup_id AS upstream_cell_id,m.role AS membership_role,
       g.leader_person_id AS upstream_cell_leader,
       led.id AS managed_cell_id,led.network_id AS managed_network_id,
       CASE
         WHEN m.person_id=g.leader_person_id THEN 'SELF_MEMBERSHIP_REVIEW'
         WHEN m.role<>'leader' THEN 'CELL_LEADER_MEMBERSHIP_ROLE_REVIEW'
         WHEN g.network_id IS DISTINCT FROM led.network_id THEN 'CROSS_NETWORK_LEADERSHIP_REVIEW'
         ELSE 'VALID_UPSTREAM_LEADER_MEMBERSHIP'
       END AS audit_result
FROM public.lifegroup_memberships m
JOIN public.lifegroups g ON g.id=m.lifegroup_id
JOIN public.lifegroups led ON led.leader_person_id=m.person_id AND led.is_active
WHERE m.left_at IS NULL ORDER BY m.person_id,led.id;
