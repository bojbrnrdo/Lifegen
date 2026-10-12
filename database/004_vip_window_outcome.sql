-- Retired, intentionally non-destructive migration.
-- VIP 4-week outcome exports are no longer part of LIFEGEN. Existing deployments
-- may still have the legacy columns; the application no longer reads or writes them.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);
INSERT INTO schema_migrations(version) VALUES('004_vip_window_outcome') ON CONFLICT DO NOTHING;
COMMIT;
