# Deploy LIFEGEN with Supabase

The app serves the public LIFEGEN website at `/` and its signed-in Admin portal at `/admin` from one Express deployment. Both use the same Supabase PostgreSQL database through the server-side API.

## 1. Prepare the Supabase database

Use the dedicated LIFEGEN Supabase project when available. Back it up first. Run the SQL files in [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md) **in order** in Supabase SQL Editor, or provide the private connection variables to the host and run `npm run db:migrate`. Do not run this against an incompatible schema or assume it imports records from another application.

## 2. Configure the hosting project

For a Vercel deployment, the project root must contain `package.json`, `vercel.json`, `src/`, `public/`, `database/` and `scripts/`. Use these server-side environment variables:

- `DATABASE_URL` — Supabase pooler connection URL (Session Pooler on port `5432`, or Transaction Pooler on `6543`).
- `DATABASE_DIRECT_URL` — Supabase direct database URL when this host can reach it, otherwise the Session Pooler URL on port `5432` (not the transaction pooler). The direct `db.<project-ref>.supabase.co` host is IPv6-only on many projects, so Vercel commonly reports `ENETUNREACH` for it; the pooler host is IPv4-reachable.
- `DATABASE_SSL_ROOT_CERT` — optional. The Supabase project CA in PEM form, used only when the deployment reports `self-signed certificate in certificate chain`. Certificate verification stays enabled; LIFEGEN adds this CA to Node's system root certificates.
- `SETUP_KEY` — private random setup code of 32+ characters; needed only until the first Admin is created.

The two database URLs must point to the same Supabase project and database. Never put them in public/build-time browser variables, and never set `NODE_TLS_REJECT_UNAUTHORIZED=0`. See the SQL guide for how to locate the URLs, download the project certificate, and use the session-pooler alternative.

Vercel should use the **Express** framework preset, no output-directory override, and the repository's configured build command `npm run build && npm run db:migrate`. Redeploy after adding environment variables. The publishing helper, if used, validates the Supabase URL pair before sending these variables to the selected Vercel project, and passes `DATABASE_SSL_ROOT_CERT` along as a sensitive value when it is set here.

A **Preview** deployment that has no database variables skips the migration step with a clear build-log line instead of failing the deployment. Add the two database URLs to the Preview environment as well when preview builds should apply migrations.

The build log tells you which TLS trust store `npm run db:migrate` used, for example `TLS: certificate verification is enabled with the system root certificates (no DATABASE_SSL_ROOT_CERT set).`, and it prints an actionable hint when a connection fails with an untrusted certificate chain or an unreachable host.

## 3. Create the first Admin and verify

1. Visit `/admin` and use `SETUP_KEY` once to create the first administrator.
2. Remove `SETUP_KEY` from the host and redeploy.
3. Visit `/api/health`; a successful connection reports `supabase-postgresql`.
4. Submit one test VIP registration on the public site.
5. In Admin → **Lifegroup Tracker → Needs Lifegroup**, confirm the person appears with a VIP badge. Assign the person to a group and verify their roster entry.

The supplied workspace preview is a local demo database and has not been connected to or used to change a production Supabase project. Local tests/builds do not publish a live site; verify the deployment itself after the project owner authorizes and completes deployment.
