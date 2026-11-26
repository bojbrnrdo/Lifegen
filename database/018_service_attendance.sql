-- Service Attendance — the per-Sunday register behind the Attendance page.
--
-- Until now Sunday attendance existed in exactly one place: the VIP check-in
-- (vip_checkins, status='valid'). Migration 017 retired the general roster on
-- purpose, because a regular member's continuity is the Cell Leader's call.
--
-- The church now wants one screen that counts everyone who was in the room on a
-- Sunday — members, first timers and returning VIPs — with the headcount that
-- never checked in. That is what these two tables are:
--
--   service_attendance      one row per person per Sunday they were marked in
--   service_headcounts      one row per Sunday for the people not in the list
--
-- How the two sources fit together (this rule lives in src/service-attendance.js):
--   * A VIP / first timer whose VIP check-in was validated for that Sunday is
--     "present" without a service_attendance row. vip_checkins stays the single
--     record for VIP attendance, so the VIP portal, the prize streak and the
--     Gift Tracker cannot drift.
--   * Marking a VIP present here writes vip_checkins (status='valid') in the
--     same transaction, never a duplicate service_attendance row.
--   * Un-marking that VIP removes the check-in this page created (extras.
--     service_attendance = true) and leaves a staff-validated or mobile check-in
--     untouched, reported back as still present.
--
-- Additive only: no column is dropped or renamed and no existing row is
-- rewritten. Rollback:
--   DROP TABLE IF EXISTS service_attendance;
--   DROP TABLE IF EXISTS service_headcounts;
--   DELETE FROM schema_migrations WHERE version='018_service_attendance';
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

INSERT INTO id_counters(entity) VALUES ('service_attendance') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS service_attendance (
  id bigint PRIMARY KEY,
  date_key date NOT NULL CHECK(EXTRACT(DOW FROM date_key)=0),
  person_id bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- Same-day override of the person's regular status. NULL means "read it from
  -- the person record", so a later status change does not rewrite history.
  category text CHECK(category IS NULL OR category IN ('member','vip')),
  marked_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
  marked_by_name text,
  marked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date_key, person_id)
);
CREATE INDEX IF NOT EXISTS service_attendance_date_idx ON service_attendance(date_key);
CREATE INDEX IF NOT EXISTS service_attendance_person_idx ON service_attendance(person_id);

-- The headcount is deliberately separate from the roster: it is the number of
-- people in the room who were never checked in by name ("Headcount not checked
-- in" in the original prototype), stored per Sunday so the report keeps history.
CREATE TABLE IF NOT EXISTS service_headcounts (
  date_key date PRIMARY KEY CHECK(EXTRACT(DOW FROM date_key)=0),
  headcount integer NOT NULL DEFAULT 0 CHECK(headcount BETWEEN 0 AND 100000),
  updated_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Same privacy posture as every other LIFEGEN table: no browser/anon role access.
DO $$
DECLARE table_name text; role_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['service_attendance','service_headcounts'] LOOP
  IF to_regclass('public.' || table_name) IS NOT NULL THEN
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
     EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
    END IF;
   END LOOP;
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  END IF;
 END LOOP;
END $$;

-- Live updates: two staff devices editing the same Sunday see each other.
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['service_attendance','service_headcounts'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS lifegen_changed ON %I',table_name);
  EXECUTE format('CREATE TRIGGER lifegen_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION lifegen_notify_change()',table_name);
 END LOOP;
END $$;

INSERT INTO schema_migrations(version) VALUES('018_service_attendance') ON CONFLICT DO NOTHING;
COMMIT;
