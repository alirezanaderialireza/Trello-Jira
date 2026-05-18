import { pgTable, uuid, integer } from "drizzle-orm/pg-core";

// ============================================================================
// 🗄️ Board Sequences Table
// ============================================================================
// وظیفه: نگهداری آخرین sequence هر بورد برای outbox / event ordering
// هر بورد یک رکورد دارد که با increment افزایش می‌یابد
// ============================================================================

export const boardSequences = pgTable(
  "board_sequences",
  {
    // =========================================================================
    // 🔹 Aggregate Reference
    // =========================================================================
    boardId: uuid("board_id").primaryKey(),

    // =========================================================================
    // 🔹 Next Sequence Value
    // =========================================================================
    nextValue: integer("next_value")
      .notNull()
      .default(1),
  }
);

// =============================================================================
// Types
// =============================================================================
export type BoardSequence = typeof boardSequences.$inferSelect;
export type NewBoardSequence = typeof boardSequences.$inferInsert;