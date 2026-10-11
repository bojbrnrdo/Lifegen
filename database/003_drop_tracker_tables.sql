-- LIFEGEN tracker removal (2026-10): retires the Lifegroup tracker tables.
--
-- DROPPED: networks, lifegroups, memberships  (group/network tracking)
--          import_mappings, migration_runs    (legacy import tooling)
--
-- KEPT (still used by the app):
--   people, services, records, audit                 -- VIP people + Sunday attendance
--   vip_registrations, vip_sessions, vip_checkins    -- VIP registration + check-in validation
--   staff_users, staff_sessions, settings, id_counters, schema_migrations
--   monthly_prizes, community_posts, prayer_reactions, rate_limits, app_events
--   audit_log, calendar_events
--
-- The application (v2.x tracker removal) no longer reads or writes the dropped
-- tables, so this is safe to run any time the app is idle. Take a database
-- backup first if you want to keep the historical group rosters.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

-- Children first: memberships -> lifegroups -> networks
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS lifegroups;
DROP TABLE IF EXISTS networks;

-- Legacy import tooling
DROP TABLE IF EXISTS import_mappings;
DROP TABLE IF EXISTS migration_runs;

-- Clean up the app's id counters
DELETE FROM id_counters WHERE entity IN ('networks','lifegroups','memberships');

INSERT INTO schema_migrations(version) VALUES('003_drop_tracker_tables') ON CONFLICT DO NOTHING;
COMMIT;
