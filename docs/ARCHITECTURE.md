# Single-site implementation reference

## Server modules

- `src/app.js`: Express entry point, security headers, auth/API routes, explicit tracker operation permissions and public/Admin page routing.
- `src/db.js`: TLS PostgreSQL connections, pooled API traffic, direct clients, consistent read snapshots, serialized transactional writes, normalized table persistence and named audit logs.
- `src/domain.js`: adapted tracker business logic; person/attendance/group/network/report rules now execute inside server database transactions, not localStorage.
- `src/auth.js`: scrypt password hashing, hashed session identifiers, HttpOnly cookies, CSRF/origin checks, shared rate limits, roles and server-side Viewer redaction.
- `src/public-api.js`: atomic VIP signup/person creation, owned portal and recovery, Manila Sunday check-in, prayer/reaction persistence, monthly prize and calendar file.
- `src/events.js`: dedicated direct `LISTEN`, finite SSE streams, heartbeat/reconnect and durable revision.
- `src/migration.js`: tracker/Supabase/Neon backup validation, dry-run rollback, stable source mappings, merge-only import and application backup.

## Frontends

- `public/lifegen/`: public site extracted from the supplied live page, with Supabase browser transport replaced by same-origin server API calls.
- `public/admin/`: uploaded tracker UI extracted to modules; browser-local data engine replaced by authenticated server API calls.
- `public/vendor/lucide.min.js`: pinned vendored icon library.

The single Express application serves the public root `/` and the Admin workspace `/admin`. The tracker is directly integrated as the staff workspace, not embedded in an iframe. Both frontends use relative `/api` requests to the same application and one Neon PostgreSQL database. Admin navigation uses `/admin`; public/QR origins are inferred from the incoming request, with optional `SITE_URL` only for proxies that cannot supply the correct origin. Obsolete two-deployment environment variables are ignored.

`vercel.json` explicitly selects the Express framework and automatic output directory. The deployment project root must contain `package.json`, `vercel.json` and `src/app.js`; the Vercel deployment ZIP puts these at the archive root. No static-site `public`/`dist` output override should be used.

Vercel's build command runs the syntax/security check and the versioned schema initializer. The initializer creates empty tables if needed; it neither imports old data nor deletes business records. One private `SETUP_KEY` authorizes the initial admin-account form. Further account management is signed-in Admin-only. Fresh mode defaults to rejecting legacy device-token restore while permitting a new signup.

## Registration transaction

1. Verify same-origin request, rate limit, consent, input and idempotency key.
2. Check owned VIP session / prior completed request.
3. Begin transaction and acquire the shared advisory write lock.
4. Create normalized person with original full name, age, school, inviter and optional contact.
5. Insert linked VIP registration and hashed recovery secret; create owned portal session.
6. Flush person/counter/audit changes, validate deferred references and commit.
7. PostgreSQL triggers append durable event revisions and notify after commit.
8. Tracker refreshes affected views; fallback polling covers missing/disconnected streams.

The ID returned to the guest is not authorization. Portal ownership requires a valid HttpOnly session cookie; check-in also requires its CSRF token. Guest-supplied person/date overrides are not used to choose attendance identity or Sunday.

## Attendance

Guest check-in creates a pending request, not attendance. Authorized staff validation records presence for the linked person and Sunday. Staff-entered presence also appears in that person's monthly portal. Repeated entries are limited by database uniqueness and merged by distinct dates. VIP rewards count all distinct verified Sundays in the current Manila calendar month, not lifetime totals. After five distinct Sundays are recorded present, a linked VIP profile's status is promoted to `member`; the promotion is sticky and does not create a Lifegroup membership. Migration 002 applies the same rule to existing records. Reversing a VIP validation removes a VIP-origin mark only when that specific check-in created it; unrelated staff attendance is not blindly removed.

## Persistence and backup

Business data is normalized across PostgreSQL tables. `extras` retains compatible legacy fields that are not first-class columns; sensitive legacy credential/token keys are removed from imported raw records. Stable import mappings retain legacy IDs. Browser storage is limited to unfinished UI drafts, request retry state and the temporary old-device migration bridge, not membership/attendance databases.

Application backups omit staff credentials and active sessions. They include business records, shared prayer reactions, named audit history and source mappings. Merge-import of an application backup is not a destructive restore command. A generated database-instance identifier prevents same-database merges from treating all existing IDs as new.

## Permissions

| Role | Access |
|---|---|
| Admin | Full profiles, attendance, groups, VIP review, reports/CSV, settings, imports/backups, user management and moderation |
| Attendance Staff | Full profiles, attendance, groups, VIP review and reports/CSV; no admin imports, backups or account/settings management |
| Viewer / Leader | Names and attendance/group/report views; private person/contact fields removed server-side, writes/CSV/backups rejected |

Viewer access is not limited to a single assigned group. Admin/staff accounts must be given only to authorized church personnel. Local demo credentials and iframe-cookie exceptions are explicitly gated to a labelled development preview. Production uses secure SameSite Lax cookies and same-origin protections.

## Fresh-start default

For the current launch, no old records are imported. `LEGACY_VIP_RESTORE=false` is the default in both deployments. The frontend does not attempt old-device restoration or block signup on an unimported old token. The old browser identity is left untouched; the new portal depends only on its new server session/recovery code. Set the flag to true only if legacy records are deliberately imported later and old-token recovery is wanted.

## Limitations / rollout boundaries

- No actual source repository, exports, Neon account credentials or deployment access were provided. Original deployments are unchanged.
- Original Supabase/standalone passwords are not transferable to the new scrypt staff-account store.
- Same-source imports insert previously unmapped rows; they do not overwrite already mapped source rows. Final migration requires a write pause and final exports, preferably into a clean production target after staging verification.
- Profile edits do not rewrite the historical signup's captured age/school/inviter.
- Initial tracker calculations load consistent church-scale table snapshots. Larger deployments need measured load tests and incremental query optimization.
- Vercel/Neon live deployment and platform quotas must be verified during staging; local PostgreSQL tests are not production deployment proof.
- A privacy notice, role checks and password hashing are not a full compliance or penetration-test certification.
