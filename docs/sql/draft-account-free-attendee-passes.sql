-- DRAFT ONLY. Do not apply to production without explicit approval.
-- Account-free, revocable attendee passes for existing public.people records.
CREATE TABLE public.attendee_passes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 person_id bigint NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
 token_hash text NOT NULL UNIQUE,
 issued_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '365 days')
);
CREATE INDEX attendee_passes_person_active_idx ON public.attendee_passes(person_id)
 WHERE revoked_at IS NULL;
CREATE TABLE public.attendee_sessions (
 token_hash text PRIMARY KEY,
 person_id bigint NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
 csrf_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE INDEX attendee_sessions_person_idx ON public.attendee_sessions(person_id);
-- The backend is server-side only. RLS blocks direct browser Data API access.
ALTER TABLE public.attendee_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendee_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendee_passes FROM anon,authenticated;
REVOKE ALL ON public.attendee_sessions FROM anon,authenticated;
-- No broad public RLS policies and no public token search endpoint.
