// packages/db/src/lib/softDeleteFilter.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Soft-delete and archive condition helpers — type-safe Drizzle SQL fragments.
//
// Every repository in this package that reads from a table with a `deleted_at`
// or `archived_at` column MUST go through these helpers instead of inlining
// `isNull(table.deletedAt)`. Two reasons:
//
//   1. Single source of truth. If we ever change the soft-delete contract
//      (e.g. add a tombstone column, add an `IS DISTINCT FROM` variant for
//       a non-NULLable column), it changes here and every caller picks up
//       the new behaviour for free.
//
//   2. Self-documenting reads. `notDeleted(workspaces)` reads as the
//      business rule it implements; `isNull(workspaces.deletedAt)` reads
//      as the implementation detail.
//
// The generic constraints (`T extends { deletedAt: AnyPgColumn }`) make
// TypeScript reject any caller that passes a table without the relevant
// column at compile time — no runtime fallback, no any-cast.
// ─────────────────────────────────────────────────────────────────────────────

import { isNull, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Returns a Drizzle condition `<table>.deleted_at IS NULL`.
 *
 * Use in every read query against a soft-deletable table. For tables that
 * also have `archived_at`, compose with {@link notArchived} via `and(...)`.
 *
 * @example
 *   db.select().from(workspaces).where(and(eq(workspaces.id, id), notDeleted(workspaces)))
 */
export function notDeleted<T extends { deletedAt: AnyPgColumn }>(table: T): SQL {
  return isNull(table.deletedAt);
}

/**
 * Returns a Drizzle condition `<table>.archived_at IS NULL`.
 *
 * For boards specifically, "archived" hides the row from sidebar/listing
 * surfaces but keeps it readable when the user navigates directly. Most
 * read paths therefore want `and(notDeleted(boards), notArchived(boards))`,
 * but the routes that show archived boards (Board Settings → Archive tab)
 * skip {@link notArchived}.
 */
export function notArchived<T extends { archivedAt: AnyPgColumn }>(table: T): SQL {
  return isNull(table.archivedAt);
}
