// packages/db/src/schema/sequence.ts
//
// Fixes applied:
// ✅ BUG-012: nextValue changed from integer (32-bit, max ~2.1B) to bigint.
//             boardSequences is the upstream counter feeding outboxEvents.sequence.
//             At 100 events/sec it would overflow in ~248 days with integer.
//             bigint { mode: "number" } keeps JS number semantics while storing
//             as PostgreSQL bigint (64-bit, max ~9.2 × 10^18).

import { pgTable, uuid, bigint } from "drizzle-orm/pg-core";

export const boardSequences = pgTable(
  "board_sequences",
  {
    // =========================================================================
    // Aggregate Reference
    // =========================================================================
    boardId: uuid("board_id").primaryKey(),

    // =========================================================================
    // ✅ BUG-012: bigint — no 32-bit overflow
    // =========================================================================
    nextValue: bigint("next_value", { mode: "number" })
      .notNull()
      .default(1),
  },
);

// =============================================================================
// Types
// =============================================================================
export type BoardSequence = typeof boardSequences.$inferSelect;
export type NewBoardSequence = typeof boardSequences.$inferInsert;
