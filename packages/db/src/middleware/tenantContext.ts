// packages/db/src/middleware/tenantContext.ts
// ─────────────────────────────────────────────────────────────────────────────
// Tenant Context Middleware — sets app.current_tenant_id + app.current_user_id
// PostgreSQL GUC variables before every query so RLS policies fire correctly.
//
// Usage (in tRPC createContext or any DB-accessing middleware):
//   await withTenantContext(db, { tenantId, userId }, async (tx) => {
//     return tx.select().from(boards)...
//   });
//
// Note: Uses SET LOCAL so the GUC is session-scoped to the current transaction.
// SET LOCAL is reset automatically when the transaction ends — safe for pooled
// connections.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";

export interface TenantContextParams {
  tenantId: string;
  userId?:  string;
}

/**
 * Execute `callback` inside a transaction with the tenant/user context set.
 * This is the ONLY correct way to run queries that depend on RLS policies.
 */
export async function withTenantContext<T>(
  db: any,
  params: TenantContextParams,
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx: any) => {
    // SET LOCAL — cleared when the transaction ends (safe for connection pools)
    await tx.execute(sql`SET LOCAL app.current_tenant_id = ${params.tenantId}`);
    if (params.userId) {
      await tx.execute(sql`SET LOCAL app.current_user_id = ${params.userId}`);
    }
    return callback(tx);
  });
}

/**
 * Lightweight helper: set context on a raw connection (no transaction wrapper).
 * Use only when you already own an explicit transaction.
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
 * Verify that the GUC is correctly set (useful in tests / health checks).
 */
export async function verifyTenantContext(db: any): Promise<{
  tenantId: string | null;
  userId:   string | null;
}> {
  const result = await db.execute(
    sql`SELECT current_setting('app.current_tenant_id', true) AS tenant_id,
               current_setting('app.current_user_id',   true) AS user_id`,
  );
  const row = result.rows?.[0] ?? result[0];
  return {
    tenantId: row?.tenant_id || null,
    userId:   row?.user_id   || null,
  };
}
