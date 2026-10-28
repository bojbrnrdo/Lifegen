# Local LifeGen development (Mac / Docker)

Run `npm run dev:local` from the repository root to start LifeGen against an existing isolated local PostgreSQL container named `lifegen-lifeide-local-db`.

Before running, create the private, Git-ignored `.env.lifeide.local` file with:

```dotenv
DATABASE_URL=postgres://<local-user>:<local-password>@127.0.0.1:<local-port>/<local-db>
LOCAL_DEMO=true
PORT=18769
```

Use only the local Docker database. Never copy production database credentials into this file. The launcher refuses non-loopback database hosts and production environments, starts the existing Docker container if stopped, waits for PostgreSQL readiness, and then starts the application. It does **not** create a database, seed records, migrate schemas, or configure GitHub credentials.

Open `http://127.0.0.1:<port>/admin` or `http://127.0.0.1:<port>/lifeide`. Stop the terminal process with Ctrl+C. The database container continues running separately.
