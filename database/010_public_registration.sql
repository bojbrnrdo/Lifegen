-- Public registration update: the registration endpoints can store the wider
-- public gender set (male, female, other, prefer not to say), so the people.sex
-- constraint has to accept them. (The public dropdowns currently offer Male and
-- Female only; the wider values stay valid so existing rows and any cached older
-- page keep working.) Additive and data-preserving: nothing is rewritten, no
-- column is dropped or renamed, and every existing row keeps its current value.
--
-- Rollback (only if this migration must be undone):
--   ALTER TABLE people DROP CONSTRAINT people_sex_check;
--   ALTER TABLE people ADD CONSTRAINT people_sex_check CHECK (sex IN ('male','female'));
--   DROP INDEX IF EXISTS people_email_lower_idx;
--   DELETE FROM schema_migrations WHERE version='010_public_registration';
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

ALTER TABLE people DROP CONSTRAINT IF EXISTS people_sex_check;
ALTER TABLE people ADD CONSTRAINT people_sex_check CHECK (sex IN ('male','female','other','prefer_not_to_say'));

-- Duplicate detection for the public registration forms looks people up by email.
CREATE INDEX IF NOT EXISTS people_email_lower_idx ON people(lower(email)) WHERE email IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES('010_public_registration') ON CONFLICT DO NOTHING;
COMMIT;
