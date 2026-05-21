---
inclusion: always
---

# Row-Level Security (RLS) Rules

This document is the source of truth for how tenant isolation is enforced in
this codebase. **Read it before** writing any new tRPC procedure, service,
worker, or migration that touches a tenant-scoped table.

> Why is this important? Cross-tenant data leakage is the single worst
> failure mode for a multi-tenant SaaS. RLS is our last line of defence — if
> we get it wrong, a single buggy `WHERE` clause anywhere in the codebase
> can leak data across tenants. If we get it right, even a SQL-injection
> bypass cannot read another tenant's rows.

---

## Three-layer defence

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — tRPC tenantGuard middleware                        │
│   Refuses requests without a `session.tenantId` (UNAUTHORIZED)│
├─────────────────────────────────────────────────────────────┤
│ Layer 2 — Application code                                   │
│   Repositories already include `WHERE tenant_id = ?` in       │
│   every query. Domain services validate ownership at the      │
│   command boundary.                                           │
├─────────────────────────────────────────────────────────────┤
│ Layer 3 — Postgres RLS                                       │
│   `ENABLE + FORCE ROW LEVEL SECURITY` on every tenant table.  │
│   Each operation has its own policy:                          │
│     SELECT → USING (tenant_id = current_tenant_id())          │
│     INSERT → WITH CHECK (tenant_id = current_tenant_id())     │
│     UPDATE → USING + WITH CHECK                               │
│     DELETE → USING                                            │
└─────────────────────────────────────────────────────────────┘
```

If any one layer is broken or bypassed, the other two still hold the
boundary. This is **not redundancy** — it is layered defence; each layer
catches a different class of bug.

---

## The GUC + transaction protocol

Postgres RLS reads `app.current_tenant_id` (and `app.current_user_id`) from
session-level GUC variables. The protocol is:

1. Open a transaction.
2. Inside the transaction, run `SET LOCAL app.current_tenant_id = '<uuid>'`.
   The `LOCAL` modifier means Postgres clears the GUC at `COMMIT` /
   `ROLLBACK`, so the connection returning to the pool is clean.
3. Run all tenant-scoped queries inside the same transaction.

**You almost never write that protocol by hand.** It is wired automatically
by:

| Layer                                | Mechanism                                           |
|--------------------------------------|-----------------------------------------------------|
| tRPC `protectedProcedure`            | `tenantContextMiddleware` opens the tx + sets GUCs  |
| Service-level `txManager.serializable(...)` | Reads `tenantContextALS` and re-applies the GUC on its new transaction |
| Tests / one-offs                     | `withTenantContext(db, { tenantId, userId }, cb)` from `@repo/db` |

The middleware also **replaces `ctx.infra.db`** with the active transaction
handle, so existing routers that call `ctx.infra.db.query.X.find*(…)` are
RLS-correct without any code change.

---

## Role matrix

| Role            | RLS enforced? | Used by                                                            |
|-----------------|---------------|--------------------------------------------------------------------|
| `app_user`      | ✓ enforced    | All HTTP / tRPC requests via `protectedProcedure`                   |
| `app_worker`    | ✓ enforced    | (Future) tenant-aware background jobs that set the GUC per-job      |
| `app_service`   | ✗ BYPASSRLS   | Cross-tenant background jobs (outbox processor, rebalance worker)   |
| `app_migration` | ✗ BYPASSRLS   | Schema migrations only                                              |

Production guidance:

- The application connection string MUST point at `app_user` — never the
  table owner, never `postgres`. Both bypass RLS via ownership /
  superuser, defeating Layer 3 entirely.
- Workers that legitimately span tenants (replaying outbox events) connect
  as `app_service`. They are responsible for tenant isolation in their own
  code.
- Migrations connect as `app_migration` so the migration runner can
  `CREATE POLICY` and back-fill data without per-policy `BYPASSRLS` toggles.

---

## Pitfalls (the ones that bit us)

### 1. `SET` without `LOCAL`

```sql
-- WRONG — outlives the transaction, persists on the pooled connection,
--         and leaks tenant context to the next request that picks up the
--         same connection.
SET app.current_tenant_id = '...';

-- RIGHT — auto-clears at COMMIT/ROLLBACK.
SET LOCAL app.current_tenant_id = '...';
```

`withTenantContext` and `setTenantContextOnTx` both use `SET LOCAL`. Never
hand-write `SET` without `LOCAL`.

### 2. Connecting as the table owner

`FORCE ROW LEVEL SECURITY` makes RLS apply to the table owner too — but only
for normal connections. A superuser still bypasses RLS. Run the application
as `app_user`, never `postgres`.

### 3. Service transactions opened without inheriting tenant context

Domain services open their own transactions via `txManager.serializable(…)`.
Those transactions get a **fresh connection from the pool with no GUC set**.
The fix is automated: `TransactionManager` is constructed in
`packages/api/src/trpc.ts` with `applyTenantContext = applyTenantContextFromALS`,
which reads the request's tenant context from `tenantContextALS` and sets
the GUC inside every transaction the manager opens.

If you ever construct a `TransactionManager` outside `trpc.ts` (e.g. in a
worker), pass the appropriate hook explicitly, or accept that the new
manager will run cross-tenant.

### 4. Direct `db` import outside `withTenantContext`

```ts
// WRONG — opens a fresh connection with no GUC set; RLS denies everything.
import { db } from "@repo/db";
const rows = await db.query.boards.findMany();

