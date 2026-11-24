# Preview database (PGlite wire gateway)

The live preview runs the app against an embedded PostgreSQL (PGlite) over the
PostgreSQL wire protocol on port **5433**, so the normal `postgres://` driver
stack works unchanged. The gateway binds only to **127.0.0.1**: LIFEGEN connects
from the same sandbox, and the unauthenticated database port is never exposed
through a public preview hostname.

The runtime directory is `/home/user/pglite-db` (outside the repo, may be
wiped by sandbox resets). The canonical copies of every script live HERE in
Git. To rebuild after a reset:

```bash
mkdir -p /home/user/pglite-db && cp preview-db/{server.mjs,apply-migrations.mjs,seed-demo.mjs,seed-vip-demo.mjs,seed-sunday-demo.mjs,package.json} /home/user/pglite-db/
cd /home/user/pglite-db && npm install
node apply-migrations.mjs      # gateway MUST be stopped
node seed-demo.mjs             # gateway MUST be stopped
node server.mjs &              # start local-only gateway on 127.0.0.1:5433 (use start_process)
node seed-vip-demo.mjs         # runs over the wire
node seed-sunday-demo.mjs      # example VIPs on the coming Sunday's board
```

Then start the app (from the repo root). To see the Sunday service running on the
preview, `LOCAL_DEMO_CLOCK` sets the clock to that Manila instant, and the clock then runs
forward in real time. Leave it out to use the real clock:

```bash
TZ=Asia/Manila DATABASE_URL=postgres://postgres@127.0.0.1:5433/lifegen \
DATABASE_DIRECT_URL=postgres://postgres@127.0.0.1:5433/lifegen \
LOCAL_DEMO=true LOCAL_DEMO_CLOCK=2026-10-18T13:05:00+08:00 PORT=3000 npm start
```

Sign in to the main Admin preview: `demo@lifegen.local` / `LifegenDemo2026!`.

The demo seed leaves the Lifegroup Tracker empty. With the app running, build the
pastoral hierarchy so **Admin → Lifegroups** can be reviewed:

```bash
node preview-db/seed-pastoral-hierarchy.mjs      # 2 pastors, 6 Networks, 48 Cells
node preview-db/seed-pastoral-hierarchy.mjs --new-leader-names   # give every Cell Leader their own surname
```

Two pastors sit at the top (Bishop Arsie Borromeo, Pastora Jane Borromeo) and
**every Network is under one of them** — the seed no longer creates the old
QA Networks/Cells, which used to sit outside any pastor. Every Cell Leader has
their own Cell, and the members in it have a leader. Leaders are generated with
their own surnames, so a review does not show 44 people all called Borromeo.

Youth Welfare preview: open `/youth-welfare` and use `demo-youth@lifegen.local` / `DemoYouthWelfare2026!`. The seed creates fictional ministry categories, a few administrative review tasks, a personal saved view, and a report template. This account and its fictional member records exist only in the disposable local demo database; they are not production credentials. Apply the numbered migrations through `015_youth_welfare_records.sql` before seeding; this includes the protected answer/review schema required by the portal. The access table and portal-only roles never replace primary LIFEGEN roles. Never apply these preview instructions to production.

## Gateway invariants (do not regress)

- Fake handshake: SSL/GSS refused with `N`; StartupMessage answered with
  AuthenticationOk (any credentials), PG 16.4 params, backend key, `Z I`.
- One protocol message per `db.execProtocolRaw()` call.
- PGlite appends ReadyForQuery to EVERY reply — strip `Z` during extended
  rounds, deliver it after Sync (or after a simple `Q`).
- ErrorResponse in an extended round → discard until Sync.
- Global mutex serializes all clients (PGlite is single-session); a client in
  a transaction keeps the lock. On mid-transaction disconnect the gateway
  sends ROLLBACK so the shared session recovers.
- Startup packets with insane lengths (HTTP health probes: `GET ` = 1.2 GB)
  must drop the connection, not wait.
- Never run migrations/seeds over the wire while a transaction from another
  client could interleave; apply-migrations/seed-demo open PGlite directly
  with the gateway stopped.

## Realistic names in the demo

The seeders used to write stand-ins such as `Friend1 Kai`, `Demo Person 01` and
`Test VIP`. `seed-pastoral-hierarchy.mjs` now generates real-looking Filipino
names instead, matched to sex and unique across the church.

Cell Leaders used to be created as `<FirstName> Borromeo`, so all 44 shared the
pastor's surname. Their surnames are generated from the same pool now. For a
database seeded before that change, run:

```bash
BASE_URL=http://127.0.0.1:3000 node preview-db/seed-pastoral-hierarchy.mjs --new-leader-names
```

It renames only people who still carry a placeholder name and changes nothing
else: person codes, Cell membership and status all stay. Safe to
re-run — it reports "No placeholder names left" once there is nothing to do.
