-- LIFEGEN classification and relationship integrity audit. READ ONLY.
SELECT 'classification_mismatch' issue,p.id::text entity FROM public.people p
WHERE p.archived_at IS NULL AND (
 (p.extras->>'discipleship_classification'='network_leader' AND NOT EXISTS(SELECT 1 FROM public.networks n WHERE n.leader_person_id=p.id AND n.is_active))
 OR (p.extras->>'discipleship_classification'='cell_leader' AND NOT EXISTS(SELECT 1 FROM public.lifegroups g WHERE g.leader_person_id=p.id AND g.is_active))
 OR (p.extras->>'discipleship_classification'='member' AND NOT EXISTS(SELECT 1 FROM public.lifegroup_memberships m WHERE m.person_id=p.id AND m.left_at IS NULL))
)
UNION ALL SELECT 'leader_self_membership',m.person_id::text
FROM public.lifegroup_memberships m JOIN public.lifegroups g ON g.id=m.lifegroup_id
WHERE m.left_at IS NULL AND m.person_id=g.leader_person_id
UNION ALL SELECT 'active_group_inactive_network',g.id::text
FROM public.lifegroups g JOIN public.networks n ON n.id=g.network_id
WHERE g.is_active AND NOT n.is_active
UNION ALL SELECT 'active_membership_in_inactive_group',m.person_id::text
FROM public.lifegroup_memberships m JOIN public.lifegroups g ON g.id=m.lifegroup_id
WHERE m.left_at IS NULL AND NOT g.is_active;
