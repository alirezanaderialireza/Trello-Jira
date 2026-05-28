// packages/db/src/schema/labels.ts
//
// Phase 1.2 (F1.2.1) labels schema. The corresponding migration is
// `0007_phase1.2_labels.sql` — keep these two files in lock-step. If a
// column lands here without a migration, fresh-DB CI will diverge from
// dev DBs that ran `drizzle-kit push` (Phase 0 L1 lesson).
//
// Two tables live here for cohesion: labels themselves and the
// many-to-many `card_labels` junction. Both are tenant-scoped; the
// junction stores `tenant_id` denormalised so RLS is a pure
// index-supported predicate (see migration 0007 for the rationale).

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { workspaces } from "./workspaces";
import { boards }     from "./boards";
import { cards }      from "./cards";
import { users }      from "./users";

// ============================================================================
// 🏷️ Labels Table — board-scoped colour tags with LexoRank ordering
// ============================================================================

export const labels = pgTable(
  "labels",
  {
    // ── Identity ─────────────────────────────────────────────────────────────
    id: uuid("id").primaryKey().defaultRandom(),

    // ── Multi-Tenant Boundary ───────────────────────────────────────────────
    // FK to workspaces(id) so a hard workspace deletion cascades through.
    // RLS still enforces `tenant_id = current_tenant_id()` on every command.
    tenantId: uuid("tenant_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),

    // ── Aggregate Reference ─────────────────────────────────────────────────
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),

    // ── Display ──────────────────────────────────────────────────────────────
    // varchar(50) is comfortably wide for Persian names (typical 8–20
    // chars) plus emoji prefixes (e.g. "🐛 رفع باگ"). Migration 0007
    // narrows this from the 0002 stub's varchar(64).
    name: varchar("name", { length: 50 }).notNull(),

    // ── Colour ──────────────────────────────────────────────────────────────
    // Enum-like: the 12-token palette is enforced both here (varchar
    // length cap) and at the DB via the `labels_color_token_check`
    // constraint installed in migration 0007. Keep the canonical list
    // mirrored in `packages/domain/src/labels/types.ts → COLOR_TOKENS`.
    colorToken: varchar("color_token", { length: 20 }).notNull(),

    // ── Ordering ─────────────────────────────────────────────────────────────
    // LexoRank string. Generated client-side via
    // `@repo/domain/ordering → generatePosition` for offline-friendly
    // optimistic insertions; server validates on write.
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
    // Board-scoped ordered listing — the dominant SELECT path.
    boardOrderIdx: index("idx_labels_board")
      .on(table.boardId, table.position)
      .where(sql`${table.deletedAt} IS NULL`),

    // Tenant predicate hint (RLS planner).
    tenantIdx: index("idx_labels_tenant").on(table.tenantId),

    // Case-insensitive uniqueness within a board for live labels.
    // LOWER() is IMMUTABLE in stock PostgreSQL → safe in a partial-index
    // predicate (Phase 0 L1 lesson).
    uniqueNamePerBoard: uniqueIndex("idx_labels_unique_name_per_board")
      .on(table.boardId, sql`LOWER(${table.name})`)
      .where(sql`${table.deletedAt} IS NULL`),

    // Mirror of the migration's `labels_color_token_check` so Drizzle's
    // generated DDL matches the hand-written SQL when introspected.
    colorTokenCheck: check(
      "labels_color_token_check",
      sql`${table.colorToken} IN (
        'red.500','orange.500','yellow.500','green.500',
        'teal.500','blue.500','indigo.500','purple.500',
        'pink.500','gray.500','brown.500','black'
      )`,
    ),
  }),
);

// ============================================================================
// 🔗 card_labels — many-to-many junction
// ============================================================================
// • Composite PK (card_id, label_id) replaces the 0002 stub's synthetic
//   `id` so we don't need a separate uniqueness index.
// • `tenant_id` is denormalised — see migration 0007 header for the
//   defence-in-depth rationale.
// • `applied_by` records who applied the label; used by the activity
//   timeline (F1.2.6).

export const cardLabels = pgTable(
  "card_labels",
  {
    cardId: uuid("card_id")
      .references(() => cards.id, { onDelete: "cascade" })
      .notNull(),

    labelId: uuid("label_id")
      .references(() => labels.id, { onDelete: "cascade" })
      .notNull(),

    tenantId: uuid("tenant_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),

    appliedBy: uuid("applied_by")
      .references(() => users.id)
      .notNull(),

    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk:        primaryKey({ columns: [table.cardId, table.labelId] }),
    cardIdx:   index("idx_card_labels_card").on(table.cardId),
    labelIdx:  index("idx_card_labels_label").on(table.labelId),
    tenantIdx: index("idx_card_labels_tenant").on(table.tenantId),
  }),
);

// ============================================================================
// 🏷️ TypeScript Types
// ============================================================================

export type Label      = typeof labels.$inferSelect;
export type NewLabel   = typeof labels.$inferInsert;
export type CardLabel  = typeof cardLabels.$inferSelect;
export type NewCardLabel = typeof cardLabels.$inferInsert;
