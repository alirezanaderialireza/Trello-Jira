// packages/db/src/repositories/sequence.repository.ts

import { eq, sql } from "drizzle-orm";
import type { DbTx } from "./board.repository";
import type { SequenceRepository } from "@repo/domain";
import { boardSequences } from "../schema";

// ============================================================================
// DrizzleSequenceRepository (Enterprise-Grade)
// ============================================================================
export class DrizzleSequenceRepository implements SequenceRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ========================================================================
  // 🔢 Next Board Sequence (Atomic, Upsert)
  // ========================================================================
  async nextBoardSequence(tx: DbTx, boardId: string): Promise<number> {
    // اگر رکورد برای boardId وجود نداشت، بساز با مقدار 1
    // اگر وجود داشت، nextValue را یکی افزایش بده
    const result = await tx
      .insert(boardSequences)
      .values({ boardId, nextValue: 1 })
      .onConflictDoUpdate({
        target: boardSequences.boardId,
        set: { nextValue: sql`${boardSequences.nextValue} + 1` },
      })
      .returning({ nextValue: boardSequences.nextValue });

    if (!result[0]) throw new Error(`Failed to generate next sequence for board ${boardId}`);
    return result[0].nextValue;
  }
}