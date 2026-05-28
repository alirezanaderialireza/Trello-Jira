# Phase 1.1 E2E Smoke (Playwright)

Greenfield E2E setup that ships with F5c. Verifies the user-facing
flow that spans all of Phase 1.1: signup → workspace → board →
invitation accept → membership → archive → unarchive → star →
transfer ownership → leave.

> **Sandbox limitation:** the agent sandbox cannot run Playwright
> (`pnpm install`, browser binary download, and a live Postgres/
> Redis are all blocked). This spec is **author-local + CI** —
> the agent ships the artifacts; running them is your job. Until
> you run the runbook below at least once, treat the smoke as
> "spec written, not yet exercised".

---

## Prerequisites

You need these on the box that runs the spec:

| Dependency | Purpose | How |
|---|---|---|
| Node 20+ | runs Next dev server + Playwright | nvm / volta / brew |
| pnpm 10+ | workspace package manager | `npm i -g pnpm` |
| Postgres 16+ | DB under test | docker / brew |
| Redis 7+ | outbox + realtime fan-out | docker / brew |
| Playwright browsers | Chromium + iPhone SE emulation | one-time install via the runbook |

---

## One-time setup

### 1. Install dependencies

```bash
# From the repo root.
pnpm install

# Browser binaries (~300MB; one-time per machine).
pnpm --filter web exec playwright install --with-deps
```

### 2. Create the SEPARATE test database

E2E uses `DATABASE_URL_TEST` — **never** the dev DB. The seed
fixture drops + recreates + migrates the schema in `beforeAll`,
which would destroy local development data if pointed at
`trello_os`. The Playwright config has a defensive guard that
refuses to start when the URL names the dev DB.

```bash
# Create a fresh DB named trello_e2e. The owner role must match
# whichever role your migrations expect (typically `trello`).
createdb -O trello trello_e2e

# Or via psql:
# psql -h localhost -U postgres -c "CREATE DATABASE trello_e2e OWNER trello;"
```

### 3. Configure environment variables

Create `.env.e2e.local` (git-ignored) at the repo root, OR export
the vars in your shell:

```bash
export DATABASE_URL_TEST=postgresql://trello:trello_dev_123@localhost:5432/trello_e2e
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=e2e-jwt-secret-DO-NOT-USE-IN-PRODUCTION
export NEXTAUTH_SECRET="$JWT_SECRET"
```

> **Defence-in-depth:** if `DATABASE_URL_TEST` is missing OR points
> at a URL containing `trello_os` (the dev DB name), Playwright
> refuses to start with an explicit Persian message. The dev DB
> stays untouched.

---

## Running the spec

```bash
# Headless (CI parity).
pnpm --filter web e2e

# Interactive UI mode (recommended while authoring or debugging).
pnpm --filter web e2e:ui
```

The first run starts the Next dev server via Playwright's
`webServer` block (config: `apps/web/playwright.config.ts`) so
**you do NOT need to run `pnpm dev` separately**. The server's
`DATABASE_URL` is overridden to `DATABASE_URL_TEST` so the spec's
data never leaks into your dev DB.

### Reading the report

After the run:

```bash
pnpm --filter web exec playwright show-report
```

The HTML report lives in `apps/web/playwright-report/` (git-
ignored). Failures include traces, screenshots, and videos.

---

## What the spec covers

`apps/web/e2e/specs/phase-1.1-smoke.spec.ts` walks the full
Phase 1.1 surface in 12 sequential steps:

1. User A signs up + auto-verifies.
2. User A creates a workspace.
3. User A creates a board inside the workspace.
4. User A invites User B by email (workspace invitation).
5. User B signs up + visits the invitation accept page.
6. User B accepts; both see each other in member lists.
7. User A archives the board.
8. User B's sidebar no longer shows the archived board.
9. User A unarchives.
10. User A toggles star + verifies it appears in sidebar.
11. User A transfers workspace ownership to User B.
12. User A leaves the workspace; sidebar empties.

The spec asserts both **UI state** (Persian text, member chips,
sidebar entries) AND **data plane integrity** (the seed fixture's
tRPC client confirms the DB rows + outbox events match).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `DATABASE_URL_TEST is required` on start-up | env var not set | export it; see step 3 above |
| `appears to point at the dev DB` | URL contains `trello_os` | use a different DB name (e.g. `trello_e2e`) |
| Test hangs at step 5 (accept invitation) | outbox-worker not running OR MockEmailService not capturing | E2E does NOT require the worker; the mock email is captured directly in the API process. Check `MockEmailService` is selected (NODE_ENV !== production AND RESEND_API_KEY unset). |
| `pnpm dev` already running | port 3000 busy | stop your dev server OR set `E2E_PORT=3001` |
| Browser binaries missing | first run on this box | `pnpm --filter web exec playwright install --with-deps` |
| Persian text not rendering in screenshots | font missing on CI image | non-blocking — Playwright still asserts text content correctly |

---

## CI integration

The spec runs as a separate GitHub Actions job (added by F5c) with
`continue-on-error: true` initially. After 5 successful baselines
on `main`, flip to strict (block PR merge on failure). Tracked in
`.kiro/steering/phase-1.1-complete.md` follow-ups.
