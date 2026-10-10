# LIFEGEN · one website, one Neon database

The LIFEGEN public website and the complete **LifegroupTracker** now live in one application. Visitors stay on the public pages. Staff click **Admin** to enter the protected workspace at `/admin`.

**Fresh start:** no old tracker records or Supabase exports are required. Nothing imports automatically. The original upload and existing hosted systems have not been modified or deleted.

## What is included

| Public LIFEGEN website | Protected Admin portal |
|---|---|
| Existing green/cream LIFEGEN design and logo | Dashboard and live updates |
| Welcome, story and daily verse | People, profiles and First Timers |
| Prayer wall and shared reactions | Attendance and attendance history |
| VIP signup and private guest portal | Lifegroups, networks and membership history |
| Monthly attendance progress | Reports, CSV export and print |
| Private VIP recovery codes | VIP review and check-in validation |
| Recurring calendar download | Staff accounts, settings, prayer moderation and backups |

A successful VIP signup saves a registration **and its linked First Timer** in a single database transaction. The new person and registration appear in Admin automatically. After **five distinct Sunday attendances** (more than four visits) are recorded as present, the linked person status automatically changes to **Member**. This applies to both staff-recorded attendance and validated VIP check-ins; it changes the profile status, not Lifegroup membership. Correcting attendance later does not automatically downgrade the status.

```text
ONE LIFEGEN deployment
  /           public website and VIP form
  /admin      signed-in LifegroupTracker workspace
  /api        server-side authentication and data
              │
       ONE Neon PostgreSQL database
```

There is no iframe, second tracker deployment or cross-site browser API. Database credentials never go into public HTML or JavaScript. Old `APP_MODE`, `PUBLIC_SITE_URL` and `TRACKER_SITE_URL` settings are not used.

## Easiest launch: drag and drop

In the connected LIFEGEN setup preview, open **Admin → Publish website**.

