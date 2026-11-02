# LIFEGEN · Supabase PostgreSQL + integrated Lifegroup Tracker

LIFEGEN serves its public website at `/`, protected Admin portal at `/admin`, and separate Youth Welfare workspace at `/youth-welfare` from one Express app. Public Regular Attendee Registration includes the Youth Welfare questionnaire; VIP registration, QR destination, attendance, People, and Tracker continue using the existing workflows and shared **server-side Supabase PostgreSQL** database. The browser talks only to same-origin `/api` endpoints; database credentials are never placed in public assets.

> **Preview note:** this Arena preview is not connected to production Supabase, and live/authenticated API data is unavailable unless a database is configured. The repository's optional `preview-db/` PGlite environment is disposable demo infrastructure, not the church database. No production credentials are included.

## What is included

- Public LIFEGEN website, VIP registration and private VIP portal.
- Admin pages for people, Sunday attendance, VIP registrations, reports, settings and the Lifegroup Tracker.
- Tracker pages for Networks, Lifegroups, active/former membership, Open/Closed cell tiers, weekly meeting reports and attendance progress.
- Staff, Admin and read-only Viewer permissions with server-side authorization.
- A Youth Welfare workspace at `/youth-welfare` inside the existing LIFEGEN app, using the shared staff login and password-change flow. Its responsive dark-violet interface includes dashboard, People Management, correction review, Education Monitoring, LCSOL Progress, follow-ups, reports, data-quality checks, data status, activity logs, saved views, access management, and settings. Admin, Staff, and Viewer portal access can be managed for existing LIFEGEN accounts without replacing their primary role; changes are audited and server-authorized. After migration 015, Youth Welfare answers and consent are stored separately by canonical Person ID; re-submissions for an existing Welfare record become Admin-reviewed proposals. The workspace reads regular registrations directly from the shared People database and excludes every VIP-linked person. Profiles expose only role-appropriate fields; Tracker access is limited to current Lifegroup/Network, eligible leaders, role/tier, and joined date. Former memberships, attendance/devotion, progress, and free-text Tracker notes are not exposed. School-stop reasons and family/contact data remain protected. Reports use actual source records and verified audit events, show denominators, and do not infer unanswered metrics or claim historical category snapshots. Before migration 015 is applied, protected-answer features are explicitly reported as unavailable.

### VIP → Lifegroup follow-up

Each new VIP registration creates its linked `people` and `vip_registrations` rows in one database transaction. The person is immediately shown in **Admin → Lifegroup Tracker → Needs Lifegroup** with a VIP badge, stays there until assigned, and is identified as a VIP in the group roster afterward. New signups are also available in the Registrations page.

The special one-month VIP outcome/export feature has been removed. The Registrations page no longer exports VIP attendance outcomes. The public VIP portal's monthly prize progress remains separate from Lifegroup placement.

## Sunday cycle and the fullscreen VIP announcement

`/vip-announce` is a public, read-only projector page for the tech team. Open it on the
sanctuary display and press **Fullscreen** (or the `F` key). Everything on it is rendered
from the database — no flattened image, so text changes without regenerating anything.

- Dark forest-green stage, gold border and accents, LIFEGEN branding.
- `WELCOME OUR VIPs`, the automatic Sunday date, each VIP's name and inviter, and the
  automatic total (`01 VIP TODAY`, `09 VIPs TODAY`, `12 VIPs TODAY`).
- Loading, empty and database-error states. A database failure keeps the last real
  records on screen and labels them stale — placeholder names are never substituted.
- Updates in place, so an active fullscreen session survives every refresh.

### Opening the board from the public site

The countdown card on `/` has a **Fullscreen** button in its lower-right corner. It opens
the same board as an in-page fullscreen overlay, so the tech team never needs to sign in to
Admin. Pressing **Esc** or the browser's exit control closes it. The board is mounted only on
first click, so the homepage carries no extra request until someone opens it.

### Demo: a live Sunday on the local preview

`LOCAL_DEMO_CLOCK=<Manila instant>` (honoured only when `LOCAL_DEMO=true`, never in
production or on Vercel) moves the server clock to that instant and lets it run forward in
real time. `preview-db/seed-sunday-demo.mjs` adds example VIPs for the Sunday. See
[`preview-db/README.md`](preview-db/README.md) for the exact steps.

### One service-date source

`src/service-cycle.js` is the single source of truth for the Sunday cycle in
`Asia/Manila`. The hero countdown on `/`, the projector at `/vip-announce` and the
registration attribution rule all read it, so they cannot disagree about which Sunday
is "today's". No date is hardcoded anywhere.

The cycle is a date-based state machine, derived from the server clock and persisted in
`settings` so a projector refresh never restarts the wrong phase:

```
COUNTDOWN → VIP_ANNOUNCEMENT → NEXT_SUNDAY_COUNTDOWN → COUNTDOWN …
```

| Phase | When | Projector shows |
| --- | --- | --- |
| `COUNTDOWN` | before the service start | countdown to the upcoming Sunday |
| `VIP_ANNOUNCEMENT` | from the service start, for `vip_announce_minutes` | the VIP welcome board |
| `NEXT_SUNDAY_COUNTDOWN` | after that window closes | countdown to the following Sunday |

The countdown does not switch back the instant it reaches zero; the window holds for the
configured duration.

### Settings

Stored in the `settings` table (created by `database/007_vip_service_date.sql`):

