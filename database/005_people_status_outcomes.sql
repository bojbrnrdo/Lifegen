-- Retired, intentionally non-destructive migration.
-- Do not add one-month VIP export outcome statuses to fresh installations.
-- Existing deployments may retain those historical statuses for display/compatibility.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);
INSERT INTO schema_migrations(version) VALUES('005_people_status_outcomes') ON CONFLICT DO NOTHING;
COMMIT;
