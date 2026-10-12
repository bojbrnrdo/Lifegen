# Preview database (PGlite wire gateway)

The live preview runs the app against an embedded PostgreSQL (PGlite) exposed
over the PostgreSQL wire protocol on port **5433**, so the normal
`postgres://` driver stack works unchanged.

The runtime directory is `/home/user/pglite-db` (outside the repo, may be
wiped by sandbox resets). The canonical copies of every script live HERE in
Git. To rebuild after a reset:

```bash
mkdir -p /home/user/pglite-db && cp preview-db/{server.mjs,apply-migrations.mjs,seed-demo.mjs,seed-vip-demo.mjs,package.json} /home/user/pglite-db/
cd /home/user/pglite-db && npm install
node apply-migrations.mjs      # gateway MUST be stopped
node seed-demo.mjs             # gateway MUST be stopped
node server.mjs &              # start gateway on :5433 (use start_process)
node seed-vip-demo.mjs         # runs over the wire
```

Then start the app (from the repo root):

```bash
TZ=Asia/Manila DATABASE_URL=postgres://postgres@127.0.0.1:5433/lifegen \
DATABASE_DIRECT_URL=postgres://postgres@127.0.0.1:5433/lifegen \
LOCAL_DEMO=true PORT=3000 npm start
```

Sign in: `demo@lifegen.local` / `LifegenDemo2026!`

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
