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
- `src/youth-welfare.js`: Youth Welfare eligibility, actual-record summaries/analytics, directory/profile/category queries, data-quality checks, follow-up tasks/reminders, per-user saved views/report templates, verified monthly registration trends, source status, guarded CSV exports, access management, correction review/history, global search, and filtered activity. It excludes archived People and every person linked to a VIP registration; regular website registrations are identified by `registration_source='public'` or the `public_registration` audit event. Protected answers use canonical Person IDs; there is no separate People database, sync job, attendance feed, or historical category snapshot.
- `src/youth-welfare-form.js`: canonical Youth Welfare question choices, exact consent statement/version, conditional validation, and answer normalization for the existing Regular Attendee Registration.
- `src/public-api.js`: public VIP and regular-attendee registration, the integrated Youth Welfare questionnaire, portal/recovery, Sunday check-in, prayer/reaction persistence and public calendar endpoints.
- `src/events.js`: persistent PostgreSQL `LISTEN`, finite SSE streams and reconnect/fallback support.
- `src/service-cycle.js`: the single Asia/Manila Sunday service-cycle source shared by the hero countdown, the `/vip-announce` projector and the VIP service-date attribution rule.
- `src/vip-announcement.js`: reads the announced VIP names, inviters and total for one Sunday service and serves the public change stream behind the projector.
- `src/vip-designs.js`: the announcement design library — validation and dimension sniffing of PNG/JPEG/WebP uploads, the storage adapter (Supabase Storage or `bytea`), and the database-backed rotation that picks one design per Sunday service date.
- `src/migration.js`: application backup export; it does not automatically import the supplied ZIP's database or legacy records.
- `database/001_init.sql` through `database/015_youth_welfare_records.sql`: versioned PostgreSQL schema migrations. Migrations `011`–`014` add separate ministry categories, workspace tasks/views/reminders, least-privilege portal roles, and additive access assignments that preserve primary LIFEGEN roles. Migration `015` adds protected Youth Welfare answers/consent, correction proposals, private history, and hashed public-registration idempotency. These are server-mediated tables with RLS and no browser-role grants. See [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md) for execution order and staging-first Supabase setup.

## Frontends and routes

- `public/lifegen/`: public site, existing VIP signup/portal, existing Regular Attendee Registration (with the additive conditional Youth Welfare questionnaire), and click-to-load media embeds.
- `public/vip-announce/`: public, read-only fullscreen VIP announcement projector served at `/vip-announce`, including the `?preview=1` layout check.
- `public/admin/js/views/designs.js`: the Admin → VIP Designs management screen (upload, rename, enable/disable, delete, override the Sunday pick).
- `public/admin/`: authenticated Admin portal.
- `public/youth-welfare/`: separate Youth Welfare login and multi-section workspace; uses the existing server-side staff authentication and password-change endpoints.
- `public/admin/js/views/lifegroups.js` and `progress.js`: separate Lifegroup Tracker section, Network pages and weekly progress views.

One Express application serves `/`, `/vip-announce`, `/admin`, and `/youth-welfare`. All frontends call same-origin relative API URLs; there is no tracker iframe and no direct browser-to-database connection. The Admin has `#/lifegroups`, `#/lifegroups/:id`, and `#/networks/:id` routes. `lifegroups:view` and `lifegroups:manage` permissions gate those views and writes, and `settings:manage` gates the VIP design library. Youth Welfare endpoints independently require `youth_welfare:view`, classification writes require `youth_welfare:classify`, and task/view/template/reminder writes require the narrow `youth_welfare:manage` permission. Youth Welfare Admin, Staff, and Viewer roles receive only the read-only `youth_welfare:tracker:view` permission for the current membership's Lifegroup/Network, eligible group and network leader names, membership role/tier, and joined date through `/api/youth-welfare/people/:id/lifegroup-tracker`. LIFEGEN Admin can use the same endpoint under its existing `lifegroups:view` permission. This endpoint excludes former memberships, attendance/devotion/progress, free-text notes, archived people, and VIP-linked leaders. Youth Welfare permissions are composed from the shared LIFEGEN role plus the separate `youth_welfare_access` assignment. Youth Welfare Admin receives portal view/classify/manage, access-management, authorized private-profile, and current-Tracker-assignment permissions; Staff receives portal view, limited welfare-record management, and current-Tracker-assignment permissions, but not school-stop reasons, private family/contact fields, or access management; Viewer receives portal view and current-Tracker-assignment permissions only. Access grants and revocations do not replace the primary LIFEGEN role and are written to the existing `audit_log`. All portal-only roles are redirected to `/youth-welfare` from `/admin` and receive no VIP, main Admin, People, attendance, registration, settings, or unrelated Admin permissions. Viewer write controls are hidden and all mutations remain blocked server-side.

