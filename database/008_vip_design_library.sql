-- VIP Design Library: administrator-uploaded announcement designs, and the
-- per-Sunday record of which design was selected.
-- Additive and non-destructive: no existing table is altered except by adding
-- the change/permission wiring every LIFEGEN table already has.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

INSERT INTO id_counters(entity) VALUES ('vip_designs') ON CONFLICT DO NOTHING;

-- One row per uploaded design.
--
-- storage_kind decides where the bytes live:
--   'supabase' -> Supabase Storage object at storage_path (data stays NULL)
--   'database' -> the bytes sit in data
-- Object storage is preferred and used automatically whenever it is configured;
-- the bytea path exists so the feature also works where no bucket is available
-- and, unlike a server filesystem, it survives a Vercel redeployment.
CREATE TABLE IF NOT EXISTS vip_designs (
  id bigint PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  checksum text NOT NULL,
  storage_kind text NOT NULL CHECK (storage_kind IN ('supabase','database')),
  storage_path text,
  data bytea,
  -- 'background'  -> show the uploaded image exactly as provided
  -- 'template'    -> the image is a backdrop and live VIP data is overlaid
  display_mode text NOT NULL DEFAULT 'background' CHECK (display_mode IN ('background','template')),
  layout jsonb NOT NULL DEFAULT '{}',
  is_enabled boolean NOT NULL DEFAULT true,
  uploaded_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((storage_kind = 'supabase' AND storage_path IS NOT NULL AND data IS NULL)
      OR (storage_kind = 'database' AND data IS NOT NULL))
);

-- The same file cannot be uploaded twice.
CREATE UNIQUE INDEX IF NOT EXISTS vip_designs_checksum_uniq ON vip_designs (checksum);
CREATE INDEX IF NOT EXISTS vip_designs_enabled_idx ON vip_designs (is_enabled, created_at);

-- Exactly one design per Sunday service. The primary key is what makes the
-- selection race-safe: the first writer wins and every later attempt for that
-- Sunday is a no-op, so two projectors can never disagree.
CREATE TABLE IF NOT EXISTS vip_service_designs (
  service_date date PRIMARY KEY CHECK (EXTRACT(DOW FROM service_date) = 0),
  design_id bigint REFERENCES vip_designs(id) ON DELETE SET NULL,
  selection_mode text NOT NULL DEFAULT 'automatic' CHECK (selection_mode IN ('automatic','manual')),
  selected_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
  selected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vip_service_designs_design_idx ON vip_service_designs (design_id);

-- Same privacy posture as every other LIFEGEN table: no browser/role access.
DO $$
DECLARE table_name text; role_name text; sequence_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['vip_designs','vip_service_designs'] LOOP
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
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  END IF;
 END LOOP;
END $$;

-- Live updates: the projector refetches when a design or a selection changes.
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['vip_designs','vip_service_designs'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS lifegen_changed ON %I',table_name);
  EXECUTE format('CREATE TRIGGER lifegen_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION lifegen_notify_change()',table_name);
 END LOOP;
END $$;

INSERT INTO schema_migrations(version) VALUES('008_vip_design_library') ON CONFLICT DO NOTHING;
COMMIT;
