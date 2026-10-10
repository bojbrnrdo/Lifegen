# Drop this LIFEGEN ZIP into the publisher

**Recommended:** open the connected LIFEGEN setup preview → Admin → Publish website. Connect your Vercel account using a private access token, choose your existing LIFEGEN project, drop this ZIP and click Publish LIFEGEN.

Do not extract the ZIP for this method. The publishing tool takes care of the project root, Express configuration, private Neon environment settings and source upload. No GitHub or terminal is needed. The archive alone cannot authorize your hosting account; a valid token is still required.

Nothing is published until you explicitly confirm the project and click Publish. Your church data is not imported or deleted. A READY status/link appears only when Vercel actually reports it.

## Alternative: manual deployment to Vercel

This is ONE Express application: the public homepage is `/` and the full Admin portal is `/admin`. It is not a static HTML-only website.

## Use the correct project root

Extract `LIFEGEN-Vercel-Deploy.zip`. Its top level contains:

```text
package.json
package-lock.json
vercel.json
src/
public/
database/
scripts/
```

Upload/commit these files to the root of the source repository used by your existing LIFEGEN Vercel project. Do not wrap them in another folder unless you also change Vercel's Root Directory.

## Check three settings, then redeploy

Vercel project → Settings → Build and Deployment:

1. **Root Directory:** `./` when these files are at the repository root. If they are nested, select the actual folder containing `package.json` and `vercel.json`.
2. **Framework Preset:** **Express**. The included `vercel.json` explicitly sets this.
3. **Output Directory:** turn off any override. Do not set `public`, `dist` or `build`. Express serves the pages through the server function.

The included configuration sets installation to `npm ci` and the build command to `npm run build && npm run db:migrate`.

Keep the server's `DATABASE_URL` and `DATABASE_DIRECT_URL` private environment variables set for Production. Both must point to your existing Neon database. Do not create another database. `SETUP_KEY` is needed only if the first admin account has not been created yet.

**Redeploy after saving the settings/source/environment variables.** If the deployment fails, inspect its Build Logs rather than opening an older deployment URL.

After a successful deployment, check:

- `/` — public LIFEGEN homepage
- `/admin` — first-admin setup or staff sign-in
- `/api/health` — should report a successful Neon connection

## If a 404 remains

The 404's request ID is not the website address. Send the full failing URL and the deployment's latest Build Log/error, with database passwords removed. That is needed to distinguish a project-root/framework problem from a missing/old deployment or domain problem.

The original LIFEGEN homepage `https://lifegen-nine.vercel.app/` returned HTTP 200 when checked during this investigation. The failing deployed URL was not provided, so this package addresses the identified packaging risk; it is not proof that your actual Vercel deployment has been fixed.

No database credentials, private setup code, old records or demo database are included in this ZIP.
