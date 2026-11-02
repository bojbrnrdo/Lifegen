-- Separate Youth Welfare access from a user's primary LIFEGEN role.
-- Additive: existing staff accounts and People/registration data are unchanged.
BEGIN;
SELECT pg_advisory_xact_lock(72114026);

CREATE TABLE IF NOT EXISTS public.youth_welfare_access (
  user_id bigint PRIMARY KEY REFERENCES public.staff_users(id) ON DELETE CASCADE,
  role_id text NOT NULL CHECK (role_id IN ('youth_welfare_admin','youth_welfare_viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  granted_by bigint REFERENCES public.staff_users(id) ON DELETE SET NULL,
  updated_by bigint REFERENCES public.staff_users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS youth_welfare_access_status_role_idx
  ON public.youth_welfare_access(status,role_id);

-- Preserve access for existing portal-only accounts, while making later grants
-- and revocations manageable without replacing their primary LIFEGEN role.
INSERT INTO public.youth_welfare_access(user_id,role_id,status,granted_by,granted_at,created_at,updated_at)
SELECT id,role_id,'active',NULL,created_at,created_at,now()
FROM public.staff_users
WHERE role_id IN ('youth_welfare_admin','youth_welfare_viewer')
ON CONFLICT(user_id) DO NOTHING;

REVOKE ALL ON TABLE public.youth_welfare_access FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.youth_welfare_access FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.youth_welfare_access ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS lifegen_changed ON public.youth_welfare_access;
CREATE TRIGGER lifegen_changed
AFTER INSERT OR UPDATE OR DELETE ON public.youth_welfare_access
FOR EACH ROW EXECUTE FUNCTION public.lifegen_notify_change();

INSERT INTO public.schema_migrations(version)
VALUES ('014_youth_welfare_access')
ON CONFLICT DO NOTHING;
COMMIT;