1. Sign in as the administrator. If you have not created the first admin, use the private setup code supplied separately and choose your own account details.
2. Create a [Vercel access token](https://vercel.com/account/tokens) for the account/team that owns your existing LIFEGEN project. Paste it into the masked field in the publisher—not into chat. Connect and choose your existing project.
3. Drop `LIFEGEN-Vercel-Deploy.zip` directly into the publishing area. No extraction is needed.
4. Confirm the selected project and click **Publish LIFEGEN**.

The publisher flattens the package, sets Express/build settings, saves private Neon environment variables, uploads source files and displays Vercel's actual build status/link. No GitHub repository or terminal is required. Nothing is published merely by connecting or dropping a ZIP.

The tool is Admin-only and available on the connected setup host. Vercel tokens stay temporarily in server memory, expire after inactivity and are removed on Disconnect. They are not written into the database, source ZIP, browser storage or logs. Only approved supplied LIFEGEN release archives can be published. Private database settings are sent separately to Vercel. Actual publication still depends on token scope/permissions, account limits and a successful build; this is not a promise of automatic hosting without authorization.

The publishing helper is deliberately disabled on the deployed production Vercel app. Your public website and staff portal continue to be one deployment and one database.

## Alternative manual launch (optional)

### 1. Create one new Neon database

In [Neon](https://console.neon.tech), create a new project. Click **Connect** and copy:

- The connection string with **pooling on** → `DATABASE_URL`.
- The connection string with **pooling off** → `DATABASE_DIRECT_URL`.

These are **two connection methods to the same database**, not two databases. Keep the full strings private.

### 2. Deploy this folder as your one LIFEGEN project

Use the extracted `lifegen-neon` folder as the source for **one** Vercel project. If you already have a LIFEGEN project, update its source rather than making another tracker project. Repository setup or uploading the source may require the person who manages your existing deployment.

In that project's environment settings, add these three private values before deploying:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `DATABASE_DIRECT_URL` | Neon direct connection string for the same database |
| `SETUP_KEY` | A private randomly generated code of at least 32 characters |

Generate the setup code with your password manager or:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set the variables for the deployment environment you will use. Deploy or redeploy after saving them. Do not use the placeholder from `.env.example` as your real setup code.

**The included Vercel build command creates the empty tables automatically.** It runs the safe schema initializer; it does not copy any old records. Future deployments skip schema versions that have already been applied. There is no second site URL to configure.

If Vercel asks for project settings: choose **Express**, keep `vercel.json`, and leave the output directory unset. The configuration now pins the Express preset. The project root must be the folder containing `package.json` and `vercel.json`: `lifegen-neon` for the earlier nested ZIP, or `./` for the flat `LIFEGEN-Vercel-Deploy.zip`. The configured build command is `npm run build && npm run db:migrate`.

### 3. Create your admin account

Open your website → **Admin**. Enter the private setup code and create your own username and password. Then:

- Set church/privacy contact details in **Settings**.
- Add individual Staff or Viewer accounts as needed.
- Test one new VIP signup and confirm it appears in **People** and **Registrations**.

After the first admin account is created, remove `SETUP_KEY` from the deployment environment and redeploy. The database also prevents a second first-admin setup.

**Done:** everyone uses the same website; staff use `/admin`. No old-data import is necessary. Do not run `demo:seed` on a live database.

## Local development (optional)

Requires Node.js 20.19 or newer; Node.js 22 or 24 is recommended. Use a database dedicated to this application.

```bash
npm ci
cp .env.example .env
# Edit .env with your own server-only database URLs and setup code.
npm run db:migrate
npm start
```

On Windows, copy `.env.example` to `.env` in your editor instead. Local root: `http://localhost:3000`; Admin: `http://localhost:3000/admin`.

The schema initializer creates tables non-destructively and records applied versions. This is database structure setup, not old-record migration. For a host other than Vercel, run it before starting the application.

## Access and privacy

- **Admin:** all church-management functions, accounts, settings and backups.
- **Attendance Staff:** profiles, attendance, VIP review and Lifegroup management; no account administration or database backups.
- **Viewer:** read-only names/counts/attendance, with private contact/profile fields removed by the server.
- Guests see only the VIP registration owned by their secure session or private recovery code.
- Passwords are hashed; sessions are HttpOnly cookies; writes require appropriate authorization and CSRF/origin checks.
- New anonymous prayer posts discard the supplied author name. Prayer wall content is public, so do not include confidential information.
- Church staff must define retention, privacy contacts, lawful processing and appropriate handling for younger visitors. This package is not a legal-compliance certification.

## Live updates and backups

Direct PostgreSQL notifications power authenticated live updates. Short streaming connections reconnect automatically; two-second polling provides a fallback. Unsaved profile/settings edits are not overwritten by incoming changes.

Admin → **Settings → Download database backup** exports business records, prayer reactions and audit history. It deliberately excludes staff passwords and active sessions. Store downloaded files securely. Optional backup merge/restore is collapsed under **Advanced**; it is not needed for a fresh launch and does not delete existing records.

For full database disaster recovery, use the database provider's recovery/backup facilities in addition to business-data exports. Optional legacy import utilities remain available to a developer, but do not run automatically.

## Verification

- Backend, publishing security and fresh-start adapter suites: **51 passing tests**.
- Real-browser test of the actual first-admin setup form, including the private-code payload.
- Public signup automatically appears in Admin and links to a First Timer.
- Same-site QR, public/Admin navigation, shared staff session, logout protection and mobile checks.
- Full tracker workflow smoke and additional interaction checks.
- Build passes; current production-dependency audit reports zero known vulnerabilities.

See `docs/VERIFICATION.md` for measured results and limitations.

To run backend tests, use an isolated **local** database named `lifegen_test`; the tests reset only that disposable database and refuse remote/Neon targets:

```bash
TEST_DATABASE_URL=postgresql://YOUR_LOCAL_ROLE@127.0.0.1:5432/lifegen_test npm test
npx playwright install chromium
TEST_DATABASE_URL=postgresql://YOUR_LOCAL_ROLE@127.0.0.1:5432/lifegen_test npm run test:site
```

Do not run these concurrently; both use the same disposable test database.

## Current activation status

**The supplied Neon database is now connected and initialized.** Its pooled and direct connections, schema and live-notification path were verified. It was empty; no old records or demo records were imported. The current workspace preview now uses that real Neon database, and new registrations entered there are saved to Neon.

This is a connected workspace preview, **not a deployment to the existing LIFEGEN Vercel website**. The existing hosted website and original uploaded tracker remain unchanged. The deployment account owner still needs to publish this source as the one LIFEGEN project and configure private server variables there. First create the administrator using the protected `/admin` setup form; the private setup code is supplied separately to the owner, never in this ZIP.

Database credentials are held in a private temporary runtime configuration outside the downloadable workspace; they are not in source or the ZIP. That temporary preview configuration is not a permanent hosting setup. Rotate the database password shared in chat, and update both connection strings wherever the app is hosted.

This single-site edition supersedes the previous two-deployment setup instructions.
