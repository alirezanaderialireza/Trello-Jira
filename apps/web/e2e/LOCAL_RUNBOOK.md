# F1.4.6 — Local E2E Activation Runbook

This runbook covers the **runtime** half of F1.4.6 that the Kiro Web
sandbox cannot perform (no dev server, no `pnpm install`, no browser,
no Postgres). The **web** half — reconciling spec/fixture selectors
against the real UI and preparing CI — is already done (see the PR that
adds this file). Everything below must be run on a real machine.

> The spec `apps/web/e2e/specs/phase-1.1-smoke.spec.ts` is still
> `test.describe.skip(...)` and CI still has `continue-on-error: true` +
> `--no-frozen-lockfile`. Do **not** flip those until a local run is
> green — that is the whole point of this runbook.

---

## 0. Prerequisites

Node 20+, pnpm 10+, Docker (or local Postgres 16 + Redis 7). See
`apps/web/e2e/README.md` for the full dependency table.

## 1. Start the backing services

```bash
docker compose up -d            # postgres + redis (+ minio if F1.2.8 is in)
# or use locally-installed postgres/redis
```

## 2. Create the SEPARATE test database

```bash
createdb -O trello trello_e2e
# or: psql -h localhost -U postgres -c "CREATE DATABASE trello_e2e OWNER trello;"
```

The seed fixture DROPs + migrates the public schema in `beforeAll`, and
the Playwright config refuses to start if `DATABASE_URL_TEST` names the
dev DB (`trello_os`). Never point it at your dev database.

## 3. Install dependencies (regenerates the lockfile)

```bash
pnpm install                    # NO --no-frozen-lockfile: let it regenerate
git status pnpm-lock.yaml       # expect it to be modified — keep this change
```

This is the step the web sandbox could not do (registry 403). The
regenerated `pnpm-lock.yaml` is committed in step 9.

## 4. Configure environment

```bash
export DATABASE_URL_TEST=postgresql://trello:trello_dev_123@localhost:5432/trello_e2e
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=e2e-jwt-secret-DO-NOT-USE-IN-PRODUCTION
export NEXTAUTH_SECRET="$JWT_SECRET"
export AUTH_TRUST_HOST=true
```

## 5. Install the Playwright browser

```bash
pnpm --filter web exec playwright install --with-deps chromium
```

## 6. Remove `.skip` from the spec

In `apps/web/e2e/specs/phase-1.1-smoke.spec.ts` change:

```ts
test.describe.skip("Phase 1.1 — workspace lifecycle smoke flow", () => {
// →
test.describe("Phase 1.1 — workspace lifecycle smoke flow", () => {
```

## 7. Run the spec

```bash
pnpm --filter web e2e            # headless (CI parity)
pnpm --filter web e2e:ui         # interactive, recommended while debugging
```

Playwright's `webServer` block boots the Next dev server with
`DATABASE_URL` overridden to `DATABASE_URL_TEST`.

## 8. If a step fails: iterate on the live DOM

- Open `pnpm --filter web e2e:ui` (or `playwright show-report` after a
  headless run) and inspect the trace / screenshot / DOM snapshot.
- The selectors were reconciled statically against the components in
  F1.4.6-web; any remaining mismatch is a runtime-only surprise
  (timing, async render, a strict-mode multi-match). Adjust the
  offending step, re-run. Record findings in `e2e-results.md`.
- Common gotchas to watch for (already mitigated in the spec, verify):
  - step 7 archive: trigger and confirm are both «بایگانی» — the
    confirm is scoped to `getByRole("alertdialog")`.
  - step 4 invite: email/submit are scoped to `getByRole("dialog")`.
  - step 10 star: matched by aria-label `/موارد ستاره‌دار/`.

## 9. When all 4 cases pass (desktop + mobile × 1 retry) — flip the switches

In `.github/workflows/ci.yml`:

- e2e job: `continue-on-error: true` → **`false`**
- both jobs: `pnpm install --no-frozen-lockfile` → **`pnpm install --frozen-lockfile`**

Then commit the regenerated lockfile + the spec `.skip` removal:

```bash
git add pnpm-lock.yaml apps/web/e2e/specs/phase-1.1-smoke.spec.ts .github/workflows/ci.yml
git commit -m "ci(e2e): unskip phase-1.1 smoke + go strict (frozen lockfile, fail-on-error)"
```

## 10. Drive `apps/web` typecheck to zero

```bash
pnpm --filter web typecheck      # record the before/after error count
```

Fix the historic errors (≈142 at PR #43 baseline). Record the
before → after numbers in `e2e-results.md`.

## 11. Add `apps/web` to the CI typecheck matrix

Once the count is zero, add `--filter=web` to the `pnpm turbo typecheck`
line in `.github/workflows/ci.yml`.

## 12. Lighthouse / axe (carried over from F1.4.5 T7)

```bash
pnpm --filter web build && pnpm --filter web start
npx lighthouse http://localhost:3000/login --only-categories=accessibility,best-practices --view
# repeat for /workspaces and /board/<id>; target Accessibility >= 95
```

Optionally wire `@axe-core/playwright` into a spec and assert zero
serious/critical violations.

## 13. Fill in `e2e-results.md` and push

Complete `apps/web/e2e/e2e-results.md` (per-step pass/fail, lockfile,
typecheck before→after, Lighthouse scores, which CI switches flipped),
commit it, and push the branch / open the follow-up PR.
