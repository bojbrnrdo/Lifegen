# Supabase SQL and connection setup

This LIFEGEN build uses **Supabase PostgreSQL through the server-side `pg` driver**. The browser does not connect to Supabase and needs no Supabase anon/publishable key. The local preview database is temporary demo data; it is not the church's Supabase project, and this repository contains no live database credentials.

## Before you start

1. Open the Supabase project intended for LIFEGEN.
2. Take a database backup before changing an existing project.
3. Confirm that `public.people`, `public.services`, `public.settings`, and `public.vip_registrations` are either absent or already have the LIFEGEN schema. The SQL files use `CREATE TABLE IF NOT EXISTS`; they do **not** transform an unrelated table that happens to have the same name. If this is an older/custom schema or contains records that must be retained, stop and prepare a table-by-table migration rather than assuming the files import it.
4. Run SQL as the project database owner (the normal Supabase SQL Editor role). Use a dedicated Supabase project/schema for LIFEGEN when possible.

The scripts are additive and do not drop business tables. Migrations `003`, `004`, and `005` have been retired as non-destructive no-ops; they are retained only so older migration histories can progress safely. In particular, the one-month VIP outcome/export columns and status options are not added to fresh installs.

## Option A — run the SQL in Supabase Dashboard

1. In the Supabase dashboard, select the LIFEGEN project and open **SQL Editor**.
2. For a **fresh LIFEGEN database**, open each file from this repository's `database/` folder and run its complete contents in this order:

   1. `database/001_init.sql`
   2. `database/002_calendar_events.sql`
   3. `database/002_vip_attendance_member.sql`
   4. `database/003_drop_tracker_tables.sql` (retired no-op; safe to run)
   5. `database/004_vip_window_outcome.sql` (retired no-op; does not add the export columns)
   6. `database/005_people_status_outcomes.sql` (retired no-op; does not add outcome statuses)
   7. `database/006_lifegroup_tracker.sql`
   8. `database/007_vip_service_date.sql`
   9. `database/008_vip_design_library.sql`

   Run the files one at a time, in that order, and wait for a successful completion before moving to the next. Keep the SQL text unchanged. `001`, `006`, `007` and `008` also create private migration/version records; all files are transaction-wrapped.

3. If LIFEGEN migrations `001`–`005` were already applied to this project, **do not recreate or reset the database**. Back it up and run `database/006_lifegroup_tracker.sql` to restore the tracker tables. The retired `003` file in this branch is a no-op, so it will not drop existing tracker data.
4. If LIFEGEN migrations `001`–`006` are already applied, run `database/007_vip_service_date.sql` on its own. It is additive and non-destructive: it adds `vip_registrations.service_date`, backfills it from `created_at` in `Asia/Manila`, adds two partial unique indexes that stop duplicate registrations inflating the announced VIP count, and creates the announcement-window settings rows. No registration row is deleted.
5. If LIFEGEN migrations `001`–`007` are already applied, run `database/008_vip_design_library.sql` on its own. It is additive and non-destructive: it creates the `vip_designs` artwork library and the `vip_service_designs` per-Sunday selection table, and touches no existing table. No VIP registration, person or lifegroup record is read, changed or deleted.
6. Verify the migration versions and tracker tables in SQL Editor:

   ```sql
   SELECT version FROM public.schema_migrations ORDER BY version;

   SELECT to_regclass('public.' || table_name) AS table_name
   FROM unnest(ARRAY[
     'networks', 'lifegroups', 'lifegroup_memberships',
     'lifegroup_meetings', 'lifegroup_meeting_attendance'
   ]) AS t(table_name);
   ```

   Every returned `table_name` should be non-NULL. Existing deployments may already have applied-version rows, so compare the result with the files they have run.

## Option B — use the migration command

Use this when you control a development machine or hosting build with private database environment variables set. `npm run db:migrate` reads the same ordered SQL files and skips versions already recorded in `schema_migrations`.

```bash
npm ci
DATABASE_URL='postgresql://…' \
DATABASE_DIRECT_URL='postgresql://…' \
npm run db:migrate
```

Add `DATABASE_SSL_ROOT_CERT='-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'` in the same way when this machine reports the self-signed-chain error (see the TLS section below).

Do not paste real connection strings into source code, browser JavaScript, a public ZIP, chat, or Git. For local work, keep them in a private `.env` file ignored by Git. Do not run demo seed scripts against the church database.

