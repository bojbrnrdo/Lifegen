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

   Run the files one at a time, in that order, and wait for a successful completion before moving to the next. Keep the SQL text unchanged. `001` and `006` also create private migration/version records; all files are transaction-wrapped.

3. If LIFEGEN migrations `001`–`005` were already applied to this project, **do not recreate or reset the database**. Back it up and run `database/006_lifegroup_tracker.sql` to restore the tracker tables. The retired `003` file in this branch is a no-op, so it will not drop existing tracker data.
4. Verify the migration versions and tracker tables in SQL Editor:

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

Do not paste real connection strings into source code, browser JavaScript, a public ZIP, chat, or Git. For local work, keep them in a private `.env` file ignored by Git. Do not run demo seed scripts against the church database.

## Set the Supabase connection variables

In **Project Settings → Database → Connection string**, copy connection URIs for the same project and `postgres` database:

- `DATABASE_URL`: use Supabase's **Transaction pooler** URI (usually port `6543`) for normal application requests on a serverless host.
- `DATABASE_DIRECT_URL`: use the direct `db.<project-ref>.supabase.co` URI when reachable. If the host cannot reach Supabase's direct endpoint, use Supabase's **Session pooler** URI on port `5432` instead. The session pooler is required for schema migrations and persistent PostgreSQL `LISTEN` updates; do **not** use transaction pooling for this variable.

The server verifies that both URLs refer to the same Supabase project/database. Keep both values private and set them only in the server environment (for example, Vercel Project → Settings → Environment Variables). Also set `SETUP_KEY` to a random secret of at least 32 characters before first-admin setup. Never expose it in a public environment variable.

For local development, copy the names into a Git-ignored `.env` file in the repository root. Do not change `LOCAL_DEMO=true` to production; the production host should use the Supabase variables and `LOCAL_DEMO=false`.

## Deploy and verify

1. Set the private `DATABASE_URL`, `DATABASE_DIRECT_URL`, and `SETUP_KEY` on the server/hosting project.
2. Deploy the application. The configured build runs `npm run build && npm run db:migrate`; the migration command uses `DATABASE_DIRECT_URL` and skips versions already applied in the SQL Editor.
3. Visit `/api/health`. A configured and migrated database returns `{"ok":true,"database":"supabase-postgresql"}`.
4. Open `/admin`, create the first administrator using `SETUP_KEY`, then remove `SETUP_KEY` from the host and redeploy.
5. Submit one test registration on the public website. In Admin → **Lifegroup Tracker → Needs Lifegroup**, the person should appear with a **VIP signup** badge. Assign that person to a group; they should disappear from the unassigned queue and appear in the group roster. A new registration also appears in **Registrations** because it creates the `people` and `vip_registrations` rows in the same database transaction.

The tracker tables have row-level security enabled and browser-role grants revoked. LIFEGEN talks to PostgreSQL from its private server environment, not through the browser-facing Supabase Data API. The SQL does not create broad REST policies; keep database credentials server-side.

## Troubleshooting

- **`Database schema is missing` / `/api/health` is not OK:** confirm the URLs are for the same project and run the SQL files in order. Do not add a second database just to make the error go away.
- **Connection or migration timeout:** confirm `DATABASE_DIRECT_URL` is the direct endpoint or session pooler on port `5432`, and that the encoded password is correct. A `6543` transaction-pooler URI belongs in `DATABASE_URL`, not `DATABASE_DIRECT_URL`.
- **SQL says a table/column already exists or a query reports missing columns:** the existing schema may be from another LIFEGEN version or app. Stop before applying schema-repair statements; take a backup and map the old schema/data explicitly.
- **Registration appears in People but not in Needs Lifegroup:** check that its linked `vip_registrations.person_id` exists, the person is active, and they do not already have a current Lifegroup membership. The queue intentionally excludes people already assigned to a group.
