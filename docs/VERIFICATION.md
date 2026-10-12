# LIFEGEN verification · current revision

## Results

- `npm run build` — passed. `scripts/check.mjs` checked 43 JavaScript files, found no database credentials in public assets, and found no TLS-verification bypass (`NODE_TLS_REJECT_UNAUTHORIZED`, disabled `rejectUnauthorized`) in `src/` or `scripts/`. The new rule was confirmed to fail the build when such a pattern is introduced.
- `npm test` — **28 passed, 0 failed** (attendance report ranges, calendar logic, Supabase publisher URL validation, Supabase TLS/CA handling, VIP promotion and retirement of the one-month outcome export).
- Supabase TLS handling (`tests/supabase-tls.test.mjs`, 11 new tests) — passed:
  - the `DATABASE_SSL_ROOT_CERT` PEM is prepended to Node's bundled Mozilla root certificates and `rejectUnauthorized` stays `true`; without the variable the system roots are still used and verification is still enabled;
  - one-line values with escaped `\n`, and CRLF values, are normalized; a value that is not PEM is rejected with a configuration error that does not echo the value;
  - remote URLs (including `?sslmode=require` and `?sslmode=no-verify`) keep verification; `localhost`, `[::1]` and an explicit `sslmode=disable` are the only paths without TLS;
  - a real TLS handshake to a loopback certificate succeeds only when that CA is in the trust store, and fails with a self-signed-certificate error when only the system roots are used — i.e. verification is genuinely enforced;
  - an existing `NODE_EXTRA_CA_CERTS` file stays trusted (verified with a real handshake) even though an explicit `ca` list would otherwise replace Node's default store;
  - the `pg` driver receives the trust store (a connection string cannot downgrade it), the migration/health hints are returned for a self-signed-chain or `ENETUNREACH` error, and the publishing helper forwards `DATABASE_SSL_ROOT_CERT` to Vercel as a sensitive variable (verified through the publish flow against a stub Vercel API) while returning no secret.
- SQL migration smoke test — all migration files from `001` through `006` applied successfully to an isolated local PGlite PostgreSQL database.
- Upgrade smoke test — `006_lifegroup_tracker.sql` applied to a local PGlite database whose migration history already contained `001`–`005`.
- Local deployment-path checks after this change (disposable PGlite gateway on `127.0.0.1`, synthetic demo data only): `npm run db:migrate` connected over the local gateway (which refuses SSL) and printed the new TLS trust-store summary line before skipping already-applied versions; the Express app started and `/api/health` returned `200 {"ok":true,"database":"local-postgresql-demo"}`. A migrate attempt against a placeholder direct host printed the new network hint from a DNS failure (`ENOTFOUND`); no Supabase database was contacted and no SQL was run against one.
- `npm run test:lifegroup-integration` — re-run after this change and passed against local PGlite/PostgreSQL over the real HTTP API:
  - a public VIP registration created linked Person + VIP registration rows;
  - the linked VIP appeared in the Lifegroup Needs queue with the VIP flag;
  - assigning them to a group removed them from the queue and preserved the VIP flag in the roster;
  - a meeting report stored attendance and returned progress containing that VIP.
  - the test removed its temporary test person, registration, group, meeting and membership afterward.

The integration script rejects a remote database URL and requires a local disposable PostgreSQL database plus a test Admin account.

The certificate and key in `tests/fixtures/` are a throwaway loopback pair generated for the TLS tests only (CN=localhost, SAN `localhost`/`127.0.0.1`/`::1`). They are not credentials for any service, are never loaded by the application, and are excluded from the release ZIP.

## Deployment status and remaining verification

- This revision's TLS handling was not deployed from this workspace. The fix for `self-signed certificate in certificate chain` only takes effect after the project owner sets `DATABASE_SSL_ROOT_CERT` on the Vercel project (when the certificate chain requires it), uses the Session Pooler URL on port `5432` for `DATABASE_DIRECT_URL`, and redeploys. Confirm the `npm run db:migrate` TLS line in the build log and `/api/health` after that deployment.
- Vercel Preview deployment for commit `9737b15` completed successfully on 2026-10-12. This was a Preview deployment, not a Production deployment.
- The repository's Vercel build command includes `npm run db:migrate`. The Preview deployment therefore uses the database URLs configured for Vercel Preview; this workspace cannot inspect whether those URLs point to a dedicated preview database or a production Supabase project. Confirm that target before promoting the deployment.
- No live Supabase credentials were present in this workspace, and no direct Supabase connection or SQL execution was run from the workspace.
- No browser automation was run for the new tracker pages. The end-to-end test covers HTTP/API/database flows, and the build check covers JavaScript assets, not pixel-level browser rendering.
- No real visitor data was created by the local preview/test; it uses disposable demo or synthetic records only.

## Supabase setup

Follow [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md) to run the SQL files in Supabase SQL Editor, set server-only connection variables, deploy, and verify a public signup reaches **Admin → Lifegroup Tracker → Needs Lifegroup**.
