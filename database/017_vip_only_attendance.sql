-- Retire general Sunday attendance. The church tracks attendance only for VIPs
-- and first timers; whether a regular member is "continuous" is the Cell
-- Leader's call, recorded per Cell meeting, not as a weekly Sunday mark.
--
-- Before this migration two tables carried Sunday attendance:
--   services                     one row per Sunday
--   records                      one row per person per Sunday
-- and a VIP's attendance existed in BOTH places: a validated check-in wrote a
-- records row (source='vip') as well as the vip_checkins row.
--
-- After this migration the VIP check-in IS the attendance record:
--   vip_checkins (status='valid', date_key=<Sunday>)   one row per VIP per Sunday
-- That table already enforces date_key on a Sunday, already de-duplicates on
-- (registration_id, date_key), and already drives the VIP portal, the prize
-- progress and the registration streaks.
--
-- Non-destructive to VIP data: every distinct Sunday a VIP attended is copied
-- into vip_checkins before services/records are dropped, so no VIP loses an
-- attendance, and the Gift Tracker threshold (4 Sundays) keeps its meaning.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

-- 1. Preserve every VIP attendance that only existed as a records row.
--    A records row is a VIP attendance when its person has a VIP registration.
--    There is normally already a matching vip_checkins row (validateCheckin
--    writes both); ON CONFLICT keeps the strongest existing status.
INSERT INTO vip_checkins(id, registration_id, date_key, status, created_at)
SELECT
  (SELECT coalesce(max(id), 0) FROM vip_checkins)
    + row_number() OVER (ORDER BY reg.id, r.service_id, s.service_date),
  reg.id,
  s.service_date,
  'valid',
  coalesce(r.recorded_at, now())
FROM records r
JOIN services s ON s.id = r.service_id
JOIN LATERAL (
  SELECT v.id, v.person_id
  FROM vip_registrations v
  WHERE v.person_id = r.person_id
  ORDER BY v.created_at, v.id
  LIMIT 1
) reg ON true
WHERE r.status = 'present'
  AND s.service_date IS NOT NULL
ON CONFLICT (registration_id, date_key) DO NOTHING;

-- Any id handed out above must not be reissued by the id allocator later.
INSERT INTO id_counters(entity, last_id)
SELECT 'vip_checkins', max(id) FROM vip_checkins
ON CONFLICT (entity) DO UPDATE SET last_id = GREATEST(id_counters.last_id, EXCLUDED.last_id);

-- 2. A VIP's earliest verified Sunday is their "date first attended".
--    This used to be maintained by the attendance mark; keep it meaningful.
UPDATE people p
SET date_first_attended = firsts.first_date,
    updated_at = now()
FROM (
  SELECT vr.person_id, min(c.date_key) AS first_date
  FROM vip_checkins c
  JOIN vip_registrations vr ON vr.id = c.registration_id
  WHERE c.status = 'valid'
  GROUP BY vr.person_id
) firsts
WHERE p.id = firsts.person_id
  AND (p.date_first_attended IS NULL OR p.date_first_attended > firsts.first_date);

-- 3. The audit trail referenced services by id; that column goes with the table.
--    audit_log (the real, append-only log) is untouched.
DROP TABLE IF EXISTS records;
DROP TABLE IF EXISTS audit;
DROP TABLE IF EXISTS services;

-- 4. Lookups the check-in paths rely on.
CREATE INDEX IF NOT EXISTS vip_checkins_status_date_idx ON vip_checkins(status, date_key);
CREATE INDEX IF NOT EXISTS vip_checkins_date_idx ON vip_checkins(date_key);

INSERT INTO schema_migrations(version) VALUES('017_vip_only_attendance') ON CONFLICT DO NOTHING;
COMMIT;
