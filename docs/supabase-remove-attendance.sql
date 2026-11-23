-- ============================================================================
-- LIFEGEN · Remove general Sunday attendance (VIP + first-timer check-in stays)
-- ============================================================================
--
-- Run this by hand in the Supabase SQL Editor ONLY IF you want to drop the old
-- attendance tables yourself. It is the same end state as
-- database/017_vip_only_attendance.sql.
--
-- WHY THIS IS MANUAL
--   Vercel runs `npm run build` and nothing else (vercel.json). Migrations were
--   deliberately removed from the build in commit 99464f7, so a deploy does NOT
--   run database/017 for you. Until you run this, the app works normally — it no
--   longer reads these tables at all. The tables just sit there holding old data.
--
-- HOW TO RUN IT
--   1. Backup first. Either:
--        · Supabase Dashboard → Database → Backups → download one, OR
--        · run STEP 0 below and save the output as a CSV.
--   2. Paste everything from STEP 1 down into the SQL Editor and run as ONE
--      statement batch (not statement-by-statement, so the transaction holds).
--   3. Read the NOTICE lines it prints. It tells you how many VIP attendances it
--      rescued before dropping anything.
--
-- SAFE TO RUN TWICE
--   Every step is guarded with to_regclass / IF NOT EXISTS, so a second run is a
--   no-op that prints "already removed" instead of failing. It is also safe if
--   database/017 already ran.
--
-- WHAT IT DROPS (this is irreversible)
--   services   one row per Sunday
--   records    one row per person per Sunday
--   audit      the ORIGINAL per-status change log
--
-- WHAT IT KEEPS
--   audit_log  the real, append-only audit trail
--   people, vip_registrations, vip_checkins
--
-- THE POINT OF THE BACKFILL
--   A VIP's attendance used to live in BOTH records and vip_checkins (a validated
--   check-in wrote both). After this, vip_checkins is the ONLY source. So before
--   dropping records, every VIP Sunday that exists only as a records row is
--   copied into vip_checkins — otherwise trimming attendance history would
--   silently reset Gift Tracker progress and registration streaks.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 0 · OPTIONAL — run this ALONE first, save the result somewhere safe.
--          Do not include it in the same run as STEP 1.
-- ---------------------------------------------------------------------------
-- SELECT * FROM services ORDER BY service_date;
-- SELECT * FROM records  ORDER BY service_id, person_id;
-- SELECT * FROM audit    ORDER BY id;
-- SELECT * FROM vip_checkins ORDER BY date_key, registration_id;


-- ---------------------------------------------------------------------------
-- STEP 1 · The retirement, in one transaction
-- ---------------------------------------------------------------------------
BEGIN;

-- Serialise against a concurrent check-in / migration so nothing is written to
-- records between the backfill and the drops.
SELECT pg_advisory_xact_lock(72114026);

DO $migrate$
DECLARE
  has_services boolean := to_regclass('public.services') IS NOT NULL;
  has_records  boolean := to_regclass('public.records')  IS NOT NULL;
  has_audit    boolean := to_regclass('public.audit')    IS NOT NULL;
  rescued      bigint  := 0;
  dated        bigint  := 0;
  kept_sunday  timestamptz;
