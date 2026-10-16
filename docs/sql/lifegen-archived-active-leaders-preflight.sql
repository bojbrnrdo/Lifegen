-- READ-ONLY preflight: active leadership held by archived People.
-- Zero rows expected. Do not use against production for mutations.
SELECT 'archived_active_network_leader' AS issue,n.id AS entity_id,n.leader_person_id AS person_id
FROM public.networks n JOIN public.people p ON p.id=n.leader_person_id
WHERE n.is_active AND p.archived_at IS NOT NULL
UNION ALL
SELECT 'archived_active_cell_leader',g.id,g.leader_person_id
FROM public.lifegroups g JOIN public.people p ON p.id=g.leader_person_id
WHERE g.is_active AND p.archived_at IS NOT NULL
ORDER BY issue,entity_id;
