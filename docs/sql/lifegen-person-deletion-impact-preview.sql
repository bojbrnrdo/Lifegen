-- LIFEGEN People hard-delete impact preview. READ-ONLY.
-- Replace 0 with a real person ID to inspect before a reviewed deletion request.
-- This query does not delete, archive, or modify anything.
WITH target AS (SELECT 0::bigint AS person_id)
SELECT 'lifegroup_memberships' AS related_table, count(*)::bigint AS related_rows
FROM public.lifegroup_memberships m,target t WHERE m.person_id=t.person_id
UNION ALL SELECT 'lifegroup_meeting_attendance',count(*)::bigint FROM public.lifegroup_meeting_attendance m,target t WHERE m.person_id=t.person_id
UNION ALL SELECT 'records',count(*)::bigint FROM public.records m,target t WHERE m.person_id=t.person_id
UNION ALL SELECT 'vip_registrations',count(*)::bigint FROM public.vip_registrations m,target t WHERE m.person_id=t.person_id
UNION ALL SELECT 'vip_gift_handouts',count(*)::bigint FROM public.vip_gift_handouts m,target t WHERE m.person_id=t.person_id
UNION ALL SELECT 'network_leadership',count(*)::bigint FROM public.networks m,target t WHERE m.leader_person_id=t.person_id
UNION ALL SELECT 'cell_leadership',count(*)::bigint FROM public.lifegroups m,target t WHERE m.leader_person_id=t.person_id;