// RIGHT — runs inside a transaction with the GUCs set.
import { withTenantContext, db } from "@repo/db";
const rows = await withTenantContext(
  db,
  { tenantId, userId },
  (tx) => tx.query.boards.findMany(),
);
```

In tRPC procedures, prefer `ctx.infra.db` (which the middleware has already
swapped for the tx handle) or `ctx.tx` directly. The bare `db` import is for
tests, scripts, and ALS-aware service infrastructure only.

### 5. Subscriptions / streaming endpoints

Don't put long-lived subscriptions on `protectedProcedure`. The transaction
would stay open for the entire stream, holding a connection from the pool
and pinning the GUC. Use `publicProcedure` and wire auth + RLS manually for
streaming work.

### 6. Workers without GUC

Background jobs that legitimately span tenants connect as `app_service`
(BYPASSRLS). That bypass is the **only** RLS escape hatch we use, and it is
isolated to a separate connection string. Anything else — a debug script,
an admin tool — must still run inside `withTenantContext` with the relevant
tenant, or it will silently see zero rows.

### 7. Empty string vs NULL in the GUC

`current_setting('app.current_tenant_id', true)` returns the empty string
`''` when the GUC is not set, not `NULL`. Casting `''::uuid` raises an
error — that's why both helper functions use `NULLIF(..., '')::uuid`. Don't
read the setting directly; always go through `current_tenant_id()` or
`app.current_tenant_id()`.

### 8. `FOR ALL` on UPDATE

A `FOR ALL` policy collapses USING and WITH CHECK. For UPDATE that means
`USING` is checked against the OLD row and `WITH CHECK` against the NEW
row, and a buggy or malicious UPDATE can move a row between tenants under
some policy combinations. Always split into four explicit policies — see
migration `0004_rls_split_policies.sql`.

---

## Template: a new tenant-scoped router

```ts
// packages/api/src/routers/example/example.router.ts

import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../../trpc";
import { exampleTable } from "@repo/db";

export const exampleRouter = router({
  list: protectedProcedure
    .input(z.object({ filter: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // ✅ ctx.infra.db is the RLS-enforced transaction handle.
      //    The query is automatically scoped to ctx.session.tenantId by
      //    the Postgres policies — no manual tenant_id filter required.
      return ctx.infra.db.query.exampleTable.findMany({
        where: input.filter ? eq(exampleTable.label, input.filter) : undefined,
      });
    }),

  create: protectedProcedure
    .input(z.object({ label: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // ✅ Insert without tenant_id explicitly — but the table requires it.
      //    The application repository / service is responsible for setting
      //    tenant_id = ctx.session.tenantId before insert; RLS WITH CHECK
      //    will reject mismatches.
      const id = crypto.randomUUID();
      await ctx.infra.db.insert(exampleTable).values({
        id,
        tenantId: ctx.session.tenantId,
        label: input.label,
      });
      return { id };
    }),
});
```

Two rules to remember:

1. Write your queries as if RLS did not exist (no `WHERE tenant_id = …`
   ceremony in the router). Then RLS holds the boundary.
2. **Do** still pass `tenant_id` on INSERT — the WITH CHECK policy verifies
   it, and the row needs the column populated for future reads.

---

## How to verify RLS is working (smoke test)

```sql
-- 1. Connect as app_user (or any non-BYPASSRLS role).
\c trello_dev app_user

-- 2. Without setting the GUC, every tenant-scoped query is empty.
SELECT count(*) FROM boards;
-- expected: 0

-- 3. Inside a transaction with the GUC set, only the chosen tenant is visible.
BEGIN;
SET LOCAL app.current_tenant_id = '<a real tenant uuid>';
SELECT count(*) FROM boards;
-- expected: > 0
COMMIT;

-- 4. Try to insert a row for a different tenant — must fail.
BEGIN;
SET LOCAL app.current_tenant_id = '<tenant-A uuid>';
INSERT INTO boards (tenant_id, title) VALUES ('<tenant-B uuid>', 'oops');
-- expected: ERROR — new row violates row-level security policy
ROLLBACK;
```

---

## What is intentionally deferred

The following items from the full RLS checklist are deliberately not yet
implemented; raise them as separate PRs when the time comes.

- **Connection-string split.** We still connect as the table owner in dev.
  Production should switch to `app_user` and have a separate
  `DATABASE_ADMIN_URL` for migrations and a `DATABASE_WORKER_URL` for the
  outbox / rebalance workers. Tracked as a follow-up because it requires
  coordinated env changes across deploy environments.
- **Real RLS integration tests with testcontainers / pg-mem.** The unit
  tests in `packages/domain` and the type-checks across the monorepo cover
  the wiring; full end-to-end RLS isolation tests need a live Postgres in
  CI.
- **ESLint rule banning direct `db.query.*` outside `withTenantContext`.**
  The current barrel re-exports make this hard to express without a custom
  rule. The runtime guarantee (RLS denies queries without the GUC) is
  sufficient for now.
- **Worker code migration to `app_worker`.** The outbox processor and
  rebalance worker still connect as `app_service` (BYPASSRLS) by virtue of
  the shared `DATABASE_URL`. Adding an `app_worker` role is a forward-
  compatible step; the actual code migration is a future task.