## Set the Supabase connection variables

In **Project Settings → Database → Connection string**, copy connection URIs for the same project and `postgres` database:

- `DATABASE_URL`: use a Supabase **pooler** URI (`aws-0-<region>.pooler.supabase.com`) for normal application requests on a serverless host. The pooler host is IPv4-reachable, so it works from Vercel; the transaction pooler (port `6543`) and the session pooler (port `5432`) are both accepted here.
- `DATABASE_DIRECT_URL`: use the direct `db.<project-ref>.supabase.co` URI when reachable. If the host cannot reach Supabase's direct endpoint, use Supabase's **Session pooler** URI on port `5432` instead. The session pooler is required for schema migrations and persistent PostgreSQL `LISTEN` updates; do **not** use transaction pooling for this variable.

Supabase's direct `db.<project-ref>.supabase.co` record is IPv6-only for projects without the IPv4 add-on. On a host without IPv6 egress (Vercel reports `ENETUNREACH`) the build and the app cannot use it: put the Session Pooler URL on port `5432` in `DATABASE_DIRECT_URL` and the pooler URL in `DATABASE_URL`. A session-pooler URI looks like `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`; note that the pooler username contains the project reference. LIFEGEN's migration command accepts the direct host or the session pooler on port `5432`, but not the port `6543` transaction pooler.

The server verifies that both URLs refer to the same Supabase project/database. Keep both values private and set them only in the server environment (for example, Vercel Project → Settings → Environment Variables). Also set `SETUP_KEY` to a random secret of at least 32 characters before first-admin setup. Never expose it in a public environment variable.

For local development, copy the names from `.env.example` into a Git-ignored `.env` file in the repository root. Do not change `LOCAL_DEMO=true` to production; the production host should use the Supabase variables and `LOCAL_DEMO=false`.

## TLS trust for the Supabase certificate (`DATABASE_SSL_ROOT_CERT`)

LIFEGEN always verifies the database server certificate. Depending on the endpoint and the host's root store, a deployment can fail with:

```text
error: self-signed certificate in certificate chain
```

Supabase's database endpoints can present a chain that ends in a project-minted CA, which a Vercel build machine does not carry in its own trust store. The fix is to give the server that CA; it is never a reason to disable verification:

1. In the Supabase dashboard open **Project Settings → Database → SSL configuration** and download the project certificate (a PEM `.crt` file). Keep the `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` lines.
2. Add a private server variable `DATABASE_SSL_ROOT_CERT` whose value is that PEM text. Multi-line values work; a single line with `\n` escapes is also accepted. Vercel: **Project → Settings → Environment Variables**, Production and Preview.
3. Redeploy. LIFEGEN adds the project CA to Node's bundled Mozilla root certificates, so both the project CA and the public roots stay trusted. Certificate verification (`rejectUnauthorized: true`) is unchanged.
4. Confirm it took effect: in the build log, the `npm run db:migrate` step prints either `TLS: certificate verification is enabled with the Supabase project CA from DATABASE_SSL_ROOT_CERT plus the system root certificates.` or `... (no DATABASE_SSL_ROOT_CERT set)`. It never prints the certificate itself. Then check `/api/health`.

Notes:

- This variable is optional. The session pooler (port `5432`) and transaction pooler (port `6543`) hosts chain to a public CA, so they usually need no extra setting. Set it when the direct `db.<project-ref>.supabase.co` host, or a pooler region, presents the project CA — or whenever the deployment reports the self-signed-chain error.
- Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` and never disable certificate checks in code. `npm run build` fails if either pattern appears in server code. `NODE_EXTRA_CA_CERTS`, if you already use it for another private CA, stays effective: LIFEGEN re-reads that file because an explicit `ca` list would otherwise replace Node's default trust store.
- If the error continues after the CA is set, the value is not the CA for that project (or the host is being intercepted). Re-download it rather than weakening TLS.
- `DATABASE_URL`/`DATABASE_DIRECT_URL` may include `?sslmode=require`; that is fine. `sslmode=disable` (or `ssl=false`) is the only value that asks for a plaintext connection and must not be used for Supabase.

## Deploy and verify

1. Set the private `DATABASE_URL`, `DATABASE_DIRECT_URL`, and `SETUP_KEY` on the server/hosting project. Use the pooler host on Vercel, and add `DATABASE_SSL_ROOT_CERT` only if the build reports the self-signed-chain error (see the TLS section above).
2. Deploy the application. The configured build runs `npm run build && npm run db:migrate`; the migration command uses `DATABASE_DIRECT_URL` and skips versions already applied in the SQL Editor.
3. Visit `/api/health`. A configured and migrated database returns `{"ok":true,"database":"supabase-postgresql"}`.
4. Open `/admin`, create the first administrator using `SETUP_KEY`, then remove `SETUP_KEY` from the host and redeploy.
5. Open Admin → **VIP Designs** and upload one landscape PNG. Preview it on the projector
   at `/vip-announce?preview=1`. Reload the page: the same design must come back, because
   the pick is recorded in the database against the Sunday, not chosen per browser.
6. Submit one test registration on the public website. In Admin → **Lifegroup Tracker → Needs Lifegroup**, the person should appear with a **VIP signup** badge. Assign that person to a group; they should disappear from the unassigned queue and appear in the group roster. A new registration also appears in **Registrations** because it creates the `people` and `vip_registrations` rows in the same database transaction.

### VIP announcement artwork storage

Uploaded announcement designs are the only binary files LIFEGEN stores. Choose one of two
backends; the application detects which one is active from the environment, so no code
change is needed.

**Supabase Storage (recommended for a real deployment).** Set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` on the server, then:

1. Supabase → **Storage** → **New bucket** → name it `vip-designs` (or set
   `SUPABASE_STORAGE_BUCKET` to whatever you named it).
2. Keep the bucket **private**. Do not add a public-read policy.
3. Do not create a browser-facing INSERT/UPDATE/DELETE policy for this bucket. Uploads
   and deletes go through the LIFEGEN server with the service-role key, which is a
   private server setting.

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security, so treat it exactly like the
database password: server-side only, never in a `NEXT_PUBLIC_`/`VITE_` variable, never in
browser JavaScript, never committed. The Admin portal and the projector never receive it —
they read artwork through the same-origin route `/api/vip-design-image/:id/:file`, which
streams the bytes after checking the request. That is why the bucket can stay private.

**PostgreSQL `bytea` (the default when Storage is not configured).** The file bytes are
kept in the `vip_designs.data` column. Nothing to set up; suitable for a small library, but
it grows the database, and the JSON backup from `/api/backup` carries the metadata only —
the bytes are restored with the database itself.

Uploads are validated in both cases: PNG, JPEG or WebP only (checked from the file header,
not the filename), 8 MB by default, and the same artwork cannot be stored twice.

The tracker tables have row-level security enabled and browser-role grants revoked. LIFEGEN talks to PostgreSQL from its private server environment, not through the browser-facing Supabase Data API. The SQL does not create broad REST policies; keep database credentials server-side.

## Troubleshooting

- **`Database schema is missing` / `/api/health` is not OK:** confirm the URLs are for the same project and run the SQL files in order. Do not add a second database just to make the error go away.
- **Connection or migration timeout:** confirm `DATABASE_DIRECT_URL` is the direct endpoint or session pooler on port `5432`, and that the encoded password is correct. A `6543` transaction-pooler URI belongs in `DATABASE_URL`, not `DATABASE_DIRECT_URL`.
- **`self-signed certificate in certificate chain` (or `unable to verify the first certificate`):** set the private `DATABASE_SSL_ROOT_CERT` to the Supabase project CA and redeploy, as described in the TLS section. `npm run db:migrate` prints this reminder in the build log. Do not disable certificate verification.
- **`ENETUNREACH` / `EHOSTUNREACH` while connecting or migrating:** the runtime has no route to the IPv6-only direct Supabase host. Switch `DATABASE_DIRECT_URL` to the Session Pooler URL on port `5432`, and use the pooler URL for `DATABASE_URL`. `npm run db:migrate` prints the same hint.
- **A `pooler.supabase.com` URL is rejected:** use port `5432` (session) for `DATABASE_DIRECT_URL` and keep the pooler username in the `postgres.<project-ref>` form. Port `6543` (transaction pooling) may be used for `DATABASE_URL` only.
- **SQL says a table/column already exists or a query reports missing columns:** the existing schema may be from another LIFEGEN version or app. Stop before applying schema-repair statements; take a backup and map the old schema/data explicitly.
- **Registration appears in People but not in Needs Lifegroup:** check that its linked `vip_registrations.person_id` exists, the person is active, and they do not already have a current Lifegroup membership. The queue intentionally excludes people already assigned to a group.
