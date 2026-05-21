// packages/db/src/repositories/idempotency.repository.ts

import { eq } from "drizzle-orm";
import type { DbTx } from "./board.repository";
import type { IdempotencyRepository, IdempotencyRecord } from "@repo/domain";
import { idempotencyKeys } from "../schema";

// ============================================================================
// DrizzleIdempotencyRepository (Enterprise-Grade)
// ============================================================================
export class DrizzleIdempotencyRepository implements IdempotencyRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ========================================================================
  // Find Idempotency Record by Mutation ID
  // ========================================================================
  async findByMutationId<T>(tx: DbTx, mutationId: string): Promise<IdempotencyRecord<T> | null> {
    const result = await tx
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.mutationId, mutationId))
      .limit(1);

    if (!result[0]) return null;

    return {
      mutationId: result[0].mutationId,
      response: result[0].response as T,
      schemaVersion: result[0].schemaVersion,
      createdAt: result[0].createdAt,
    };
  }

  // ========================================================================
  // Save Idempotency Record
  // ========================================================================
  async save<T>(tx: DbTx, data: IdempotencyRecord<T>): Promise<void> {
    await tx.insert(idempotencyKeys).values({
      mutationId: data.mutationId,
      response: data.response,
      schemaVersion: data.schemaVersion,
      createdAt: data.createdAt ?? new Date(), // 🌟 پیش‌فرض برای createdAt
    });
  }
}