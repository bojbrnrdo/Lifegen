-- Optional identity link for future network/cell-scoped staff authorizations.
-- This migration does not grant or restrict permissions by itself.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS person_id bigint REFERENCES people(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_person_id_unique ON staff_users(person_id) WHERE person_id IS NOT NULL;
COMMIT;
