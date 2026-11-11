# LIFEGEN Vercel build-rate-limit recovery

## Evidence (2026-10-17)

GitHub commit `fcebc52c037ee08dbfa451af58b2735673b91799` reported failed deployment status checks for:

- `Vercel – lifegen`
- `Vercel – lifegen-j39t`
- `Vercel – lifegen-es49`

All three status links pointed to a Vercel `upgradeToPro=build-rate-limit` page. This supports a build-rate-limit diagnosis, **not** an application build error diagnosis and **not** a claim the currently serving production site is down.

The connected Vercel deployment-history API returned 403 Forbidden, so the deployed SHA, project-to-domain mappings, deployment quotas, and actual deployment ownership remain unverified.

## Recovery checklist (no production mutations)

1. In Vercel, identify which of the three projects owns the intended public production domain and record its project ID, team, and connected repository/production branch.
2. Inspect each project's latest deployment and `build-rate-limit` message. Record the actual limit/reset and available options. Do not assume upgrading is necessary.
3. Review whether `lifegen-j39t` and `lifegen-es49` are deliberate environments or duplicate Git integrations. **Do not disconnect, delete, or disable either project without owner approval.**
4. Allow quota to reset or use an owner-approved resolution. Before any retry, verify GitHub `main` SHA and that required checks succeeded.
5. Request explicit production deployment approval; deploy once to the confirmed production project, avoiding redundant retries across all projects.
6. Verify the live site's release SHA using Vercel deployment metadata, HTTP health, admin login, and non-destructive registration/attendance smoke checks. Do **not** insert synthetic VIPs into production.
7. Recheck GitHub deployment statuses, Vercel error logs, and production Supabase health. Record outcome and rollback reference.

## Guardrails

- Do not change billing, deployment project settings, or disconnect Git integrations without explicit approval.
- Do not infer live deployment from green GitHub unit/integration CI.
- Do not put secrets, API tokens, production connection URLs, or personally identifiable VIP data into logs, PR descriptions, or test fixtures.
- `vercel.json` currently defines an Express build through `npm run build`; `.vercelignore` excludes test and private/test-result directories. Neither file alone establishes the cause of the account-level rate restriction.
- Potential ways to reduce builds (e.g., removing unintended duplicate project hooks or adding ignored-build rules) must be designed only after project-to-domain mapping and release workflow are verified.
