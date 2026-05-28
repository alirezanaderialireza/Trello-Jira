// packages/db/src/schema/checklists.ts
//
// Phase 1.2 (F1.2.3.a) checklists schema. The corresponding migration
// is `0009_phase1.2_checklists.sql` — keep these two files in
// lock-step. If a column lands here without a migration, fresh-DB CI
// will diverge from dev DBs that ran `drizzle-kit push` (Phase 0 L1
// lesson, repeated for the third schema redesign).
//
// Two tables live here for cohesion: checklists themselves and the
// items they contain. Both are tenant-scoped; items store
// `tenant_id` denormalised so RLS is a pure index-supported predicate
// (see migration 0009 for the rationale).

import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { workspaces } from "./workspaces";
import { boards }     from "./boards";
import { cards }      from "./cards";
import { users }      from "./users";

// ============================================================================
// ✅ Checklists Table — card-scoped task groups with LexoRank ordering
// ============================================================================

export const checklists = pgTable(
  "checklists",
  {
    // ── Identity ─────────────────────────────────────────────────────────────
    id: uuid("id").primaryKey().defaultRandom(),

    // ── Multi-Tenant Boundary ───────────────────────────────────────────────
    // FK to workspaces(id) so a hard workspace deletion cascades through.
    // RLS still enforces `tenant_id = current_tenant_id()` on every command.
    tenantId: uuid("tenant_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),

    // ── Aggregate References ────────────────────────────────────────────────
    cardId: uuid("card_id")
      .references(() => cards.id, { onDelete: "cascade" })
      .notNull(),

    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),

    // ── Display ──────────────────────────────────────────────────────────────
    // varchar(100) per F1.2.3.a D7. Length is comfortable for Persian
    // names (typical 10-30 chars) plus emoji prefixes; tighter than the
    // 0002 stub's varchar(128).
    title: varchar("title", { length: 100 }).notNull(),

    // ── Ordering ─────────────────────────────────────────────────────────────
    // LexoRank string. Generated client-side via
    // `@repo/domain/ordering → generatePosition` for offline-friendly
    // optimistic insertions; server validates on write. Replaces the
    // 0002 stub's integer position which couldn't survive a multi-user
    // reorder without server-side compaction.
    position: varchar("position", { length: 255 }).notNull(),

    // ── Audit / Lifecycle ───────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    // Card-scoped ordered listing — the dominant SELECT path.
    cardOrderIdx: index("idx_checklists_card")
      .on(table.cardId, table.position)
      .where(sql`${table.deletedAt} IS NULL`),

    // Tenant predicate hint (RLS planner).
    tenantIdx: index("idx_checklists_tenant").on(table.tenantId),

    // Case-insensitive uniqueness within a card for live checklists.
    // LOWER() is IMMUTABLE in stock PostgreSQL → safe in a partial-
    // index predicate.
    uniqueTitlePerCard: uniqueIndex("idx_checklists_unique_title_per_card")
      .on(table.cardId, sql`LOWER(${table.title})`)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);

// ============================================================================
// ☑️ Checklist Items Table — items belonging to a checklist
// ============================================================================
// Items are reached only through their parent checklist. We store
// `tenant_id` denormalised (instead of joining to checklists at RLS-
// evaluation time) so the SELECT policy is a pure index-supported
// predicate. We protect the denormalisation by:
//   • Application code: the checklists router always inserts the
//     tenant_id from `ctx.session`, never from the input.
//   • RLS WITH CHECK: the INSERT policy enforces
//     `tenant_id = current_tenant_id()`, so a buggy router that forgets
//     to set tenant_id would be rejected at the DB.
// Same defence-in-depth pattern as labels' card_labels in 0007.

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    tenantId: uuid("tenant_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),

    checklistId: uuid("checklist_id")
      .references(() => checklists.id, { onDelete: "cascade" })
      .notNull(),

    // varchar(500) per F1.2.3.a D6 — items can be sentences, not just
    // labels. Tighter would frustrate users entering acceptance criteria.
    text: varchar("text", { length: 500 }).notNull(),

    isDone: boolean("is_done").notNull().default(false),

    position: varchar("position", { length: 255 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    checklistOrderIdx: index("idx_checklist_items_checklist")
      .on(table.checklistId, table.position),

    tenantIdx: index("idx_checklist_items_tenant").on(table.tenantId),
  }),
);

// ============================================================================
// 🏷️ TypeScript Types
// ============================================================================

export type Checklist        = typeof checklists.$inferSelect;
export type NewChecklist     = typeof checklists.$inferInsert;
export type ChecklistItem    = typeof checklistItems.$inferSelect;
export type NewChecklistItem = typeof checklistItems.$inferInsert;
