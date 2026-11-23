# LIFEGEN verification · current revision

## Lifegroups: Bishop → Network Leaders → Cell Leaders → Members (this revision)

The church is organised in four levels, and the Lifegroups area now shows that
shape instead of a flat list of Networks:

```
Bishop Arsie (boys)            Pastora Jane (girls)
  ├─ Roxxane   ┐                 ├─ Grace   ┐
  ├─ Zeff      │  Network Leaders│─ Faith   │ 3 Network Leaders each
  └─ Red       ┘                 └─ Hope    ┘
        each leads 6 Cell Leaders, each with 6 people
```

**How it is modelled.** A Network may now sit *under a pastor Network*
(`networks.parent_network_id`, migration `016_network_parent.sql`). Two levels
only: a pastor cannot itself have a parent, a Network cannot be its own parent.
Existing Networks keep `parent_network_id = NULL` and behave exactly as before,
so nothing needed rewriting.

The "cell group" the user described is the Network's leader cell: the Cell that
already existed to hold the leader team now holds the people one level down.

| Level | Who is in whose Cell |
| --- | --- |
| Bishop / Pastora | Owns a Cell; their **Network Leaders are members of it** |
| Network Leader | Owns a Cell; their **Cell Leaders are members of it** |
| Cell Leader | Owns a Cell; their **members** are in it |
| Member | In one Cell |

**Two rules had to change, and both were blockers:**

1. *"A Network Leader cannot join someone else's Cell while leading a Network."*
   That is exactly what the hierarchy requires — a Network Leader **is** a member
   of their pastor's cell — so the blanket block is gone. What remains, and is
   tested, is the part that still matters: a Network Leader may not take a
   **leadership** role in a Cell outside their own Network, and their own Cells
   must sit in their own Network (`leaderHierarchyProblem` in
   `src/lifegroups.js`).
2. The Add New wizard wrote Cell Leaders into the leader cell with
   `role: 'leader'`, which the rule above (correctly) rejected. In this
   hierarchy a Cell Leader is a **member** of their Network Leader's cell, the
   same way a Network Leader is a member of their pastor's cell; the Cell they
   lead is what makes them a Cell Leader.

**UI, kept obvious on purpose.** The Lifegroups page now opens with one card per
pastor ("Bishop" / "Pastora" label, their name, how many Network Leaders are
under them), each Network Leader being one full-width row that opens their
Network. A pastor's page lists the Network Leaders under them. A Network
Leader's page lists their Cells, and starts with "Network Leader under Arsie
Borromeo". Networks that are not under a pastor stay in their own card, or in a
collapsed "Other Networks" list — so a church that never uses the pastor level
sees the same page as before. Add New gained a first tab, **Start a pastor
Network**, and the Network form gained "Who is this Network under?".

**Seed for this preview:** `preview-db/seed-pastoral-hierarchy.mjs` builds the
real structure through the public API — Bishop Arsie Borromeo and Pastora Jane
Borromeo, their six Network Leaders (Roxxane, Zeff, Red / Grace, Faith, Hope),
six Cell Leaders each and six people per Cell (36 Cells, 258 people).

**Defects found while building this, fixed:**

- `archivePerson` returned 500 for every person (it read `networks`/`lifegroups`
  that the domain read set never loaded). Both tables are now read in the same
  transaction; the "cannot archive an active leader" guard still applies.
- The directory lost its `lifegroups-page__network-card` class during the
  rewrite, which silently dropped a card per Network; the browser suite caught it
  (`t1` went from 20/20 to 11/20) and it is restored.
- A Cell Leader with no Network was rejected as "a Cell's Network must be your
  own" — the rule now only applies to people who actually lead a Network.

Verification: `npm test` **432/432** (10 new checks in
`tests/pastoral-hierarchy.test.mjs` pin the four-level rules, the one-level
parenting, the pastor card, the pastor page and the new Add New tab),
`npm run build` (77 files), migration `016` applied to the local PostgreSQL
preview database, and the seven browser suites on a clean reset:
`t1` 20, `t2` 24, `t3` 30, `t4` 24, `t5` 20, `t6` 41, `t7` 21 —
**180 checks, all passed** — plus a live end-to-end walk of
Bishop → Roxxane Network → Kai Cell → member with no JavaScript errors.

## Demo data: real names instead of stand-ins (this revision)

Every demo record now carries a realistic name, so the portal can be reviewed
as if it held real church records.

| Before | After |
| --- | --- |
| `Friend1 Kai`, `Friend2 Kai` … (216) | `Ramon Castillo`, `Michael Mercado` … |
| `Demo Person 01` … `Demo Person 24` | `Leonardo Soriano`, `Zachary Santos` … |
| `Test VIP` | `Philip Domingo` |
| 44 leaders all surnamed `Borromeo` | only the two pastors share that surname |
| 25 people with no sex recorded | every person has one |

