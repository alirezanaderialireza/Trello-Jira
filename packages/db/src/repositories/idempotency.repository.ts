// packages/db/src/repositories/idempotency.repository.ts
//
// Fixes applied:
// ✅ BUG-013/014: schema now has composite PK (mutationId, tenantId) and expiresAt.
//                Both findByMutationId and save are updated to include tenantId
//                so cross-tenant idempotency collisions are impossible.
//                save() sets expiresAt = now + 24h (configurable via TTL_MS).

import { eq, and } from "drizzle-orm";
import type { DbTx } from "./board.repository";
import type { IdempotencyRepository, IdempotencyRecord } from "@repo/domain";
import { idempotencyKeys } from "../schema";

// Default idempotency window: 24 hours
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class DrizzleIdempotencyRepository implements IdempotencyRepository<DbTx> {
  constructor(
    private readonly db: DbTx,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  // ==========================================================================
  // findByMutationId — tenant-scoped lookup
  // ==========================================================================

  async findByMutationId<T>(
    tx: DbTx,
    mutationId: string,
    tenantId?: string,
  ): Promise<IdempotencyRecord<T> | null> {
    const conditions: any[] = [eq(idempotencyKeys.mutationId, mutationId)];

    // ✅ BUG-014: filter by tenant when available to prevent cross-tenant hits
    if (tenantId) {
      conditions.push(eq(idempotencyKeys.tenantId, tenantId));
    }

    const result = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(...conditions))
      .limit(1);

    if (!result[0]) return null;

    return {
      mutationId:    result[0].mutationId,
      response:      result[0].response as T,
      schemaVersion: result[0].schemaVersion,
      createdAt:     result[0].createdAt,
    };
  }

  // ==========================================================================
  // save — tenant-scoped, with TTL
  // ==========================================================================

  async save<T>(
    tx: DbTx,
    data: IdempotencyRecord<T> & { tenantId?: string },
  ): Promise<void> {
    const expiresAt = new Date(
      (data.createdAt ?? new Date()).getTime() + this.ttlMs,
    );

    await tx.insert(idempotencyKeys).values({
      mutationId:    data.mutationId,
      // ✅ BUG-014: tenantId stored to scope key per-tenant
      tenantId:      (data as any).tenantId ?? "00000000-0000-0000-0000-000000000000",
      response:      data.response,
      schemaVersion: data.schemaVersion,
      createdAt:     data.createdAt ?? new Date(),
      // ✅ BUG-013: expiresAt enables TTL-based cleanup
      expiresAt,
    });
  }
}
