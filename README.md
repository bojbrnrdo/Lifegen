# LIFEGEN · Supabase PostgreSQL + integrated Lifegroup Tracker

LIFEGEN serves its public website at `/` and its protected Admin portal at `/admin` from one Express app. The website, VIP registration flow, attendance, people records and Lifegroup Tracker use the same **server-side Supabase PostgreSQL** database. The browser talks only to same-origin `/api` endpoints; database credentials are never placed in public assets.

> **Preview note:** the current workspace/preview uses a temporary local PostgreSQL demonstration database. It is not connected to the church's Supabase project. No production Supabase credentials are included in this repository.

## What is included

- Public LIFEGEN website, VIP registration and private VIP portal.
- Admin pages for people, Sunday attendance, VIP registrations, reports, settings and the Lifegroup Tracker.
- Tracker pages for Networks, Lifegroups, active/former membership, Open/Closed cell tiers, weekly meeting reports and attendance progress.
- Staff, Admin and read-only Viewer permissions with server-side authorization.

### VIP → Lifegroup follow-up

Each new VIP registration creates its linked `people` and `vip_registrations` rows in one database transaction. The person is immediately shown in **Admin → Lifegroup Tracker → Needs Lifegroup** with a VIP badge, stays there until assigned, and is identified as a VIP in the group roster afterward. New signups are also available in the Registrations page.

The special one-month VIP outcome/export feature has been removed. The Registrations page no longer exports VIP attendance outcomes. The public VIP portal's monthly prize progress remains separate from Lifegroup placement.

## Configure Supabase

Follow [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md) for the exact SQL Editor sequence, Supabase connection URL guidance, deployment environment variables, and post-deploy checks.

The SQL files are under `database/`. For a fresh LIFEGEN schema, run them in order from `001_init.sql` through `006_lifegroup_tracker.sql`; `003`, `004`, and `005` are retained retired no-op migration markers. For an existing LIFEGEN deployment with migrations `001`–`005` already applied, back up first and run the additive `006_lifegroup_tracker.sql` migration to restore the tracker tables.

Connection variables are private server settings:

- `DATABASE_URL`: Supabase transaction-pooler URL for regular server traffic.
- `DATABASE_DIRECT_URL`: Supabase direct URL, or session-pooler URL on port `5432`, for migrations and PostgreSQL live notifications. Do not use transaction pooling for this variable.
- `SETUP_KEY`: temporary private code for first-admin setup; remove it after the account is created.

The runtime migration command is `npm run db:migrate`. Migrations are versioned and skip versions already recorded in `schema_migrations`. Do not run demo seed scripts against production.

## Run locally

Requires Node.js 20.19 or newer and an isolated PostgreSQL database. Keep `.env` out of Git and never use church production data for destructive tests.

```bash
npm ci
# Set DATABASE_URL, DATABASE_DIRECT_URL and SETUP_KEY in a private .env file.
npm run db:migrate
npm run build
npm start
```

The SQL setup guide includes connection examples and the local verification steps. The repository's temporary PGlite preview scripts are under `preview-db/` and use clearly labelled demo data.

## Tests

```bash
npm test
npm run build
```

The local end-to-end VIP-to-tracker integration check exercises a real HTTP app and database. It refuses non-local database hosts and removes its test registration/group afterward:

```bash
LIFEGEN_INTEGRATION_DATABASE_URL='postgres://…@127.0.0.1:5433/lifegen' \
LIFEGEN_INTEGRATION_ADMIN_USERNAME='demo@lifegen.local' \
LIFEGEN_INTEGRATION_ADMIN_PASSWORD='your-local-demo-password' \
npm run test:lifegroup-integration
```

Do not point this test at Supabase or another remote/production database. The command is for an isolated local database with the LIFEGEN schema and an existing test Admin account.

## Deployment notes

The app expects an Express-compatible host and a PostgreSQL URL supplied only in that host's server environment. See [`DEPLOY-FIRST.md`](DEPLOY-FIRST.md) for the Vercel launch path. A successful local build or integration run is not evidence that an external deployment has been published; verify `/api/health` and test the live site after deployment.

## Media

The video cards use click-to-load official media players. Facebook may refuse to embed a particular Reel because of the Reel owner's rights/embedding settings; changing the iframe cannot bypass Facebook's block. For a chrome-free highlight player, use a video file the church owns (or is authorized to publish) and host it as a direct `.mp4`, or provide a provider URL that permits embedding.
