# LIFEGEN verification · current revision

## Lifegroups end-to-end review addendum (this revision)

The tracker row *Lifegroups — "Check that Lifegroups work from start to finish"* was
verified by driving the **shipped** Admin portal in a browser environment (jsdom)
against the **running local app** and the disposable PGlite demo database. Nothing was
stubbed: `public/admin/js/app.js` and its view modules made real same-origin `/api`
requests, so the UI, the server and the database were all exercised together.

**Defect found and fixed.** A Cell Leader removed with *Remove from Lifegroups* →
**Cell Leader** (or removed from the Network page) stayed active=false while its Network
stayed active. The Lifegroups directory only listed inactive records when the *Network*
was also inactive, so the removed Cell appeared in **no** view — "Active" correctly hid
it and "Inactive" showed an empty directory. The directory now keeps such a Network
visible in the Inactive view, labels the removed Cell **Inactive**, and no longer offers
an *Open Cell* link for it (that link would open a page that still renders the old
roster as if it were active). The rule lives in the shared
`filterTrackerView()` in `public/admin/js/views/hierarchy.js` and is covered by
`tests/lifegroups-inactive-view.test.mjs` (7 tests).

**Coverage of the automated browser pass** (154 checks over six suites; local
PGlite demo database, synthetic data only):

- **List page** — directory card per Network with its Leader and Cells, Network /
  Cell Leader / Member summary counts, All/Boys/Girls filters with `aria-pressed`, search,
  no-match state, Clear filters, React Flow **Network map** mount and the Directory toggle.
- **Cell (Cell Leader) page** — identity + Network link, Members/Consistent stats,
  roster with profile links, member search for Cells over five members, per-member menu,
  collapsed *Network & leadership* and *Attendance & progress* disclosures (progress is
  fetched only when opened), 12-week strip and the meeting-report table.
- **Network page** — header and category badge, leader link, Cell Leaders / Members /
  Meetings-this-week stats, structure tree, the automatic Network Leader Cell created
  exactly once, Quick actions, collapsed eight-week attendance history, and the
  **Edit Network** form (blank name refused, category change clears a mismatched leader,
  re-picking a registered leader via search, save persists without losing the leader).
- **Add New wizard** — Network Leader → Cell Leader → Member with consent and
  duplicate guards; the rejected "Open Cell" path writes nothing; each saved record
  arrives with the right Network/Cell, role and Closed-cell classification.
- **Cell management** — Edit Cell Leader, Add member (person search restricted to the
  Cell's gender, role stored), Closed ⇄ Open cell moves, and the six-member Closed-cell
  target.
- **Meeting reports** — create (held / not held + reason, present and devotion marks on
  canonical Person IDs), edit (date locked, topic/notes), delete, and the progress KPIs
  updating; then Remove member (history + Former members preserved), Remove Cell Leader
  (members released, People untouched, Active/All/Inactive views consistent).

**Other test failures fixed in this revision** (all were stale assertions or
environment assumptions, not behaviour changes):

- `lifegroup-essential-ui` asserted the exact `<details class="card mt-2">` string; the
  progress disclosure carries a modifier class and an id, so the assertion now checks
  the same contract (a collapsed card disclosure).
- `lifeide-security` asserted source text that has since been hardened (status-message
  guards, the Save button being re-enabled in `finally`).
- `lifeide-api` assumed the fixture repository's default branch is `main`; on a machine
  whose git default is `master` the checkout failed. It now resolves the real default
  branch and configures a git identity so the only possible 409 is the protected-branch
  rule.
- `package-verification` set a tampered ZIP flag in the central directory only, so the
  stricter local-header consistency check rejects it first; the assertion now accepts
  either rejection path.

**Verification commands**

```bash
npm test            # 425 tests, 425 passed
npm run build       # esbuild bundles + scripts/check.mjs (75 files) — passed
```

plus the six browser-level suites above (`154 passed, 0 failed`) run from a folder with
`jsdom` installed, against `LOCAL_DEMO=true` on a disposable PGlite database seeded with
`preview-db/seed-demo.mjs` and the new `preview-db/seed-lifegroup-demo.mjs`. No Supabase
project was contacted and no production data was read or written.

## Code & deployment audit addendum (previous revision)

A full-repository audit focused on code and deployment (not UI/function copy). Findings and the fixes applied:

- **Fixed — Admin phone-number search never matched formatted numbers.** `src/read-model.js` defined `digits` with the regex `/\\D/g`, which matches a literal backslash followed by `D` instead of non-digits, so spaces/dashes were never stripped before the SQL `regexp_replace(contact_number,'[^0-9]','','g') LIKE …` comparison. Searching `0917 555 1234` returned 0 rows while `5551234` worked. Corrected to `/\D/g` and exported; added `tests/read-model-search.test.mjs`. Verified live: the formatted search now returns the matching person.
- **Fixed — dead immutable-cache path for public assets.** `src/app.js` only marked an asset `public, max-age=31536000, immutable` when `?v` exactly equalled `ADMIN_ASSET_VERSION` (`2.2.22`), but `public/lifegen/index.html` references per-file versions (`?v=2.3.10`, `2.3.13`, `2.2.10`, …), so every public asset shipped with the 5-minute static cache. The check now accepts any semver-like `?v=x.y.z` under `/lifegen`, `/brand`, `/vendor`. Verified live: versioned assets return the immutable header, unversioned/garbage `v` still get `max-age=300`.
- **Fixed — private data paths were not Git-ignored.** `scripts/backup.mjs` and `scripts/bundle-supabase.mjs` write personal records into `private-data/`, which `.gitignore` did not exclude. Added `private-data/`, `test-results/`, `playwright-report/`, `.env.*` (keep `.env.example`) to `.gitignore`.
- **Fixed — release ZIP referenced a missing `.vercelignore`.** `scripts/package-vercel.mjs` includes `.vercelignore`, but the file did not exist. Added a `.vercelignore` that keeps `tests/`, `preview-db/`, `private-data/`, test artifacts, logs and `.env.*` files out of Git-based Vercel deployments (while keeping `docs/` and `DEPLOY-FIRST.md`, matching the release-ZIP packaging).
- **Fixed — Express `trust proxy` was only set for Vercel/preview.** Added `TRUST_PROXY=true` support so deployments behind other reverse proxies report correct client IPs for rate limiting.
- **Removed unused dependency.** `@playwright/test` was a devDependency but no Playwright tests exist (`npm test` runs `node --test`); removing it shrinks `npm ci` on build machines. Lockfile regenerated with `npm install --package-lock-only`.

Verification for this addendum: `npm test` — **29 passed, 0 failed**; `npm run build` — passed; full local smoke run against the disposable PGlite preview database (health, public config/calendar/posts, VIP registration + idempotent duplicate + honeypot, check-in day gate, Admin dashboard/people/search/registrations/Lifegroup/report endpoints, SSE stream) — all behaving as expected, with the phone-search and cache-header fixes confirmed live. No Supabase project was contacted; only synthetic demo data was used.

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
