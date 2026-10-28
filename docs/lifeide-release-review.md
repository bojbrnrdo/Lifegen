# LifeIDE feature branch release review

Branch: `feature/lifeide-workspace` (review against `origin/main`).

## Scope
- Browser-local coding workspace in the LifeGen white/green/gold theme.
- Opt-in local repository file explorer, UTF-8 text editing, version-checked explicit saves, file and folder creation.
- Git change review and explicit local-only commits on non-protected branches.
- Routes: `/lifeide` and `/api/lifeide/*`.

## Security boundaries
- Repository APIs require `LIFEIDE_LOCAL_EDIT=true`, a non-production runtime, a database-backed staff session, and admin role.
- Writes require existing Origin and CSRF checks. Paths reject traversal, hidden entries, and symlinks.
- Binary/invalid UTF-8 files and oversized files cannot be edited; saves reject stale SHA-256 versions.
- LifeIDE does not expose a Git push or deployment operation.

## Validation completed
- `npm test`: 220 passing tests at the time of review.
- `npm run test:lifeide-browser`: browser-local editor and isolated Repository-mode file creation, save, Git selection and local commit pass using a simulated administrator.
- `npm run build`: passes.
- `git diff --check origin/main...HEAD`: passes.
- Separately verified an isolated database-backed administrator API session through file creation, save, Git review and commit in a disposable Git repository.

## Before merge
- Perform an interactive browser check with a **real** database-backed administrator login/cookie, against an isolated local LifeGen database and disposable Git repository.
- Confirm UI behavior on mobile and a desktop browser, including save conflicts, unsaved-change prompts and Git confirmation.
- Review the complete feature diff and verify the destination branch is current.
- Merge only following explicit approval. Do not enable local repository editing in production; the feature intentionally disables these APIs there.

## Local verification
```bash
npm test
npm run test:lifeide-browser
npm run build
git diff --check origin/main...HEAD
```
