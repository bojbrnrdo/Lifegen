-- Youth Welfare Admin role and ministry-only category overrides.
-- Additive and data-preserving: no People, registration, attendance, or VIP rows are changed.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

-- Permit the new least-privilege staff role. This replaces only the role_id
-- constraint; no existing account roles or permissions are rewritten.
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
  CHECK (role_id IN ('admin','staff','viewer','youth_welfare_admin'));

-- Ministry-only classification is intentionally separate from original form
-- answers and the People row. A person has one primary category so summary
-- category counts do not overlap. The application writes to this table only
-- after role and eligibility checks.
CREATE TABLE IF NOT EXISTS public.youth_welfare_categories (
  person_id bigint PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'student',
    'working_student',
    'young_professional',
    'working_employed',
    'not_studying',
    'unable_to_continue',
    'unclassified'
  )),
  updated_by bigint REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS youth_welfare_categories_category_idx
  ON public.youth_welfare_categories(category);

-- Direct Postgres access remains server-side. Supabase browser roles receive
-- no access and no broad REST policy is created.
REVOKE ALL ON TABLE public.youth_welfare_categories FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.youth_welfare_categories FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.youth_welfare_categories ENABLE ROW LEVEL SECURITY;

-- Category changes use the existing app change notification channel.
DROP TRIGGER IF EXISTS lifegen_changed ON public.youth_welfare_categories;
CREATE TRIGGER lifegen_changed
AFTER INSERT OR UPDATE OR DELETE ON public.youth_welfare_categories
FOR EACH ROW EXECUTE FUNCTION public.lifegen_notify_change();

-- The regular website flow records `public_registration` in audit_log for both
-- newly created People rows and registrations that reused an existing email.
CREATE INDEX IF NOT EXISTS audit_log_public_registration_person_idx
  ON public.audit_log(entity_id)
  WHERE entity = 'people' AND action = 'public_registration';

INSERT INTO public.schema_migrations(version)
VALUES ('011_youth_welfare')
ON CONFLICT DO NOTHING;
COMMIT;