**What did not change:** person codes (`LG-2026-0065` still identifies the same
person), Cell membership, attendance history, statuses, and the structure —
2 pastors, 6 Network Leaders, 36 Cells, 258 people in Cells, 285 people total.

Two tools, both idempotent:

- `preview-db/rename-demo-people.mjs` — renames anything still shaped like a
  placeholder. Recognises `FriendN`, `Demo`/`Person NN` and `Test VIP`; the
  first version checked only one of those shapes and silently skipped 24 rows.
- `preview-db/seed-pastoral-hierarchy.mjs` — now generates real names directly,
  so a rebuild does not reintroduce placeholders. Verified in isolation: 216
  generated, 216 unique, sex-appropriate.

`updatePerson` was proven to send only the fields supplied: a rename left code,
sex, status, registration date, attendance and `is_demo` unchanged. Cell
membership lives outside the person record (`/api/tracker/lifegroupPeopleIndex`)
and was checked separately before and after.

`npm test` 442/442 pass; the change touches data only, no application code.

## Lifegroups: numbers first, clutter last (this revision)

The Lifegroups landing page was reorganised so the state of the church is the
first thing on the screen, not a control the reader has to operate first.

**Page order, top to bottom**

1. Title, one-line summary, `Add New` / `Remove` in the header.
2. A strip of headline numbers: **Bishops / Pastoras**, **Cell Leaders**,
   **People in Cells**, and the one number that matters —
   **Needs attention** (0 shows as "Nothing to fix"). Networks with no pastor
   appear as a separate number only when one exists.
3. Search, Everyone / Boys / Girls, status and Refresh.
4. Find a person, then the directory of who leads whom.
5. Optional detail: Everyone registered, Not in a Cell yet, How groups are
   doing, and the three-word glossary (moved here from the top of the page).

The numbers respond to the Boys / Girls and status filters, so the figures
always describe what is actually listed.

**Counting rules (pinned by tests, `lifegroupHeadline`)**

| Number | What it counts |
| --- | --- |
| Bishops / Pastoras | root Networks that have child Networks |
| Cell Leaders | Cells that are not a leader-team Cell |
| People in Cells | every person in any active Cell — including leader-team Cells |
| Needs attention | Networks with no Network Leader + Cells with no Network |

Two counting defects were found and fixed while wiring this up:

- Cells with no Network were missing from the people total, understating the
  church by everyone meeting in a Cell that had not been connected yet.
- Leader-team Cells were then excluded, dropping the known crowd of **132**
  to **108**. Every leader is a person in a Cell, so they now count: the
  figure reconciles to 132, and Boys 66 + Girls 66 = 132.

**Also fixed in this revision**

`npm run build` failed on a clean checkout. `frontend/depth-carousel` is still
React, but the map-removal commit had dropped `react` and `react-dom` from
`devDependencies`; the build only worked because stale `node_modules` still held
them. Both are restored at `^19.3.1`, and the rebuilt
`public/lifegen/depth-carousel.js` is byte-identical to the committed bundle.
`tests/lifegroups-minimal-ui.test.mjs` used to assert `react` was absent; it now
asserts the map's own dependencies (`@xyflow/react`, `dagre`) are gone and that
React stays for the carousel.

**Verification**

- `npm test` — **438 / 438 pass**, including 6 new tests for the headline
  numbers (filter awareness, attention counting, leader-team ordinary Cells)
  and one pinning the page order.
- `npm run build` — passes; 77 JavaScript files checked.
- Live database (`preview-db` + `seed-pastoral-hierarchy.mjs`), numbers
  rendered through the same `lifegroupHeadline` the page uses:
  active 2 pastors / 18 Cell Leaders / 132 people / 26 Cells / 0 attention;
  Boys and Girls 9 / 66 / 13 each. (Superseded — see the six-per-Network entry
  at the top of this file.)
- `/admin/`, `/admin/styles.css` and the view modules serve 200 from the
  running app; admin and youth logins verified.
- **Not verified visually:** no headless browser is available in this
  workspace, and jsdom cannot execute ES modules. Layout and colour were
  reviewed from the CSS and markup, not from a screenshot.

## Lifegroups: plain language for non-technical staff (this revision)

Church staff with no technical background use the Lifegroups pages, so the
vocabulary was rewritten in their words. Internal terms that only made sense to
the people who built the database are gone from every screen:

