# E2E Run Results

> Sync log for the F1.4.6 local run. The web-side agent reconciled the
> spec/fixtures against the real UI but **cannot run Playwright**; fill
> this in during the local run (see `LOCAL_RUNBOOK.md`) so the results
> are visible back in the web workflow. Use ✅ pass / ❌ fail / ⬜ not-run.

- **Date / commit:** _____________________________
- **Environment:** local / CI (circle one)
- **Playwright version:** _____________________________
- **Node / pnpm version:** _____________________________

## Per-step results (desktop / mobile)

| step | scenario                         | desktop | mobile | notes |
|------|----------------------------------|---------|--------|-------|
| 1    | User A signup → /workspaces      | ⬜      | ⬜     |       |
| 2    | create workspace                 | ⬜      | ⬜     |       |
| 3    | create board → /board/[id]       | ⬜      | ⬜     |       |
| 4    | invite User B (modal)            | ⬜      | ⬜     |       |
| 5    | User B signup + accept invite    | ⬜      | ⬜     |       |
| 6    | both see each other in members   | ⬜      | ⬜     |       |
| 7    | archive board (ConfirmDialog)    | ⬜      | ⬜     |       |
| 8    | archived board hidden for B      | ⬜      | ⬜     |       |
| 9    | unarchive board                  | ⬜      | ⬜     |       |
| 10   | star board (hard assertion)      | ⬜      | ⬜     |       |
| 11   | transfer ownership to B          | ⬜      | ⬜     |       |
| 12   | leave workspace (ConfirmDialog)  | ⬜      | ⬜     |       |

## Lockfile

- `pnpm install` regenerated `pnpm-lock.yaml`? **Y / N**
- committed? **Y / N**

## typecheck apps/web

- error count **before:** ____  → **after:** ____
- `apps/web` added to CI typecheck matrix? **Y / N**

## Lighthouse accessibility (target ≥ 95)

- `/login`: ____
- `/workspaces`: ____
- `/board/<id>`: ____
- axe-core serious/critical violations: ____

## CI switches flipped (only after green local run)

- e2e `continue-on-error: false`? **Y / N**
- `--frozen-lockfile` in both jobs? **Y / N**
- spec `.skip` removed? **Y / N**

## Outstanding failures / TODOs

- _____________________________________________________________
- _____________________________________________________________
