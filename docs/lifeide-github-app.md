# LIFEGEN LifeIDE — production GitHub App connection

LifeIDE may browse GitHub files without a write credential. To enable **direct branch commits from the production Admin UI**, install a dedicated GitHub App. Do **not** paste credentials into LifeIDE, add them to source control, or expose them to the browser.

## GitHub App setup (owner action required)

1. Create a GitHub App owned by the repository owner. Grant **Repository contents: Read and write**, **Pull requests: Read and write**, and **Metadata: Read**. Disable other permissions; webhooks are not required for this workflow.
2. Install the app on **only** `bojbrnrdo/Lifegen` (selected repositories), not all repositories.
3. Generate a GitHub App private key and obtain the App ID and installation ID from GitHub. Store the private key securely.
4. In Vercel, set these variables **server-side, Production environment only**:
   - `LIFEGEN_GITHUB_APP_ID` — numeric GitHub App ID
   - `LIFEGEN_GITHUB_APP_INSTALLATION_ID` — numeric installation ID
   - `LIFEGEN_GITHUB_APP_PRIVATE_KEY` — GitHub App PEM private key; use a Sensitive/Encrypted variable
   - `LIFEGEN_GITHUB_PROD_WRITES_ENABLED=true` — explicit protected-branch write opt-in
5. Redeploy the production app so serverless functions read the new configuration. Log in as a LIFEGEN administrator and check **Commit in LifeIDE** → connection status.

The server signs an eight-minute JWT, requests an installation access token scoped to the **Lifegen** repository and the two necessary write permissions, and caches that short-lived token only in server memory. No GitHub credentials go to the browser.

## Safety boundaries

- Only authenticated LIFEGEN **admins** can access GitHub developer endpoints.
- State-changing requests require same-origin protection, session CSRF, and explicit user confirmation.
- Branch creation starts at `develop` and is limited to `feature/*` or `fix/*`.
- File edits are limited to allowlisted paths and non-sensitive source. The editor checks the current GitHub file SHA to avoid overwriting concurrent changes.
- A PR is always opened as a **draft targeting develop**. The editor does not merge PRs or deploy production.
- Neither `main`, `develop`, release branches, nor sensitive paths may be committed to directly through the file-save endpoint.
- Package workflow dispatch remains disabled in production.
- Production GitHub App writes do not require changing or accessing production database data.
- The legacy `LIFEGEN_GITHUB_DEV_TOKEN` continues to work only for guarded previews; it is not accepted as a production write credential.

## Disable or revoke access

Set `LIFEGEN_GITHUB_PROD_WRITES_ENABLED=false` and redeploy to disable writes. To revoke promptly across existing warm deployments, uninstall/suspend the GitHub App or revoke its key/token in GitHub. Rotate the App private key if compromised.

## Troubleshooting

If the editor reports **GitHub writes disabled**, inspect the production Vercel variable scope, ensure the GitHub App is installed for `bojbrnrdo/Lifegen`, check its granted permissions, and redeploy. If a GitHub App connection fails, check the App ID, installation ID, PEM formatting and GitHub installation access. Do not copy any private key into logs, screenshots, chat, or the browser console.

The repository's GitHub App setup is not performed automatically by deploying this code. It requires explicit owner authorization and installation.
