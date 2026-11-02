-- Add a portal-only, read-only Youth Welfare viewer role.
-- Usernames, passwords, staff management, and session handling continue to use
-- the existing LIFEGEN staff account system. No People or ministry rows change.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.staff_users'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_users DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_role_id_check
  CHECK (role_id IN ('admin','staff','viewer','youth_welfare_admin','youth_welfare_viewer'));

INSERT INTO public.schema_migrations(version)
VALUES ('013_youth_welfare_viewer')
ON CONFLICT DO NOTHING;
COMMIT;
