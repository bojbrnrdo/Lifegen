# LIFEGEN verification · current revision

## Results

- `npm run build` — passed. `scripts/check.mjs` checked 43 JavaScript files and found no database credentials in public assets.
- `npm test` — **16 passed, 0 failed** (attendance report ranges, calendar logic, Supabase publisher URL validation, VIP promotion and retirement of the one-month outcome export).
- SQL migration smoke test — all migration files from `001` through `006` applied successfully to an isolated local PGlite PostgreSQL database.
- Upgrade smoke test — `006_lifegroup_tracker.sql` applied to a local PGlite database whose migration history already contained `001`–`005`.
- `npm run test:lifegroup-integration` — passed against local PGlite/PostgreSQL over the real HTTP API:
  - a public VIP registration created linked Person + VIP registration rows;
  - the linked VIP appeared in the Lifegroup Needs queue with the VIP flag;
  - assigning them to a group removed them from the queue and preserved the VIP flag in the roster;
  - a meeting report stored attendance and returned progress containing that VIP.
  - the test removed its temporary test person, registration, group, meeting and membership afterward.

The integration script rejects a remote database URL and requires a local disposable PostgreSQL database plus a test Admin account.

## Deployment status and remaining verification

- Vercel Preview deployment for commit `9737b15` completed successfully on 2026-10-12. This was a Preview deployment, not a Production deployment.
- The repository's Vercel build command includes `npm run db:migrate`. The Preview deployment therefore uses the database URLs configured for Vercel Preview; this workspace cannot inspect whether those URLs point to a dedicated preview database or a production Supabase project. Confirm that target before promoting the deployment.
- No live Supabase credentials were present in this workspace, and no direct Supabase connection or SQL execution was run from the workspace.
- No browser automation was run for the new tracker pages. The end-to-end test covers HTTP/API/database flows, and the build check covers JavaScript assets, not pixel-level browser rendering.
- No real visitor data was created by the local preview/test; it uses disposable demo or synthetic records only.

## Supabase setup

Follow [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md) to run the SQL files in Supabase SQL Editor, set server-only connection variables, deploy, and verify a public signup reaches **Admin → Lifegroup Tracker → Needs Lifegroup**.
