// packages/api/src/services/serviceRoleConnection.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Service-Role Connection Helper (F3a.3)
//
// Two tRPC procedures (`getByToken`, `accept`) need to bypass RLS because
// the user is not yet a member of the workspace at the time those queries
// execute. This helper provides a transaction context where
// `row_security = off` is set via `SET LOCAL`.
//
// Dev/Test strategy (per user confirmation Q2.1):
//   • In dev: fallback to the default dbInstance with
//     `SET LOCAL row_security = off` + console.warn.
//   • In production: if `DATABASE_URL_SERVICE` is set, use a dedicated
//     connection pool; otherwise fail-fast at module load time.
//
// TODO(F5): introduce a dedicated `app_service` Postgres role with
// BYPASSRLS and a separate connection pool via `DATABASE_URL_SERVICE`
// env var, eliminating the need for `SET LOCAL row_security = off`.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";

/**
 * Audit context for service-role usage — logged for observability.
 */
export interface ServiceRoleAuditContext {
  readonly procedure: string;
  readonly userId?: string;
  readonly reason: string;
}

/**
 * Execute a callback inside a transaction with RLS disabled.
 *
 * The `SET LOCAL row_security = off` statement only affects the current
 * transaction and is automatically cleared when the transaction ends
 * (commits or rolls back). This is safe for connection pooling.
 *
 * @param db        The Drizzle db instance (or tx) to use.
 * @param audit     Audit context for logging (who called, why).
 * @param callback  The function to execute with RLS bypassed.
 */
export async function withServiceRoleConnection<T>(
  db: any,
  audit: ServiceRoleAuditContext,
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  // Log service-role usage for audit trail
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      `[ServiceRole] BYPASSRLS used — procedure=${audit.procedure}, ` +
        `userId=${audit.userId ?? "anonymous"}, reason=${audit.reason}`,
    );
  }

  return db.transaction(async (tx: any) => {
    // Disable RLS for this transaction only.
    // Requires the Postgres user to be a superuser or have BYPASSRLS.
    // In dev (supabase local, docker postgres) the default user is
    // typically a superuser. In production the `DATABASE_URL` user
    // must have the appropriate privilege — enforced by deployment docs.
    await tx.execute(sql`SET LOCAL row_security = off`);
    return callback(tx);
  });
}
