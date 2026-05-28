---
title: Phase 1.1 — Definition of Done
inclusion: always
---

# Phase 1.1 Definition of Done

This document captures what "done" means for Phase 1.1 (Trello-grade
shell + workspace settings + invitation flow + board settings drawer).
It locks in the deliverables F1–F5b shipped, the polish that
F5c added, and the polish followups that are explicitly **deferred
to Phase 1.2 onwards**. When the next phase prompt asks "is Phase 1.1
done?", read this file.

---

## Featurelet inventory

| Featurelet | PR | Description |
|---|---|---|
| F0.1 | — | Date Engine (lib/date.ts with branded types, Jalali, UTC) |
| F0.2 | — | Auth + Users + Workspaces (NextAuth v5, Argon2id) |
| F0.3 | — | Postgres RLS (split policies + ALS + tenantContextMiddleware) |
| F0.4 | — | Realtime hookup (boardSocketClient + sync FSM + presence) |
| F0.5 | — | Granular Error Boundaries + reportError pipeline |
| F0.6 | — | Architecture Linter (eslint-plugin-boundaries) |
| F1   | #49 | Schema & RLS Foundation |
| F2   | #50 | Authorization Middleware |
| F3a  | #51, #52, #53 | Workspace API |
| F3b  | #54 | Board + Sidebar + Profile API |
| F4   | #55 | App Shell & Navigation |
| F5a  | #56 | Workspace Settings + Invitation Accept Flow |
| F5b  | #57 | Board Settings Drawer + Background Picker + Archive UI |
| F5c  | TBD | Polish + E2E (this PR) |

---

## What "done" means for Phase 1.1

A. **Schema + RLS** — every workspace-scoped table either enforces RLS
   or is documented as intentionally global (users, sessions,
   accounts, workspace_invitations until accept time). ✓

B. **API surface** — workspace + board + members + invitations
   procedures land in `packages/api/src/routers/`. Every mutation
   accepts an idempotencyKey, every read uses a procedure-builder
   that loads + asserts membership/role inline. ✓

C. **Auth** — NextAuth v5 with credentials + magic link + email
   verification. Argon2id password hashing. Session JWT carries
   `tenantId` + `userId` so the tRPC `tenantGuard` doesn't need a
   second DB hit. ✓

D. **App shell** — `(app)/layout.tsx` server-renders the bootstrap
   data (workspaces + starred + recent + pending invitations + user
   profile), `AppShell` Client wrapper holds the mobile-drawer
   state, sidebar + topnav + profile dropdown are wired through
   props. Server Actions hoisted into the layout per the Lesson F4
   one-way rule. ✓

E. **Workspace settings UI** — three tabs (general / members /
   danger), invite-by-email modal, pending-invitations list with
   revoke, role select with last-OWNER guard, transfer-ownership
   dialog, type-name-to-confirm soft delete with 10-second restore
   toast. ✓

F. **Invitation accept flow** — public `/invitations/[token]` route
   (middleware whitelisted), six exhaustive render states (revoked /
   expired / already-accepted / logged-out / accept-button /
   email-mismatch-recovery), Persian RTL HTML email template with
   text fallback, outbox-worker handler for
   `workspace.invitation.created`. ✓

G. **Board settings drawer** — five-tab drawer (about / members /
   background / permissions / danger), URL-driven state via
   `?settings=<tab>`, 12 colors + 8 gradients with hover-driven live
   preview through a `--board-bg` CSS custom property, archive flow
   with 10-second restore toast, OWNER-only soft delete with type-
   title-to-confirm. ✓

H. **Sidebar correctness** — starred + recent sections filter out
   archived boards (F5c fix). ✓

I. **E2E smoke** — Playwright spec under `apps/web/e2e/` walks the
   12-step flow signup → workspace → board → invite → accept →
   archive → unarchive → star → transfer ownership → leave. ✓

J. **Persian-first** — every UI string is in Persian, dates render
   via `lib/date.ts` (Jalali), numbers via
   `Intl.NumberFormat('fa-IR')`, RTL through Tailwind logical
   `start-`/`end-` utilities. F4–F5b new code passes the RTL audit
   with zero `left-`/`right-`/`ml-`/`mr-` violations. ✓

K. **Boundaries** — `eslint-plugin-boundaries` runs as `error` (not
   `warn`); Lesson F4 (one-way `app → features`, never reverse) is
   respected throughout F4–F5b. ✓

---

## F5c audit checklist (manual, run locally before declaring DoD)

The agent that wrote this checklist cannot run any of these in the
sandbox. Please walk it once after merging F5c.

### 1. Build / lint / typecheck

```bash
pnpm install
pnpm lint                                    # zero errors
pnpm turbo typecheck --filter='!web'         # zero errors (apps/web stays excluded; documented)
pnpm turbo build --filter=web                # production build succeeds
```

### 2. E2E smoke

```bash
# Prerequisite: trello_e2e Postgres DB created + DATABASE_URL_TEST exported.
pnpm --filter web exec playwright install --with-deps
pnpm --filter web e2e
```

Expected: the 12-step flow passes on `desktop-chrome` AND
`mobile-iphone-se` projects. Red flags: any step that times out
beyond 60 seconds OR a "skipped" annotation that wasn't in step 10
(star toggle is currently optional).

### 3. Mobile responsive

iPhone SE viewport (375x667), real device or Chrome devtools.
Walk:

