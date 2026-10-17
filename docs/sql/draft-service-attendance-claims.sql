-- DRAFT ONLY: production migration requires explicit approval.
CREATE TABLE public.service_attendance_claims (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 service_id bigint NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
 person_id bigint NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid')),
 source text NOT NULL CHECK (source IN ('regular','vip')),
 created_at timestamptz NOT NULL DEFAULT now(),
 validated_at timestamptz,
 validated_by bigint REFERENCES public.staff_users(id) ON DELETE SET NULL,
 UNIQUE (service_id,person_id)
);
CREATE INDEX service_attendance_claims_status_idx ON public.service_attendance_claims(status,created_at DESC);
ALTER TABLE public.service_attendance_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_attendance_claims FROM anon,authenticated;
-- Server-side Postgres connection only; do not add public RLS policies.
