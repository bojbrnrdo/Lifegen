-- LIFEGEN calendar events. Adds the public events calendar (website + Admin portal).
-- Non-destructive: creates one new table and its live-update trigger only.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);
CREATE TABLE IF NOT EXISTS calendar_events (
 id bigint PRIMARY KEY,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 description text CHECK(description IS NULL OR length(description)<=2000),
 location text CHECK(location IS NULL OR length(location)<=200),
 category text NOT NULL DEFAULT 'special' CHECK(category IN ('service','worship','prayer','youth','lifegroup','outreach','special')),
 event_date date NOT NULL,
 start_time time,
 end_time time,
 all_day boolean NOT NULL DEFAULT false,
 is_published boolean NOT NULL DEFAULT true,
 is_demo boolean NOT NULL DEFAULT false,
 created_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_time IS NULL OR start_time IS NULL OR end_time>start_time)
);
CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events(event_date);
INSERT INTO id_counters(entity) VALUES('calendar_events') ON CONFLICT DO NOTHING;
DROP TRIGGER IF EXISTS lifegen_changed ON calendar_events;
CREATE TRIGGER lifegen_changed AFTER INSERT OR UPDATE OR DELETE ON calendar_events FOR EACH ROW EXECUTE FUNCTION lifegen_notify_change();
INSERT INTO schema_migrations(version) VALUES('002_calendar_events') ON CONFLICT DO NOTHING;
COMMIT;