BEGIN
  IF NOT (has_services OR has_records OR has_audit) THEN
    RAISE NOTICE 'Already removed: services/records/audit are all gone. Nothing to do.';
    RETURN;
  END IF;

  -- 1. Rescue VIP attendances that exist ONLY as a records row.
  IF has_records AND has_services THEN
    INSERT INTO vip_checkins (id, registration_id, date_key, status, created_at)
    SELECT
      (SELECT coalesce(max(id), 0) FROM vip_checkins)
        + row_number() OVER (ORDER BY reg.id, s.service_date),
      reg.id,
      s.service_date,
      'valid',
      coalesce(r.recorded_at, now())
    FROM records r
    JOIN services s ON s.id = r.service_id
    -- A person can have more than one VIP registration across years; the earliest
    -- one, the same one the old callers resolved to.
    JOIN LATERAL (
      SELECT v.id, v.person_id
      FROM vip_registrations v
      WHERE v.person_id = r.person_id
      ORDER BY v.created_at, v.id
      LIMIT 1
    ) reg ON true
    WHERE r.status = 'present'
      AND s.service_date IS NOT NULL
      -- vip_checkins.date_key carries CHECK(EXTRACT(DOW FROM date_key)=0) and
      -- services.service_date carries the same check, so a non-Sunday cannot
      -- normally exist. This filter only stops a hand-edited row from aborting
      -- the whole transaction; the notice below reports it if it ever fires.
      AND EXTRACT(DOW FROM s.service_date) = 0
      -- If the row is already there, only ever upgrade it to 'valid'. A validated
      -- check-in must never be downgraded back to 'pending' or 'invalid'.
      ON CONFLICT (registration_id, date_key) DO UPDATE
        SET status = 'valid'
        WHERE vip_checkins.status <> 'valid';
    GET DIAGNOSTICS rescued = ROW_COUNT;

    -- Any non-Sunday service rows we skipped, reported rather than swallowed.
    SELECT count(*) INTO dated
    FROM records r
    JOIN services s ON s.id = r.service_id
    WHERE r.status = 'present'
      AND EXTRACT(DOW FROM s.service_date) <> 0;

    IF dated > 0 THEN
      RAISE NOTICE '% records rows fall on a non-Sunday date and were NOT copied into vip_checkins. Look at them before dropping records if that matters.', dated;
    END IF;

    -- The id allocator must not reissue an id we just handed out.
    INSERT INTO id_counters (entity, last_id)
    SELECT 'vip_checkins', max(id) FROM vip_checkins
    ON CONFLICT (entity) DO UPDATE
      SET last_id = GREATEST(id_counters.last_id, EXCLUDED.last_id);
  END IF;

  -- 2. The earliest verified Sunday is "date first attended".
  --    The attendance mark used to maintain this; keep it meaningful.
  IF to_regclass('public.vip_checkins') IS NOT NULL THEN
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
  END IF;

  -- 3. Drop. records and audit both hold FKs INTO services, so they go first.
  IF has_records  THEN DROP TABLE IF EXISTS records;  END IF;
  IF has_audit    THEN DROP TABLE IF EXISTS audit;    END IF;
  IF has_services THEN DROP TABLE IF EXISTS services; END IF;

  RAISE NOTICE 'Done. % VIP attendance rows rescued into vip_checkins. services/records/audit are gone.', rescued;
END
$migrate$;

-- 4. Flush the deferred foreign-key checks queued by the inserts in step 1.
--    Postgres refuses to CREATE INDEX on a table with pending trigger events, so
--    this has to happen before the index step below.
SET CONSTRAINTS ALL IMMEDIATE;

-- 5. Lookups the check-in paths rely on. Guarded, so a re-run is a no-op.
CREATE INDEX IF NOT EXISTS vip_checkins_status_date_idx ON vip_checkins (status, date_key);
CREATE INDEX IF NOT EXISTS vip_checkins_date_idx        ON vip_checkins (date_key);

-- 6. Record it, so a later `npm run db:migrate` knows 017 is already applied and
--    skips it instead of re-running against dropped tables.
INSERT INTO schema_migrations (version)
VALUES ('017_vip_only_attendance')
ON CONFLICT DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- STEP 2 · CHECK — run after STEP 1 to confirm the end state
-- ---------------------------------------------------------------------------
-- SELECT to_regclass('public.services') AS services_should_be_null,
--        to_regclass('public.records')  AS records_should_be_null,
--        to_regclass('public.audit')    AS audit_should_be_null;
--
-- SELECT version FROM schema_migrations WHERE version LIKE '017%';
--
-- -- VIP attendance is now the only source; these two should agree:
-- SELECT count(*) AS vip_checkins_valid FROM vip_checkins WHERE status = 'valid';
-- SELECT count(*) AS distinct_vip_sundays
--   FROM (SELECT DISTINCT registration_id, date_key FROM vip_checkins WHERE status='valid') t;
