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

## Not verified

- No live Supabase credentials were present in this workspace; the Supabase SQL was **not** applied to a church/production project and no live Supabase connection was tested.
- No Vercel deployment or real hosting publish was performed.
- No browser automation was run for the new tracker pages. The end-to-end test covers HTTP/API/database flows, and the build check covers JavaScript assets, not pixel-level browser rendering.
- No real visitor data was created in Supabase. The local preview/test uses disposable demo or synthetic records only.

## Supabase setup

Follow [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md) to run the SQL files in Supabase SQL Editor, set server-only connection variables, deploy, and verify a public signup reaches **Admin → Lifegroup Tracker → Needs Lifegroup**.
