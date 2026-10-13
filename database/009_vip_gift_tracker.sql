-- VIP Gift Tracker: the record of which VIPs have already received their gift.
--
-- Additive and non-destructive. No existing table, column, index or row is
-- changed. The tracker READS attendance that is already recorded
-- (records.status = 'present', which is also what a validated VIP check-in
-- writes) and only ever writes the new vip_gift_handouts table below.
--
-- A "gift" is the physical gift handed out in person. Nothing about the gift
-- itself is stored here — no prize name, no description, no note — only who
-- received it, when, and which admin/staff recorded it.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

INSERT INTO id_counters(entity) VALUES ('vip_gift_handouts') ON CONFLICT DO NOTHING;

-- One row per VIP who has received the gift. UNIQUE(person_id) is what enforces
-- "one gift per person" even when two staff press the button at the same moment.
-- Removing the row is the approved Undo for a mis-click; the audit log keeps
-- both the recording and the removal.
CREATE TABLE IF NOT EXISTS vip_gift_handouts (
  id bigint PRIMARY KEY,
  person_id bigint NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
  registration_id bigint REFERENCES vip_registrations(id) ON DELETE SET NULL,
  marked_by bigint REFERENCES staff_users(id) ON DELETE SET NULL,
  marked_by_name text,
  marked_at timestamptz NOT NULL DEFAULT now(),
  extras jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS vip_gift_handouts_marked_idx ON vip_gift_handouts (marked_at DESC);

-- Same privacy posture as every other LIFEGEN table: no browser/role access.
DO $$
DECLARE table_name text; role_name text; sequence_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['vip_gift_handouts'] LOOP
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

-- Live updates: an admin screen showing the tracker refetches when a gift is
-- recorded or undone. Uses the change trigger every LIFEGEN table already has.
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['vip_gift_handouts'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS lifegen_changed ON %I',table_name);
  EXECUTE format('CREATE TRIGGER lifegen_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION lifegen_notify_change()',table_name);
 END LOOP;
END $$;

INSERT INTO schema_migrations(version) VALUES('009_vip_gift_tracker') ON CONFLICT DO NOTHING;
COMMIT;