| Before | Now |
| --- | --- |
| Closed cell / Open cell (a *membership* tier) | **Settled** / **New — still getting to know the group** |
| "Membership classification" radios | "How well do we know them?" with one line per choice |
| Solid / consistent | **Thriving** / **Settled** |
| "Lifegroup tree", "active tree" | "Lifegroups", "the list", "Networks and their Cells" |
| Tabs "Network Leader / Cell Leader / Member / VIP" | **Start a Network · Start a Cell · Add a person · Add a VIP guest**, each with one sentence saying what it does |
| "Add New" | "Add something new" |
| Raw "Existing Person ID" field | A collapsed **"They are already registered"** section pointing at "Everyone registered" |

Other usability work in the same pass:

- A collapsed **"New here? Read this first"** panel on the Lifegroups page
  explains Network, Cell, Cell Leader and Member, and the three things staff do
  most often.
- Each Cell in the directory is now **one full-width tap target** (56–60 px,
  `.lifegroups-page__cell-row`) instead of a small "Open Cell" button; removed
  Cells are plain non-link rows with a "Removed" badge.
- The Cell page leads with the Cell name, says "Cell Leader: <name>" in words,
  and the member actions read "Mark as settled / Mark as new / Move / Remove /
  Edit details".
- Status and action messages were rewritten too ("Marked as Settled.",
  "Person added to the Cell.", "This Cell already has its six Settled members.").

**Two defects found while doing this, and fixed:**

1. **Adding a person as "New" was impossible.** The Add New wizard refused with
   *"Open Cell registration requires selecting a Closed Cell parent. This
   feature is awaiting its database relationship and cannot be saved through
   this form yet."* — the API accepts `tier: 'new'` (`src/lifegroups.js`), so the
   guard was blocking a valid action and showing a developer note. The guard is
   removed, **New** is now the default (most people start there) and Settled/New
   can be switched later from the Cell page.
2. **Archiving a person always failed with a 500.** `archivePerson` checks for
   active Network/Cell leadership, but the read set for that domain write did
   not include `networks` and `lifegroups`, so it threw
   `Cannot read properties of undefined (reading 'some')` and the API masked it
   as "The database request could not be completed." `src/db.js` now reads both
   leadership tables inside the same transaction before calling the domain
   method; the leadership guard still runs (verified: archiving a Cell Leader is
   still refused, archiving a spare person now succeeds).

Verification: `npm test` **422/422** (four new checks in
`tests/plain-language-ui.test.mjs` fail the build if "Closed cell", "Open cell",
"Lifegroup" or a database note reappears in a user-facing message or in any of
the 50+ server validation strings), `npm run build` (77 files), and the seven
browser suites on a clean reset: `t1` 20, `t2` 24, `t3` 30, `t4` 23, `t5` 20,
`t6` 41, `t7` 21 — **179 checks, all passed**, including new assertions that the
Add New tabs carry plain names, that "New" saves instead of being refused, and
that no closed/open-cell wording or developer note is rendered.

## Lifegroups: network map removed (this revision)

The interactive **Network map** is gone. It was a 510 KB React Flow bundle
(165 KB gzipped) for one optional view, and on a phone it could not be panned,
scrolled or pinch-zoomed at all (all three are disabled below 780 px), so it was
fit-and-tap only while re-fitting itself on every viewport resize. Removing it
also removes the SVG fallback renderer, four dev dependencies
(`react`, `react-dom`, `@xyflow/react`, `dagre`), the `build:lifegroups` step and
a stylesheet from `public/admin/index.html`.

What replaced it: the plain-DOM **directory** (Network → Cell Leader → Cells),
**Find a person** (one search box over every Cell, with Cell shortcuts), the
**Network drill-down** pages, and the Cell/Network detail pages that already
carried every action the map's side panel offered.

**Defect found while re-verifying, and fixed.** The progress card starts
rendering, *then* fetches. If the page was rebuilt in between (a live update
after saving a meeting report), the response either threw
`Cannot set properties of null` or painted the previous numbers over the new
ones — which is why a just-saved meeting could still show "Met this week —" and
`0/4`. `views/progressGuard.js` now gives each render a token: only the newest
render for a card that is still in the document may paint. The Cell page also
reads `#progressCard` before awaiting instead of after. Covered by
`tests/lifegroup-progress-card-race.test.mjs` (6 tests).

Verification: `npm test` **418/418**, `npm run build` (77 files), and the six
browser suites + the new find-a-person suite (`t1` 20, `t2` 24, `t3` 30,
`t4` 21, `t5` 20, `t6` 41, `t7` 21 = 177 checks, all passed) on a clean reset.

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
  no-match state, Clear filters, and the absence of any network map.
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