- `vip_announce_minutes` — how long the welcome board stays up. Default `30`, range 1–600.
  Set it to `120` to keep the board up for the whole service.
- `vip_announce_start` / `vip_announce_service_date` — the persisted window. Written
  automatically when the window opens; normally never edited by hand.
- `vip_announce_start_hour`, `vip_announce_start_minute`, `vip_announce_end_hour`,
  `vip_announce_end_minute` — optional overrides for the 13:00/15:00 service times.

### Which VIPs are announced

`vip_registrations.service_date` (added by migration `007`) attributes each registration
to a Sunday: registered on a Sunday → that Sunday; registered any other day → the coming
Sunday. The board lists every attributed registration for the Sunday it is showing.

Duplicate registrations cannot inflate the count. Two partial unique indexes back this at
the database level, and both are honoured on insert:

- `vip_registrations_service_person_uniq` — one attributed registration per person per Sunday.
- `vip_registrations_service_identity_uniq` — one per normalized name **and** inviter per Sunday.

A re-submitted form is still stored with a working recovery portal but is left
unattributed, so it is not announced. Two different people who share a name but were
invited by different people are two real VIPs and both appear.

### Live updates

`GET /api/public/vip-announcement` returns the names, inviters, total, Sunday date and
cycle. `GET /api/public/vip-announcement/stream` pushes changes over the existing
PostgreSQL `LISTEN lifegen_changes` channel (the same mechanism Supabase Realtime
delivers). The projector refetches on each event and also polls every 15 seconds, so it
still updates where the notification channel is unavailable — such as the local PGlite
preview database, which does not relay `NOTIFY`.

## VIP design library

The tech team uploads the announcement artwork at **Admin → VIP Designs**
(`/admin#/designs`). Nothing about a design requires editing source or redeploying.

- Batch upload by drag-and-drop or the file picker. PNG, JPEG and WebP, up to 8 MB.
- Each design keeps its filename, upload date, dimensions, display title and availability.
- Rename, enable/disable, delete (after confirmation) and preview before enabling.
- The screen shows how many designs are available, and warns when an upload looks like a
  flattened design with sample names, dates or counts already baked into the image —
  those values cannot update, so the board would go stale.
- **Preview on projector** opens `/vip-announce?preview=1`, which renders the real
  announcement layout on any day of the week using the live VIP data. It is
  presentational only: the server's cycle state is not touched.

Every uploaded file is hashed on arrival, and the same artwork cannot be stored twice.
Files live in object storage when Supabase Storage is configured, and in PostgreSQL
otherwise; the image bytes never reach the browser, and no service-role key is ever
served to it.

### A different design every Sunday

The design for a Sunday is chosen **once, in the database**, and recorded against that
Sunday's service date (`vip_service_designs`, one row per Sunday). Every device, every
refresh and every tech member therefore sees the same artwork, and reopening the
projector reuses the recorded choice rather than re-rolling it.

Each Sunday's pick avoids the designs used on the recent Sundays — a library of N
designs plays through N different ones before any artwork comes round again. The rule
relaxes in order: recent designs → just the previous Sunday → no rule at all, so a
library of exactly one design, or a pool worn down by disabling, still resolves instead
of leaving the Sunday blank.

An administrator can override a single Sunday from the same screen — **Randomly select**,
preview, **Use this design for this Sunday**, or **Reset to automatic**. A manual choice is
stored as `selection_mode = 'manual'` and is never overwritten by a refresh, a poll or a
background update.

Disabled and deleted designs are never chosen for a future Sunday. With no designs at
all, the projector shows a branded fallback layout — no design is ever invented, and no
sample name, date, inviter or count is ever hardcoded.

## Configure Supabase

Follow [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md) for the exact SQL Editor sequence, Supabase connection URL guidance, deployment environment variables, and post-deploy checks.

The SQL files are under `database/`. For a fresh LIFEGEN schema, run them in order from `001_init.sql` through `015_youth_welfare_records.sql`; `003`, `004`, and `005` are retained retired no-op migration markers. Existing deployments should back up first and apply the pending versions in order using `npm run db:migrate` (with private database URLs configured), or follow the staging-first instructions in [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md). Migrations `011`–`014` add separate ministry categories, the portal workspace, least-privilege Admin/Staff/Viewer roles, and additive access assignments. Migration `015_youth_welfare_records.sql` stores the questionnaire answers and Youth Welfare consent separately from People, adds Admin-reviewed corrections and Admin-only history, enables RLS/revokes browser access, and adds hashed registration-request idempotency; no current values are backfilled or guessed. These migrations leave People, registration, attendance, and VIP records unchanged. Apply only after backup and staging verification; production migrations and deployment require explicit approval.

Connection variables are private server settings (see [`.env.example`](.env.example)):

- `DATABASE_URL`: Supabase pooler URL for regular server traffic (Session Pooler on port `5432` or Transaction Pooler on `6543`).
- `DATABASE_DIRECT_URL`: Supabase direct URL, or session-pooler URL on port `5432`, for migrations and PostgreSQL live notifications. Do not use transaction pooling for this variable. The direct `db.<project-ref>.supabase.co` host is IPv6-only on many projects, so IPv4-only hosts such as Vercel need the session pooler.
- `DATABASE_SSL_ROOT_CERT`: optional Supabase project CA in PEM form, used when a host reports `self-signed certificate in certificate chain`. Certificate verification stays enabled — the CA is added to Node's system root certificates. Never disable verification instead.
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
