-- Optionally nest Networks under a parent Network, so the church can model
--     Bishop / Pastora  ->  Network Leaders  ->  Cell Leaders  ->  Members
-- with one card at the top instead of a flat list of Networks.
--
-- A top Network ("Bishop Arsie", "Pastora Jane") owns a Cell whose members are
-- the Network Leaders under them. Child Networks keep their own gender, so a
-- boys' Network is never forced to match the parent's gender.
--
-- Additive and reversible: existing Networks keep parent_network_id = NULL and
-- behave exactly as before (a flat directory).
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

ALTER TABLE networks
  ADD COLUMN IF NOT EXISTS parent_network_id bigint REFERENCES networks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS networks_parent_idx ON networks(parent_network_id, is_active);

-- A Network may not be its own parent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'networks_not_own_parent'
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT networks_not_own_parent CHECK (parent_network_id IS NULL OR parent_network_id <> id);
  END IF;
END $$;

INSERT INTO public.schema_migrations(version)
VALUES ('016_network_parent')
ON CONFLICT DO NOTHING;
COMMIT;
