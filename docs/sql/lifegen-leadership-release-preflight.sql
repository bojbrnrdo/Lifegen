-- LIFEGEN leadership release preflight. READ-ONLY, safe against production.
-- Every result represents a row needing review before migration or deployment.
SELECT 'active_cell_in_inactive_network' AS issue, g.id::text AS entity_id
FROM public.lifegroups g JOIN public.networks n ON n.id=g.network_id
WHERE g.is_active AND NOT n.is_active
UNION ALL
SELECT 'active_cell_missing_network',g.id::text
FROM public.lifegroups g LEFT JOIN public.networks n ON n.id=g.network_id
WHERE g.is_active AND n.id IS NULL
UNION ALL
SELECT 'cross_network_secondary_leadership',g.id::text
FROM public.lifegroups g JOIN public.networks n ON n.leader_person_id=g.leader_person_id AND n.is_active
WHERE g.is_active AND g.network_id IS DISTINCT FROM n.id
UNION ALL
SELECT 'active_cell_missing_leader',g.id::text
FROM public.lifegroups g WHERE g.is_active AND g.leader_person_id IS NULL
UNION ALL
SELECT 'active_network_missing_leader',n.id::text
FROM public.networks n WHERE n.is_active AND n.leader_person_id IS NULL
ORDER BY issue,entity_id;
