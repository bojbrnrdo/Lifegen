-- LIFEGEN production-safe, read-only integrity audit.
-- Do NOT run UPDATE / INSERT / DELETE from this file.
SELECT 'people_missing_classification' AS check_name, count(*)::int AS issues
FROM public.people WHERE archived_at IS NULL AND coalesce(extras->>'discipleship_classification','')=''
UNION ALL SELECT 'active_networks_without_leader',count(*)::int FROM public.networks WHERE is_active AND leader_person_id IS NULL
UNION ALL SELECT 'active_cells_without_leader',count(*)::int FROM public.lifegroups WHERE is_active AND leader_person_id IS NULL
UNION ALL SELECT 'dual_active_network_cell_leadership',count(*)::int
  FROM public.networks n JOIN public.lifegroups g ON g.leader_person_id=n.leader_person_id
  WHERE n.is_active AND g.is_active AND n.leader_person_id IS NOT NULL
UNION ALL SELECT 'active_memberships_in_unled_cells',count(*)::int
  FROM public.lifegroup_memberships m JOIN public.lifegroups g ON g.id=m.lifegroup_id
  WHERE m.left_at IS NULL AND g.is_active AND g.leader_person_id IS NULL
UNION ALL SELECT 'duplicate_active_membership_people',count(*)::int FROM (
  SELECT person_id FROM public.lifegroup_memberships WHERE left_at IS NULL
  GROUP BY person_id HAVING count(*)>1
) d
UNION ALL SELECT 'active_memberships_in_inactive_cells',count(*)::int
  FROM public.lifegroup_memberships m JOIN public.lifegroups g ON g.id=m.lifegroup_id
  WHERE m.left_at IS NULL AND NOT g.is_active
UNION ALL SELECT 'invalid_classifications',count(*)::int FROM public.people
 WHERE extras ? 'discipleship_classification'
 AND extras->>'discipleship_classification' NOT IN ('network_leader','cell_leader','member','vip');
