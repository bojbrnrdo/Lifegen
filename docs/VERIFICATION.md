# LIFEGEN verification

## Scope and evidence

Verification was performed on the single-site integrated LIFEGEN build. It covers local PostgreSQL integration, fresh-start behavior, browser UI workflows, and a subsequent read-only/cloud activation check. Destructive tests are fenced to the disposable local database exactly `lifegen_test` and never use Neon.

The current preview uses the real Neon PostgreSQL database with an existing administrator and no demo records. It has not been deployed to Vercel. The current version shown below includes the private-preview sign-in compatibility changes.

## Automated results

- Backend, fresh-start and publishing security suite: **51 passed, 0 failed**.
- JavaScript build checks: **35 source files checked**; no public database credentials.
- Production dependency audit: **0 known vulnerabilities**.
- Publisher browser test uses real Admin UI plus mock Vercel API; no actual Vercel deployment is created by tests.
- Preview-auth browser test deliberately strips the cookie from login response; owner still reaches Admin using the preview-only in-memory preview-session header. No `sessionStorage` or persistent web storage is used.

## Real Neon setup check

- Pooled and direct connections authenticate to the same Neon database.
- Migration created the application tables without importing old or demo records.
- No fake test records were created in Neon.
- Current site `/` and Admin `/admin` return HTTP 200; `/api/health` reports `neon-postgresql`.
- The existing admin account has been retained. Do not create another administrator.

## Preview sign-in fix · version 2.2.8

The sandboxed preview dropped its secure session cookie and a browser cache kept serving an older Admin JavaScript bundle. The preview now returns an owner-session bearer token only when `HOSTED_PREVIEW=true`, outside production, and stores it in JavaScript memory only. The server checks the normal hashed staff session and gives that fresh bearer precedence over stale cookies. The token is not kept in sessionStorage or localStorage. Production (`VERCEL` or `NODE_ENV=production`) rejects preview bearer auth and continues to require the HttpOnly secure cookie. Preview sign-in no longer depends on opening a second tab.

Admin CSS/JS imports use a versioned path `/admin/_assets-2.2.8/...` and `Cache-Control: no-store`. This prevents a cached pre-fix bundle from repeating the same cookie warning. The server was restarted on port 3000 with the real Neon configuration after the patch.

Checks include: login response without cookies, API session verification, stale-cookie precedence, preview bearer rejected when Vercel production flag is active, CSRF-protected logout, and the browser smoke reaching Dashboard with no page errors.

## Deployment limitations

No real Vercel deployment has been performed or claimed. The Vercel project/account authorization has not been supplied. The drag-and-drop publishing browser test uses a mock Vercel API. Permanent Vercel hosting still requires authorization and a successful live build.

## Private admin password recovery · version 2.2.8

Login now offers a reset flow only when a private SETUP_KEY is configured. The owner must provide that key and their existing admin username; they choose a new password in the form. Recovery validates same-origin, is rate-limited, hashes the new password, clears lockout, revokes all existing sessions and records an audit event. It does not create a new account or alter ministry data. The preview and production never return or display the stored password. Regression suite: 51 passing local tests, including wrong-key rejection, successful recovery, prior-password rejection, new-password login and short-password rejection.


## Performance and release hardening · version 2.2.9

- Extracted repeated embedded JPEGs into optimized local brand assets; home HTML no longer ships base64 image data. The hero image is preloaded, decorative full-viewport SVG grain was removed, and the icon bundle is deferred.
- Added versioned static asset URLs and one-year immutable caching for matching versioned assets; unversioned/public API responses are not made immutable.
- Added keyboard-visible focus states, reduced-motion handling, and small-screen spacing refinements.
- Added `npm run package:vercel`: explicit deployment allow-list; excludes local tests, dependencies, private data, and environment files except the non-secret `.env.example`; ZIP uses DEFLATE level 9 and gets a SHA-256 sidecar.
- Verified build; 53/53 tests pass on isolated local `lifegen_test`, including new attendance-report aggregation and Lifegroup growth/member totals. Browser single-site smoke checks that displayed attendance KPIs match the synthetic record, plus registration-to-admin, QR, mobile navigation, and no horizontal overflow; preview-auth browser smoke passes without browser errors. `npm audit --omit=dev`: zero vulnerabilities. No test command connected to Neon.


## Targeted read-path optimization · version 2.2.10

- Dashboard metrics, attendance summaries, paginated People, global search, service summaries/details, and report-year lists use targeted PostgreSQL read models instead of hydrating whole tables into application memory.
- Lifegroup/report read paths load only their required state tables; ordinary reads skip audit and VIP registration histories. Mutations and backups retain complete-state behavior.
- Verified with isolated local `lifegen_test`: 53/53 integration tests, single-site browser smoke, preview-auth smoke, build check, and `npm audit --omit=dev` (0 vulnerabilities). No Neon production database access or data changes were made.
- No production Vercel latency measurement has been taken; these checks establish correctness, not a numerical production speedup.
