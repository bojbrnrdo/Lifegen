-- Attributes every VIP registration to the LIFEGEN Sunday service it belongs to,
-- so the public countdown and the fullscreen VIP announcement read the same rows.
-- Additive and non-destructive: no VIP registration row is deleted, and no row is
-- rewritten apart from the new service_date column being filled in.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

ALTER TABLE vip_registrations ADD COLUMN IF NOT EXISTS service_date date;

-- Every attributed service date must be a Sunday (DOW 0), matching services.service_date.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vip_registrations_service_date_sunday'
  ) THEN
    ALTER TABLE vip_registrations
      ADD CONSTRAINT vip_registrations_service_date_sunday
      CHECK (service_date IS NULL OR EXTRACT(DOW FROM service_date) = 0);
  END IF;
END $$;

-- Backfill existing rows from created_at, read in Asia/Manila.
--
-- Cycle rule (identical to attributeServiceDate in src/service-cycle.js so the
-- backfill and the runtime agree):
--   * a registration made ON a Sunday belongs to that Sunday;
--   * a registration made any other day belongs to the coming Sunday.
--
-- Rows that would collide with either unique index below keep service_date =
-- NULL. They stay in the database with a working recovery portal; they simply
-- are not announced, so a double submit can never inflate the VIP count.
WITH attributed AS (
  SELECT
    id,
    person_id,
    full_name,
    inviter,
    created_at,
    CASE
      WHEN EXTRACT(DOW FROM (created_at AT TIME ZONE 'Asia/Manila')::date) = 0
        THEN (created_at AT TIME ZONE 'Asia/Manila')::date
      ELSE (created_at AT TIME ZONE 'Asia/Manila')::date
           + (7 - EXTRACT(DOW FROM (created_at AT TIME ZONE 'Asia/Manila')::date))::int
    END AS target_sunday
  FROM vip_registrations
),
-- Pass 1: one attributed registration per person per Sunday.
per_person AS (
  SELECT id, person_id, full_name, inviter, created_at, target_sunday,
         ROW_NUMBER() OVER (
           PARTITION BY person_id, target_sunday
           ORDER BY created_at, id
         ) AS rn_person
  FROM attributed
),
-- Pass 2: one attributed registration per name+inviter identity per Sunday.
per_identity AS (
  SELECT id, target_sunday,
         ROW_NUMBER() OVER (
           PARTITION BY target_sunday,
                        lower(btrim(full_name)),
                        lower(btrim(COALESCE(inviter, '')))
           ORDER BY created_at, id
         ) AS rn_identity
  FROM per_person
  WHERE rn_person = 1
)
UPDATE vip_registrations v
SET service_date = r.target_sunday
FROM per_identity r
WHERE r.id = v.id
  AND r.rn_identity = 1
  AND v.service_date IS NULL;

-- Database-backed duplicate protection, layer 1: one attributed VIP
-- registration per person per Sunday service.
CREATE UNIQUE INDEX IF NOT EXISTS vip_registrations_service_person_uniq
  ON vip_registrations (service_date, person_id)
  WHERE service_date IS NOT NULL;

-- Layer 2: the same person cannot be announced twice for one Sunday under two
-- registrations. Identity is the normalized name plus inviter, the strongest
-- signal available on a public form that collects no email address. A
-- re-submitted form is still stored but left unattributed.
CREATE UNIQUE INDEX IF NOT EXISTS vip_registrations_service_identity_uniq
  ON vip_registrations (
    service_date,
    lower(btrim(full_name)),
    lower(btrim(COALESCE(inviter, '')))
  )
  WHERE service_date IS NOT NULL;

-- Fast lookup for the announcement: sign-up order within a Sunday.
CREATE INDEX IF NOT EXISTS vip_registrations_service_date_idx
  ON vip_registrations (service_date, created_at, id);

-- The announcement window is shared state so every projector shows the same
-- cycle and a page refresh never restarts the wrong one.
INSERT INTO settings(key, value) VALUES
  ('vip_announce_start', 'null'),
  ('vip_announce_minutes', '120'),
  ('vip_announce_service_date', 'null')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('007_vip_service_date') ON CONFLICT DO NOTHING;
COMMIT;
