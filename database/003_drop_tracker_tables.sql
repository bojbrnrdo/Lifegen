-- Retired, intentionally non-destructive migration.
-- The Lifegroup tracker is restored by 006_lifegroup_tracker.sql. Keep any
-- existing group, network, membership and import history; do not drop tables.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);
INSERT INTO schema_migrations(version) VALUES('003_drop_tracker_tables') ON CONFLICT DO NOTHING;
COMMIT;
