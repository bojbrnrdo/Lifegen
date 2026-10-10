-- Promote existing VIP profiles with more than four distinct present Sundays.
-- Keep higher/terminal statuses untouched; the threshold is five verified attendance dates.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

WITH eligible AS (
  SELECT p.id, p.status AS old_status, count(DISTINCT s.service_date)::int AS sundays_attended
  FROM people p
  JOIN vip_registrations v ON v.person_id = p.id
  JOIN records r ON r.person_id = p.id AND r.status = 'present'
  JOIN services s ON s.id = r.service_id
  WHERE p.status IN ('first_timer', 'new_believer', 'regular')
  GROUP BY p.id, p.status
  HAVING count(DISTINCT s.service_date) >= 5
), promoted AS (
  UPDATE people p
  SET status = 'member', updated_at = now()
  FROM eligible e
  WHERE p.id = e.id
  RETURNING p.id
)
INSERT INTO audit_log(actor_name, entity, entity_id, action, details)
SELECT 'Migration / system', 'people', promoted.id::text, 'vip_attendance_promoted_to_member',
       jsonb_build_object('old_status', eligible.old_status, 'new_status', 'member',
                          'sundays_attended', eligible.sundays_attended, 'threshold', 5)
FROM promoted
JOIN eligible ON eligible.id = promoted.id;

INSERT INTO schema_migrations(version) VALUES ('002_vip_attendance_member') ON CONFLICT DO NOTHING;
COMMIT;
