-- LIFEGEN leadership assignment candidates (READ ONLY).
-- Shows compatibility, NOT evidence of appointment or authorization to assign.
WITH available AS (
 SELECT p.id AS person_id,p.sex
 FROM public.people p WHERE p.archived_at IS NULL
 AND p.status='leader' AND nullif(p.extras->>'discipleship_classification','') IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.networks n WHERE n.is_active AND n.leader_person_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM public.lifegroups g WHERE g.is_active AND g.leader_person_id=p.id)
)
SELECT 'network' AS target_type,n.id AS target_id,n.gender,a.person_id,
 CASE WHEN (n.gender='girls' AND a.sex='female') OR (n.gender='boys' AND a.sex='male') THEN 'gender_compatible_review_only'
 ELSE 'not_gender_compatible' END AS review_status
FROM public.networks n CROSS JOIN available a
WHERE n.is_active AND n.leader_person_id IS NULL
UNION ALL
SELECT 'cell',g.id,g.gender,a.person_id,
 CASE WHEN (g.gender='girls' AND a.sex='female') OR (g.gender='boys' AND a.sex='male') THEN 'gender_compatible_review_only'
 ELSE 'not_gender_compatible' END
FROM public.lifegroups g CROSS JOIN available a
WHERE g.is_active AND g.leader_person_id IS NULL
ORDER BY target_type,target_id,person_id;