## Youth Welfare data and reporting boundaries

The canonical source is LIFEGEN PostgreSQL `public.people`. Eligibility is evidenced by `registration_source='public'` or a `people` / `public_registration` audit event (including a regular registration that reused an existing Person). Archived rows and any person linked by `vip_registrations.person_id` are excluded server-side across every People metric, profile, task, search, activity result, and export. Ministry categories live in `youth_welfare_categories`; they never rewrite original registration answers, and no category is inferred from age, school, or other unrelated fields.

Registration reports count distinct People with actual `public_registration` audit events during the selected Asia/Manila dates. Monthly trends count distinct eligible people per month; a person may appear in more than one month. Category breakdowns show current ministry classifications only; they are not historical snapshots or attendance totals. The Data Quality section checks missing supported fields and exact normalized-email duplicates for manual review. Independent reconciliation with historical Google Form responses is unavailable: no authorized response spreadsheet/source snapshot has been verified, so no import or discrepancy count is claimed. Canonical People keeps name, birthday, sex, school/course, occupation, ministry, inviter, and registration details. After migration `015_youth_welfare_records.sql`, the questionnaire's separate education, grade/year, school-stop period/reasons, continuation, LCSOL, invitation date, guardian/contact answers, and Youth Welfare consent are stored by existing Person ID in protected tables. Re-submissions for an existing Welfare record enter the Admin-reviewed correction queue; approval saves the prior state to Admin-only history and resets verification. Staff receives only the approved reduced education/LCSOL profile; Viewer has basic profile visibility; family/contact and individual school-stop reasons remain Admin-only and are excluded from general reports/exports. Verification is explicit and requires complete supported data; unanswered values and statuses are never inferred. New tables use RLS and revoked browser-role privileges.

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

## Public asset caching

Public CSS/JS is referenced from the HTML with a per-file version
(`/lifegen/styles.css?v=2.4.10`). When that version is present, `src/app.js`
serves the file with `Cache-Control: public, max-age=31536000, immutable`, so the
version string is the cache key: a file whose bytes change without its version
changing stays stale in every browser that already loaded it, and in any CDN in
front of it. That is exactly how a banner fix once failed to appear.

- After editing anything under `public/**` that the HTML versions, run
  `npm run assets:version`. It records each asset's SHA-256 in
  `asset-versions.json`, raises the patch version of any file whose bytes differ,
  and rewrites the HTML.
- `tests/asset-versions.test.mjs` fails when a recorded hash no longer matches
  the file, with the instruction above, so a forgotten bump cannot ship.
- `/admin` assets are not versioned: they are served `no-store`, and the page
  rewrite embeds `ADMIN_ASSET_VERSION` for the entry points instead.

## Verification boundaries

Automated checks and a local HTTP/database integration test exercise a disposable local PostgreSQL database. They do not connect to or verify a live Supabase project. A successful build is not evidence of a Vercel deployment. See [`VERIFICATION.md`](VERIFICATION.md) for the checks run for this revision and the required limits.
