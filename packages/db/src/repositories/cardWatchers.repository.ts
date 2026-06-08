// packages/db/src/repositories/cardWatchers.repository.ts
//
// Phase 1.2 (F1.2.9) — Drizzle implementation of the card_watchers store.
//
// Plain repository (no domain port): card watchers are a thin
// infrastructure concern — there is no domain aggregate or invariant beyond
// "a (card, user) pair either exists or not". Mirrors the read/write shape of
// DrizzleCardAssigneesRepository:
//   • Reads accept an optional { tx, tenantId } options bag.
//   • Writes always take an explicit tx for atomic composition with the
//     outbox / idempotency writes in the same router transaction.

import { and, eq } from "drizzle-orm";

import { cardWatchers } from "../schema/cardWatchers";
import type { DbTx } from "./board.repository";

export interface CardWatcherEntity {
  cardId:    string;
  userId:    string;
  tenantId:  string;
  createdAt: Date;
}

export interface WatcherFindOptions {
  tx?:       DbTx;
  tenantId?: string;
}

export class DrizzleCardWatchersRepository {
  constructor(private readonly db: DbTx) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Reads
  // ──────────────────────────────────────────────────────────────────────────

  async findByCardId(
    cardId:   string,
    options?: WatcherFindOptions,
  ): Promise<CardWatcherEntity[]> {
    const db = options?.tx ?? this.db;
    const conditions = [eq(cardWatchers.cardId, cardId)];
    if (options?.tenantId) {
      conditions.push(eq(cardWatchers.tenantId, options.tenantId));
    }
    const rows = await db
      .select()
      .from(cardWatchers)
      .where(and(...conditions));
    return rows.map((r: typeof cardWatchers.$inferSelect) => this.mapToDomain(r));
  }

  /** Reverse lookup — "cards this user watches". */
  async findByUserId(
    userId:   string,
    options?: WatcherFindOptions,
  ): Promise<Array<{ cardId: string }>> {
    const db = options?.tx ?? this.db;
    const conditions = [eq(cardWatchers.userId, userId)];
    if (options?.tenantId) {
      conditions.push(eq(cardWatchers.tenantId, options.tenantId));
    }
    const rows = await db
      .select({ cardId: cardWatchers.cardId })
      .from(cardWatchers)
      .where(and(...conditions));
    return rows.map((r: { cardId: string }) => ({ cardId: r.cardId }));
  }

  async isWatching(
    cardId:   string,
    userId:   string,
    options?: WatcherFindOptions,
  ): Promise<boolean> {
    const db = options?.tx ?? this.db;
    const conditions = [
      eq(cardWatchers.cardId, cardId),
      eq(cardWatchers.userId, userId),
    ];
    if (options?.tenantId) {
      conditions.push(eq(cardWatchers.tenantId, options.tenantId));
    }
    const rows = await db
      .select({ cardId: cardWatchers.cardId })
      .from(cardWatchers)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  /** Fan-out helper for the notification worker. */
  async getWatcherUserIds(cardId: string, tx?: DbTx): Promise<string[]> {
    const db = tx ?? this.db;
    const rows = await db
      .select({ userId: cardWatchers.userId })
      .from(cardWatchers)
      .where(eq(cardWatchers.cardId, cardId));
    return rows.map((r: { userId: string }) => r.userId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Writes
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Idempotently register a watcher. ON CONFLICT DO NOTHING so auto-watch
   * (on card create / comment) can run unconditionally without a prior
   * existence check.
   */
  async watch(
    cardId:   string,
    userId:   string,
    tenantId: string,
    tx:       DbTx,
  ): Promise<void> {
    await tx
      .insert(cardWatchers)
      .values({ cardId, userId, tenantId })
      .onConflictDoNothing();
  }

  async unwatch(cardId: string, userId: string, tx: DbTx): Promise<void> {
    await tx
      .delete(cardWatchers)
      .where(
        and(
          eq(cardWatchers.cardId, cardId),
          eq(cardWatchers.userId, userId),
        ),
      );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mapping
  // ──────────────────────────────────────────────────────────────────────────

  private mapToDomain(
    row: typeof cardWatchers.$inferSelect,
  ): CardWatcherEntity {
    return {
      cardId:    row.cardId,
      userId:    row.userId,
      tenantId:  row.tenantId,
      createdAt: row.createdAt,
    };
  }
}
