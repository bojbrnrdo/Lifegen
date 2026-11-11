-- LIFEGEN registration → Cell → attendance release readiness (READ ONLY).
-- Empty attendance and VIP tables mean integration has not been exercised;
-- they are not by themselves integrity failures.
WITH checks AS (
 SELECT 'vip_registration_unlinked_person' AS check_name,
        count(*)::bigint AS affected
 FROM public.vip_registrations v LEFT JOIN public.people p ON p.id=v.person_id
 WHERE v.person_id IS NULL OR p.id IS NULL
 UNION ALL
 SELECT 'active_membership_archived_person',
        count(*)::bigint
 FROM public.lifegroup_memberships m JOIN public.people p ON p.id=m.person_id
 WHERE m.left_at IS NULL AND p.archived_at IS NOT NULL
 UNION ALL
 SELECT 'active_membership_inactive_cell',
        count(*)::bigint
 FROM public.lifegroup_memberships m JOIN public.lifegroups g ON g.id=m.lifegroup_id
 WHERE m.left_at IS NULL AND NOT g.is_active
 UNION ALL
 SELECT 'attendance_unlinked_person',
        count(*)::bigint
 FROM public.records a LEFT JOIN public.people p ON p.id=a.person_id
 WHERE a.person_id IS NULL OR p.id IS NULL
 UNION ALL
 SELECT 'cell_attendance_unlinked_person',
        count(*)::bigint
 FROM public.lifegroup_meeting_attendance a LEFT JOIN public.people p ON p.id=a.person_id
 WHERE a.person_id IS NULL OR p.id IS NULL
 UNION ALL
 SELECT 'active_cell_without_leader',
        count(*)::bigint FROM public.lifegroups
 WHERE is_active AND leader_person_id IS NULL
 UNION ALL
 SELECT 'active_network_without_leader',
        count(*)::bigint FROM public.networks
 WHERE is_active AND leader_person_id IS NULL
)
SELECT check_name,affected,
 CASE WHEN affected=0 THEN 'PASS' ELSE 'REVIEW_REQUIRED' END AS result
FROM checks ORDER BY check_name;
