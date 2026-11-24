# LIFEGEN performance audit — 10 checks, front end and back end

Date: 2026-11-24 · Branch `arena/35f99f3a-lifegen`

Re-runnable: `npm run perf:audit` (read-only; exits non-zero if a check fails).
Source of the script: `scripts/perf-audit.mjs`. All timings below are from a
live server against the demo database (306 people, 8 Networks, 44 Cells,
258 memberships).

---

## Result

**Two genuine defects were found and fixed.** Both were in the back end, both
were invisible in isolation, and together they made the Lifegroups progress
page take 6.4 seconds.

| Check | Area | Before | After | Verdict |
|---|---|---|---|---|
| 1 | Page latency (6 pages) | — | slowest 11 ms | pass |
| 2 | Parameterised DB query | ~44 ms **per query** | ~2.6 ms | **fixed** |
| 3 | Tracker endpoints | — | slowest 56 ms | pass |
| 4 | Lifegroups progress overview | **6,400 ms** | **328 ms** | **fixed** |
| 5 | Text compression | — | brotli | pass |
| 6 | Versioned asset caching | — | 1 year, immutable | pass |
| 7 | ETag revalidation | — | 304 in 3 ms | pass |
| 8 | Homepage critical path | — | 0 blocking scripts | pass |
| 9 | Public API | 132 ms | 22 ms | pass |
| 10 | First response weight | — | 53 KB HTML | pass |

Regression status: `npm test` → **477 pass / 1 fail**, identical to the
baseline. The single failure (`tests/youth-welfare.test.mjs`) pre-dates this
work and is untouched.

---

## Defect 1 — every parameterised query waited ~40 ms on the network

**Symptom.** Every Tracker endpoint was slower than the SQL justified. Timings
were suspiciously uniform: every query cost ~44 ms, including a query that
returned zero rows and even `EXPLAIN`.

**How it was isolated.** A literal (`WHERE lifegroup_id = 5`) took 1.1 ms
while the same key as a parameter (`WHERE lifegroup_id = $1`) took 45.0 ms.
`SELECT $1` alone cost 44.0 ms, so the table, the joins and the row count were
all irrelevant — only the *parameterised* path was slow. An instrumented copy of
the wire gateway showed the reply being written to the socket and the next
client message not arriving for **42 ms**. That gap is the signature of Nagle's
algorithm waiting on a delayed ACK.

**Cause.** The local Postgres wire gateway (`server.mjs`) accepted sockets
without `setNoDelay`, so the many small writes that make up a Postgres result
were coalesced and held. Literal queries avoided it because the driver path
differs.

**Fix.**
- `pglite-db/server.mjs`: `sock.setNoDelay(true)` on each accepted socket.
- `src/db.js`: the pool now sets `keepAlive: true` and disables Nagle on each
  client connection, so the same trap cannot reappear against a real Postgres.

**Effect.** Parameterised query 44.1 ms → 2.6 ms (about 17×). This alone took
the progress overview from 6.4 s to 2.6 s. `/api/public/vip-count` went from
132 ms to 22 ms.

---

## Defect 2 — the progress overview reloaded every Cell once per Cell

**Symptom.** After the network fix the overview still took 2.6 s.

**Cause.** Three separate N+1 patterns:

1. `overviewProgress` looped over all 44 Cells and called `progress()` one at a
   time, and each `progress()` ran `listGroups({status:'all'})` again just to
   find the one Cell it had been handed — 44 full table-wide group reads, then
   serialised.
2. Each Cell fetched its own attendance marks for the 4-week window.
3. `meetingRows` ran one attendance query **per meeting**, so opening a Cell
   with 30 reports cost 31 round-trips. `membersWithLast4` also re-read the same
   weeks `progress` had already loaded.

**Fix.**
- `progress()` accepts the already-loaded Cell row instead of re-reading the
  list, plus an optional pre-built marks map.
- `overviewProgress` loads every mark for the window in **one** query, then
  fans out over a bounded pool (8) instead of a serial loop.
- `meetingRows` fetches all marks for the page in one `= ANY($1)` query.
- `membersWithLast4` reuses the calendar `progress` already fetched.
- `getGroup` reuses the group list it already loaded rather than querying a
  second time for the same Network's Cells.

**Effect.** 2,636 ms → **328 ms**. Query count for the overview fell from
roughly 200 to a handful.

**Correctness verified, not just speed.** The 44 returned Cells match their
individual detail endpoints exactly (spot-checked `solid`/`total` per Cell), all
8-week calendars are the right length, there are no null holes, and the summary
totals still reconcile with the database (78 solid + 180 new = 258 members).

---

## The ten checks, and what each rules out

1. **Page latency** — `/`, `/admin`, `/youth-welfare`, `/lifeide`, `/checkin`,
   `/vip-announce` all render in ≤15 ms. Rules out per-request server stalls.
2. **Parameterised query cost** — guards the Nagle fix. If it regresses, this
   check reports ~40 ms per query again.
3. **Heavy Tracker endpoints** — dashboard, people, lifegroups, networks,
   registrations, gift tracker, search all under 60 ms.
4. **Progress overview** — the specific page that was slow; a fixed budget.
5. **Compression** — text assets are served brotli (`styles.css`,
   `codemirror.bundle.js` 827 KB → 286 KB, `depth-carousel.js` 305 KB →
   102 KB, `admin/styles.css` 141 KB → 32 KB on the wire).
6. **Versioned asset caching** — `?v=` assets are
   `max-age=31536000, immutable`, so repeat visits transfer no bytes.
7. **ETag revalidation** — unversioned assets return 304 in ~3 ms, so repeat
   visits cost a header exchange, not a download.
8. **Critical path** — no render-blocking scripts; the one remote stylesheet
   (Google Fonts) is preconnected and uses `display=swap`.
9. **Public API** — health, config, posts, upcoming calendar, VIP count and
   prize all under 25 ms.
10. **Payload** — homepage HTML is 53 KB, and the only eager images are the
    logo, hero banner and VIP badge, all above the fold.

---

## Deliberately not changed

- **The 603 KB hero banner.** It is preloaded with `fetchpriority="high"`, has a
  960w variant for phones, and is already WebP. Re-encoding it would change the
  site's artwork for a marginal gain, so it was left alone.
- **The 179 MB `public/brand` folder.** Three self-hosted testimony videos
  (64, 62 and 31 MB) dominate it. They are click-to-play with poster images, so
  a visitor never downloads them unless they press play. This is a hosting
  question (streaming vs. self-hosting), not a page-load bug.
- **Admin assets are `no-store`.** Intentional: the portal must never serve a
  stale build after an update.
- **`activity` returning 400 to an argument-less call.** The method requires
  arguments to define its window; this is API contract, not a defect.
- **Database indexes.** `lifegroup_memberships` already carries
  `(lifegroup_id, left_at, tier)` and `(person_id, left_at)`, and the group list
  query runs in 43 ms for 44 Cells. No index was missing.

## Reproducing

```bash
npm start                 # or the local demo server
npm run perf:audit        # 10 checks, read-only, non-zero exit on failure
npm test                  # 477/478, one pre-existing failure
```
