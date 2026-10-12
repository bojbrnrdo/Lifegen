# LIFEGEN architecture and ZIP review

## Supplied ZIP vs. repository

The supplied `google_drive/lifegentracker-update (9).zip` is a separate CommonJS Express tracker application. Its database adapter supports SQLite/libSQL/PostgreSQL behind a SQLite-compatible API and its route/schema names differ from this repository. It is not a drop-in source bundle for the current application.

This repository is an ES-module Express app with normalized PostgreSQL tables and a same-origin public/Admin frontend. Tracker screens were adapted into its Admin routes and use its authenticated `/api/tracker/:method` API. Tracker persistence is implemented against this repository's schema in `src/lifegroups.js` and `database/006_lifegroup_tracker.sql`; the ZIP's database adapter, SQL migrations, and standalone routes are not copied into runtime. This avoids running two web apps or maintaining two databases.

The current app uses Supabase PostgreSQL by supplying private `DATABASE_URL` and `DATABASE_DIRECT_URL` server settings. The temporary workspace preview uses local demo PostgreSQL only. It does not establish a connection to the church's Supabase project.

## Server modules

- `src/app.js`: Express entry point, security headers, public/Admin page routing, API dispatch and explicit permission checks for People, attendance, registrations, Lifegroups, Networks and meetings.
- `src/db.js`: PostgreSQL/TLS pool for application calls, separate direct/session-pooler client for migrations and `LISTEN`, transaction wrapper, data serialization and backups.
- `src/domain.js`: People and Sunday attendance business rules, including VIP-linked status promotion after five distinct verified Sundays.
- `src/lifegroups.js`: PostgreSQL read/write operations for the tracker: Networks, Lifegroups, membership history, VIP-needs queue, meeting attendance, progress and validation.
- `src/auth.js`: scrypt password hashing, hashed session identifiers, HttpOnly cookies, CSRF/origin checks, roles and server-side Viewer redaction.
- `src/public-api.js`: public VIP registration, portal/recovery, Sunday check-in, prayer/reaction persistence and public calendar endpoints.
- `src/events.js`: persistent PostgreSQL `LISTEN`, finite SSE streams and reconnect/fallback support.
- `src/migration.js`: application backup export; it does not automatically import the supplied ZIP's database or legacy records.
- `database/001_init.sql` through `database/006_lifegroup_tracker.sql`: versioned PostgreSQL schema migrations. See [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md) for the execution order and Supabase configuration.

## Frontends and routes

- `public/lifegen/`: public site, VIP signup/portal and click-to-load media embeds.
- `public/admin/`: authenticated Admin portal.
- `public/admin/js/views/lifegroups.js` and `progress.js`: separate Lifegroup Tracker section, Network pages and weekly progress views.

One Express application serves `/` and `/admin`. Both frontends call same-origin relative API URLs; there is no tracker iframe and no direct browser-to-database connection. The Admin has `#/lifegroups`, `#/lifegroups/:id`, and `#/networks/:id` routes. `lifegroups:view` and `lifegroups:manage` permissions gate the views and writes.

## VIP registration flow

1. Validate same-origin, consent, rate limit, form details and idempotency key.
2. In one database transaction, create the linked `people` record, `vip_registrations` row and secure portal session.
3. The tracker needs queue joins unassigned active people against `vip_registrations`, prioritizes VIPs and marks each linked VIP visibly.
4. When assigned, a VIP leaves the unassigned queue but remains marked in the group roster and meeting progress.
5. Attendance reports create/update a group meeting and present/absent/devotion marks for its current roster.

The dedicated one-month VIP outcome/export flow and its migration side effects are retired. Existing legacy outcome columns, if already present, are not destructively dropped. The ordinary VIP portal's monthly prize progress is separate and remains available; it does not assign a group.

## PostgreSQL and Supabase safety

- Supabase URLs are read only by the server; no Supabase keys or PostgreSQL URLs are shipped in browser assets.
- `DATABASE_URL` supports the application pooler; `DATABASE_DIRECT_URL` must be the direct host or Supabase session pooler on port `5432`, because schema migration and long-lived notifications need a session. The pooler host is also the IPv4-reachable choice for hosts such as Vercel that report `ENETUNREACH` for the IPv6-only direct host.
- Database TLS is built in one place (`connectionOptions`/`databaseSslOptions` in `src/db.js`): verification is always on, Node's bundled Mozilla root certificates are always trusted, and the optional private `DATABASE_SSL_ROOT_CERT` PEM adds the Supabase project CA for hosts that need it. The connection string cannot weaken this — the old `sslmode`/`ssl` parameters are stripped, and only `sslmode=disable`/`ssl=false` requests an explicit plaintext connection. `scripts/check.mjs` fails the build if `NODE_TLS_REJECT_UNAUTHORIZED` or a disabled `rejectUnauthorized` appears in server code.
- Tracker/app tables use server-side access. Migration `006` enables row-level security and revokes `PUBLIC`, `anon`, and `authenticated` table privileges on LIFEGEN tables only. It does not change unrelated public-schema tables.
- `003`, `004`, and `005` have been converted to non-destructive no-op migration markers so they cannot drop the tracker or recreate the one-month outcome export.
- `database/001_init.sql` also limits its access revocation to LIFEGEN tables.

## Verification boundaries

Automated checks and a local HTTP/database integration test exercise a disposable local PostgreSQL database. They do not connect to or verify a live Supabase project. A successful build is not evidence of a Vercel deployment. See [`VERIFICATION.md`](VERIFICATION.md) for the checks run for this revision and the required limits.