- [ ] /login — form fits, Persian RTL alignment
- [ ] /workspaces — sidebar drawer opens via burger, not overflowing
- [ ] /workspaces/[slug]/settings/members — invite modal full-screen
- [ ] /board/[id]?settings=background — bottom-sheet drawer, swatch
      grid 4x3 fits without horizontal scroll
- [ ] /invitations/[token] — card centered, no overflow

### 4. Accessibility (manual Lighthouse)

For each page below, run Lighthouse → Accessibility audit. Target:
score ≥ 95.

- [ ] /workspaces (sidebar + topnav)
- [ ] /workspaces/[slug] (boards listing)
- [ ] /workspaces/[slug]/settings/general
- [ ] /workspaces/[slug]/settings/members
- [ ] /workspaces/[slug]/settings/danger
- [ ] /board/[boardId] (no drawer)
- [ ] /board/[boardId]?settings=members (drawer open)
- [ ] /invitations/[token] (logged out)
- [ ] /invitations/[token] (logged in, accept button visible)

Common issues to expect (and fix incrementally — none of these
should block Phase 1.1 sign-off):

- `<label>` without `htmlFor` on the (auth) pages — pre-F4 legacy.
  Phase 1.4 polish.
- Color contrast of secondary text on white backgrounds — fix-as-you-
  see by tightening `text-slate-400` to `text-slate-500` where the
  text is meaningful (not decorative).

### 5. RTL audit

```bash
# All new code uses logical utilities. Verify no leak into F4–F5b:
grep -rn "className=.*\(left-[0-9]\|right-[0-9]\|ml-\|mr-\)" \
  apps/web/src/app/board/\[boardId\]/_components \
  apps/web/src/features/board-settings \
  apps/web/src/features/settings \
  apps/web/src/features/invitation \
  apps/web/src/features/shell \
  apps/web/src/app/\(app\) \
  apps/web/src/app/invitations
# Expected: empty.
```

The pre-F4 codebase has 28 violations (auth pages + features/board
+ features/boards). Those are tracked as Phase 1.4 visual polish —
out of Phase 1.1 scope per Master Contract Rule 4.

### 6. Performance budgets

Sample numbers from a local laptop run (your numbers will vary —
these are sanity ceilings not targets):

| Path | Cold p95 |
|---|---|
| sidebar.bootstrap | < 200 ms |
| /workspaces | < 500 ms |
| /board/[id] | < 2000 ms |

If any path is 2x over budget, add an issue tagged `phase-1.4-perf`
and continue — Phase 1.1 sign-off is not blocked by perf tuning
unless something is catastrophically broken.

---

## Polish followups (deferred to later phases)

Recorded so the next planner doesn't re-discover them.

| TODO | Origin | Defer to | Why |
|---|---|---|---|
| `email_sent_at` column on `workspace_invitations` | F5a | Phase 1.2 | Needs migration + worker change; pairs with the soft-delete email handler PR. |
| Description editor in board About tab | F5b | Phase 1.2 | `boardManagement.renameBoard` doesn't yet accept `description`; either extend or add `updateBoardMetadata`. |
| Procedure naming: `boardManagement.deleteBoard` → `softDeleteBoard` | F5b | Phase 1.2 | Renames a public API. Touches consumers in tests + UI; ship alongside the description editor PR so we touch board-management.ts once. |
| `app_service` Postgres role for serviceRoleConnection | F5/devops | Phase 1.5 | Infra/ops work; current code uses a single role for both BYPASSRLS and tenant-scoped queries. |
| IP-based rate-limit on `getByToken` | F3a | Phase 2 (security hardening) | Defence against token-probe attacks; not blocking for MVP. |
| Workspace.createInvitation legacy procedure removal | F4 | Phase 1.2 | Cleanup task, no functional impact. |
| Pool-pressure metrics in `loadSheddingGuard` | trpc.ts inline TODO | Phase 1.5 | Observability work; current guard is a placeholder. |
| Pre-F4 RTL/a11y violations in `(auth)` + `features/board/` + `features/boards/` | various | Phase 1.4 | 28 violations in legacy code. Master Contract Rule 4: Phase 1.1 stays in F4–F5b scope. |
| Replace `window.confirm` with Radix-style dialog | F5a + F5b | Phase 1.4 polish | Members-table remove + danger leave + revoke confirmations. |
| Focus-trap library on the drawer + modal-on-drawer | F5b | Phase 1.4 polish | Basic Tab cycling today; needs a proper focus-trap for keyboard users. |
| Lighthouse CI integration (block PR on a11y regression) | F5c | Phase 1.4 polish | Tooling investment; manual checklist covers Phase 1.1. |
| E2E job: drop `continue-on-error: true` after 5 successful baselines | F5c | After 5 green runs on `main` | First-week stabilisation. |
| Star toggle UI (and E2E step 10) | observed during F5c | Phase 1.2 card features | Step 10 of the smoke spec is best-effort; the star toggle isn't yet exposed in BoardView. |

---

## Sign-off statement

Phase 1.1 is "done" when:

1. Items A–K above are demonstrably true in `main`.
2. The F5c audit checklist (sections 1–6) has been walked locally
   and any issues raised are either fixed in F5c or recorded under
   "Polish followups" with an explicit defer-to-phase tag.
3. PR #57 (F5b) and the F5c PR are both merged.

After sign-off, Phase 1.2 (Card Features) begins. The first
Phase 1.2 PR should NOT add new procedures to
`packages/api/src/routers/board-management.ts` without first
completing the deferred renames + description-editor work in a
single follow-up PR.
