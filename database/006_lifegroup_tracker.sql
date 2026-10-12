-- Restore the Lifegroup tracker on the current shared PostgreSQL schema.
-- Additive: creates the tracker tables alongside People, VIP registrations and attendance.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

INSERT INTO id_counters(entity) VALUES
 ('networks'),('lifegroups'),('lifegroup_memberships'),('lifegroup_meetings'),('lifegroup_meeting_attendance')
ON CONFLICT DO NOTHING;

-- Independent networks (no nested network tree).
CREATE TABLE IF NOT EXISTS networks (
 id bigint PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 gender text NOT NULL CHECK(gender IN ('boys','girls')),
 leader_person_id bigint REFERENCES people(id) ON DELETE SET NULL,
 leader_name text,
 notes text,
 is_active boolean NOT NULL DEFAULT true,
 is_auto boolean NOT NULL DEFAULT false,
 is_demo boolean NOT NULL DEFAULT false,
 created_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 extras jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS networks_leader_idx ON networks(leader_person_id);
CREATE INDEX IF NOT EXISTS networks_active_gender_idx ON networks(is_active,gender);
CREATE UNIQUE INDEX IF NOT EXISTS networks_active_leader_unique
 ON networks(leader_person_id) WHERE is_active AND leader_person_id IS NOT NULL;

-- Lifegroups are single-gender, belong to an optional independent network,
-- and keep leader/schedule details used by the tracker.
CREATE TABLE IF NOT EXISTS lifegroups (
 id bigint PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 gender text NOT NULL CHECK(gender IN ('boys','girls')),
 leader_person_id bigint REFERENCES people(id) ON DELETE SET NULL,
 leader_name text,
 network_id bigint REFERENCES networks(id) ON DELETE RESTRICT,
 network_manual boolean NOT NULL DEFAULT false,
 network text,
 area text,
 schedule_day text CHECK(schedule_day IN ('mon','tue','wed','thu','fri','sat','sun') OR schedule_day IS NULL),
 schedule_time time,
 category text,
 capacity integer CHECK(capacity IS NULL OR capacity BETWEEN 1 AND 999),
 venue text,
 notes text,
 is_active boolean NOT NULL DEFAULT true,
 is_demo boolean NOT NULL DEFAULT false,
 created_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 extras jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS lifegroups_network_idx ON lifegroups(network_id,is_active);
CREATE INDEX IF NOT EXISTS lifegroups_leader_idx ON lifegroups(leader_person_id);
CREATE INDEX IF NOT EXISTS lifegroups_gender_idx ON lifegroups(gender,is_active);

-- One row per stay in a group. Ending a membership preserves the history;
-- the partial unique index guarantees no one is actively assigned twice.
CREATE TABLE IF NOT EXISTS lifegroup_memberships (
 id bigint PRIMARY KEY,
 person_id bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
 lifegroup_id bigint NOT NULL REFERENCES lifegroups(id) ON DELETE RESTRICT,
 role text NOT NULL DEFAULT 'member' CHECK(role IN ('member','leader','assistant')),
 tier text NOT NULL DEFAULT 'new' CHECK(tier IN ('solid','new')),
 joined_at date NOT NULL DEFAULT CURRENT_DATE,
 left_at date,
 notes text,
 assigned_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(left_at IS NULL OR left_at >= joined_at)
);
CREATE INDEX IF NOT EXISTS lifegroup_memberships_person_idx ON lifegroup_memberships(person_id,left_at);
CREATE INDEX IF NOT EXISTS lifegroup_memberships_group_idx ON lifegroup_memberships(lifegroup_id,left_at,tier);
CREATE UNIQUE INDEX IF NOT EXISTS lifegroup_memberships_current_person_unique
 ON lifegroup_memberships(person_id) WHERE left_at IS NULL;

-- Weekly group reports and the per-member attendance/devo marks behind them.
CREATE TABLE IF NOT EXISTS lifegroup_meetings (
 id bigint PRIMARY KEY,
 lifegroup_id bigint NOT NULL REFERENCES lifegroups(id) ON DELETE RESTRICT,
 meeting_date date NOT NULL,
 held boolean NOT NULL DEFAULT true,
 no_meeting_reason text,
 topic text,
 notes text,
 present_count integer NOT NULL DEFAULT 0 CHECK(present_count >= 0),
 submitted_via text NOT NULL DEFAULT 'admin' CHECK(submitted_via IN ('admin','leader_link')),
 submitted_by_user bigint REFERENCES staff_users(id) ON DELETE SET NULL,
 submitted_by_name text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(lifegroup_id,meeting_date),
 CHECK(held OR nullif(btrim(no_meeting_reason),'') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS lifegroup_meetings_group_date_idx ON lifegroup_meetings(lifegroup_id,meeting_date DESC);

CREATE TABLE IF NOT EXISTS lifegroup_meeting_attendance (
 id bigint PRIMARY KEY,
 meeting_id bigint NOT NULL REFERENCES lifegroup_meetings(id) ON DELETE CASCADE,
 person_id bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
 present boolean NOT NULL DEFAULT false,
 devotion boolean NOT NULL DEFAULT false,
 absent boolean NOT NULL DEFAULT false,
 marked_by text,
 marked_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(meeting_id,person_id),
 CHECK(NOT (present AND absent)),
 CHECK(NOT devotion OR present)
);
CREATE INDEX IF NOT EXISTS lifegroup_meeting_attendance_person_idx ON lifegroup_meeting_attendance(person_id,meeting_id);

-- Keep the tracker private when a Supabase project's Data API is enabled.
-- The LIFEGEN server connects with its private PostgreSQL URL; browser roles do not.
DO $$
DECLARE table_name text; role_name text; sequence_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'schema_migrations','id_counters','staff_users','staff_sessions','people','services','records','audit',
  'settings','monthly_prizes','vip_registrations','vip_sessions','vip_checkins','community_posts',
  'prayer_reactions','import_mappings','migration_runs','audit_log','rate_limits','app_events','calendar_events',
  'networks','lifegroups','lifegroup_memberships','lifegroup_meetings','lifegroup_meeting_attendance'
 ] LOOP
  IF to_regclass('public.' || table_name) IS NOT NULL THEN
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
   IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.' || table_name) AND attname='id' AND attnum>0 AND NOT attisdropped) THEN
    sequence_name:=pg_get_serial_sequence(format('public.%I',table_name),'id');
    IF sequence_name IS NOT NULL THEN
     EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC',sequence_name);
     FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
       EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %I',sequence_name,role_name);
      END IF;
     END LOOP;
    END IF;
   END IF;
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
     EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
    END IF;
   END LOOP;
  END IF;
 END LOOP;
END $$;

-- Direct Postgres/server access remains the only access path; there are no
-- Supabase client policies that would expose private people or attendance data.
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'people','services','records','audit','staff_users','staff_sessions','settings','monthly_prizes',
  'vip_registrations','vip_sessions','vip_checkins','community_posts','prayer_reactions','import_mappings',
  'migration_runs','audit_log','rate_limits','app_events','calendar_events','networks','lifegroups',
  'lifegroup_memberships','lifegroup_meetings','lifegroup_meeting_attendance'
 ] LOOP
  IF to_regclass('public.' || table_name) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  END IF;
 END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['networks','lifegroups','lifegroup_memberships','lifegroup_meetings','lifegroup_meeting_attendance'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS lifegen_changed ON %I',table_name);
  EXECUTE format('CREATE TRIGGER lifegen_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION lifegen_notify_change()',table_name);
 END LOOP;
END $$;

INSERT INTO schema_migrations(version) VALUES('006_lifegroup_tracker') ON CONFLICT DO NOTHING;
COMMIT;
