// packages/db/src/middleware/tenantContext.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Tenant Context Middleware — sets `app.current_tenant_id` and
// `app.current_user_id` PostgreSQL GUC variables before every tenant-scoped
// query so RLS policies fire correctly.
//
// THE THREE-LAYER DEFENCE
//
//   Layer 1 — tRPC `tenantGuard` middleware: rejects requests without a
//             `session.tenantId` (UNAUTHORIZED).
//   Layer 2 — Application repositories: every query already filters on
//             `tenant_id = ?` explicitly.
//   Layer 3 — Postgres RLS (this file): even if Layers 1 and 2 are skipped
//             by a bug or an injected query, RLS will deny rows whose
//             `tenant_id` does not match the GUC.
//
// THE PROTOCOL
//
//   1. Open a transaction (`db.transaction(...)`).
//   2. `SET LOCAL app.current_tenant_id = '<uuid>'`.
//      `SET LOCAL` automatically clears the GUC at the end of the
//      transaction, so a connection returning to the pool is clean.
//   3. Run the queries inside the transaction.
//   4. We additionally execute an explicit `RESET` in `finally{}` as
//      belt-and-braces against future code that might use plain `SET`
//      (without `LOCAL`) by mistake.
//
// NESTED TRANSACTIONS / DOMAIN SERVICES
//
//   Some services (BoardService, list/card command handlers) open their
//   own transactions via `TransactionManager.serializable()`. Those new
//   transactions get a fresh connection from the pool with NO GUC set, so
//   RLS would deny everything inside them.
//
//   To make this transparent, we expose `tenantContextALS` — a Node
//   `AsyncLocalStorage` slot. The tRPC middleware writes
//   `{ tenantId, userId }` into it once per request, and the
//   `TransactionManager` is wired (in `packages/api/src/trpc.ts`) with an
//   `applyTenantContext` callback that reads from ALS and sets the GUC on
//   every new transaction it opens. The result: services that need their
//   own transactions inherit the tenant context for free.
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TenantContextParams {
  tenantId: string;
  userId?: string;
}

// ─── ALS slot ────────────────────────────────────────────────────────────────

/**
 * Per-request tenant context, propagated implicitly through async chains.
 *
 * Set by the tRPC `tenantContextMiddleware` once per request. Read by the
 * `TransactionManager` whenever a service opens its own transaction, so the
 * service's transaction inherits the same RLS context.
 */
export const tenantContextALS = new AsyncLocalStorage<TenantContextParams>();

/** Read the current tenant context (or `undefined` outside a request). */
export function getCurrentTenantContext(): TenantContextParams | undefined {
  return tenantContextALS.getStore();
}

// ─── GUC setters ─────────────────────────────────────────────────────────────

/**
 * Set the tenant/user GUCs on an existing Drizzle transaction.
 * Use this when you already own the transaction (e.g. inside a service's
 * `txManager.serializable(...)` callback).
 */
export async function setTenantContextOnTx(
  tx: any,
  params: TenantContextParams,
): Promise<void> {
  await tx.execute(sql`SET LOCAL app.current_tenant_id = ${params.tenantId}`);
  if (params.userId) {
    await tx.execute(sql`SET LOCAL app.current_user_id = ${params.userId}`);
  }
}

/**
 * Set the GUCs from the current ALS slot. Returns `true` if the context was
 * applied, `false` if no ALS slot is in scope (caller should decide whether
 * that is a bug or an admin-mode bypass).
 *
 * Used by the `TransactionManager.applyTenantContext` hook so service-level
 * transactions inherit the request's tenant context automatically.
 */
export async function applyTenantContextFromALS(tx: any): Promise<boolean> {
  const ctx = tenantContextALS.getStore();
  if (!ctx?.tenantId) return false;
  await setTenantContextOnTx(tx, ctx);
  return true;
}

// ─── The canonical wrapper ───────────────────────────────────────────────────

/**
 * Execute `callback` inside a transaction with tenant + user GUCs set.
 *
 * This is the ONLY supported way to run tenant-scoped queries against the
 * database. Direct `db.query.X` access bypasses the GUC and will return zero
 * rows under RLS — correctly fail-closed, but confusing during development.
 *
 * The callback receives a Drizzle transaction handle. Use `tx.query.X.find*`,
 * `tx.select()`, `tx.insert()`, `tx.update()`, `tx.delete()` — all of those
 * run inside the transaction with the GUCs set.
 *
 * Defensive `RESET` in `finally{}` is redundant given `SET LOCAL`, but it
 * keeps us safe against future drift (someone introducing a plain `SET` by
 * mistake) and against pgbouncer transaction-pooling quirks.
 */
export async function withTenantContext<T>(
  db: any,
  params: TenantContextParams,
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx: any) => {
    await setTenantContextOnTx(tx, params);
    try {
      // Make the same context available to nested service-level transactions
      // (TransactionManager reads this ALS slot to apply the GUC again on
      // its own connection).
      return await tenantContextALS.run(params, () => callback(tx));
    } finally {
      // Belt-and-braces: clear the GUCs even though SET LOCAL would do it.
      // Wrapped in try/catch so a transaction already aborted by a prior
      // error does not mask the original failure.
      try {
        await tx.execute(sql`RESET app.current_tenant_id`);
        if (params.userId) {
          await tx.execute(sql`RESET app.current_user_id`);
        }
      } catch {
        /* swallowed: the transaction is rolling back anyway */
      }
    }
  });
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Verify that the GUC is correctly set. Useful in tests and admin
 * health-check routes. Reads on the supplied connection — pass a `tx` to
 * inspect the current transaction's view, or `db` to inspect a fresh
 * connection (which should always come back as `null`).
 */
export async function verifyTenantContext(db: any): Promise<{
  tenantId: string | null;
  userId: string | null;
}> {
  const result = await db.execute(
    sql`SELECT current_setting('app.current_tenant_id', true) AS tenant_id,
               current_setting('app.current_user_id',   true) AS user_id`,
  );
  const row = result.rows?.[0] ?? result[0];
  return {
    tenantId: row?.tenant_id || null,
    userId: row?.user_id || null,
  };
}
