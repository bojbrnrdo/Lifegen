-- LIFEGEN VIP matching capacity and preference readiness (READ ONLY).
-- NULL schedule/area/category means unknown preference fit, not necessarily ineligible.
SELECT g.id AS cell_id,g.gender,g.capacity,
 count(m.id)::int AS active_members,
 CASE WHEN g.capacity IS NULL THEN NULL ELSE greatest(g.capacity-count(m.id)::int,0) END AS remaining_capacity,
 CASE WHEN g.capacity IS NOT NULL AND count(m.id)>=g.capacity THEN 'FULL'
      WHEN g.capacity IS NULL THEN 'CAPACITY_NOT_CONFIGURED'
      ELSE 'SPACE_AVAILABLE' END AS capacity_status,
 CASE WHEN g.schedule_day IS NULL OR g.schedule_time IS NULL OR nullif(btrim(coalesce(g.area,'')),'') IS NULL
       THEN 'MISSING_MATCHING_PREFERENCES'
       ELSE 'MATCHING_PREFERENCES_CONFIGURED' END AS preference_status,
 g.schedule_day,g.schedule_time,g.area,g.category
FROM public.lifegroups g
LEFT JOIN public.lifegroup_memberships m ON m.lifegroup_id=g.id AND m.left_at IS NULL
WHERE g.is_active AND g.leader_person_id IS NOT NULL
GROUP BY g.id ORDER BY g.id;