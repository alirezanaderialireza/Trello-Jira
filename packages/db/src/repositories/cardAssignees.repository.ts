// packages/db/src/repositories/cardAssignees.repository.ts
//
// Phase 1.2 (F1.2.5) — Drizzle implementation of CardAssigneesRepository.
//
// Mirrors DrizzleCommentsRepository (F1.2.4.a):
//   • Reads accept FindOptions<DbTx> for tenant + tx scoping.
//   • Writes always take an explicit tx for atomic outbox composition.
//   • findByCardIdWithUsers JOINs users table so the list procedure
//     returns display names + avatars in one round-trip.
//   • isBoardMember queries board_members for the D5 guard.

import { and, eq, isNull, asc, sql } from "drizzle-orm";

import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
  FindOptions,
} from "@repo/domain";
import type {
  AssigneeDto,
  AssigneeId,
  CardAssigneeEntity,
  CardAssigneesRepository,
} from "@repo/domain";

import { cardAssignees } from "../schema/cardAssignees";
import { boardMembers }  from "../schema/boardMembers";
import { users }         from "../schema/users";
import type { DbTx }     from "./board.repository";

// ============================================================================
// DrizzleCardAssigneesRepository
// ============================================================================

export class DrizzleCardAssigneesRepository
  implements CardAssigneesRepository<DbTx>
{
  constructor(private readonly db: DbTx) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Reads
  // ──────────────────────────────────────────────────────────────────────────

  async findByCardId(
    cardId:   CardId,
    options?: FindOptions<DbTx>,
  ): Promise<CardAssigneeEntity[]> {
    const db = options?.tx ?? this.db;
    const conditions = [eq(cardAssignees.cardId, cardId)];
    if (options?.tenantId) {
      conditions.push(eq(cardAssignees.tenantId, options.tenantId));
    }
    const rows = await db
      .select()
      .from(cardAssignees)
      .where(and(...conditions))
      .orderBy(asc(cardAssignees.assignedAt));

    return rows.map((r: typeof cardAssignees.$inferSelect) =>
      this.mapToDomain(r),
    );
  }

  async findByCardIdWithUsers(
    cardId:   CardId,
    options?: FindOptions<DbTx>,
  ): Promise<AssigneeDto[]> {
    const db = options?.tx ?? this.db;
    const conditions = [eq(cardAssignees.cardId, cardId)];
    if (options?.tenantId) {
      conditions.push(eq(cardAssignees.tenantId, options.tenantId));
    }

    const rows = await db
      .select({
        userId:      cardAssignees.userId,
        assignedAt:  cardAssignees.assignedAt,
        displayName: users.displayName,
        avatarUrl:   users.avatarUrl,
        email:       users.email,
      })
      .from(cardAssignees)
      // LEFT JOIN so we still return a row even if the user was hard-deleted.
      .leftJoin(users, sql`${users.id}::text = ${cardAssignees.userId}`)
      .where(and(...conditions))
      .orderBy(asc(cardAssignees.assignedAt));

    return rows.map((r: any): AssigneeDto => ({
      userId:      r.userId,
      displayName: r.displayName ?? "کاربر ناشناس",
      avatarUrl:   r.avatarUrl   ?? null,
      email:       r.email       ?? "",
      assignedAt:  r.assignedAt.toISOString(),
    }));
  }

  async findByUserId(
    userId:   AssigneeId,
    options?: FindOptions<DbTx>,
  ): Promise<CardAssigneeEntity[]> {
    const db = options?.tx ?? this.db;
    const conditions = [eq(cardAssignees.userId, userId)];
    if (options?.tenantId) {
      conditions.push(eq(cardAssignees.tenantId, options.tenantId));
    }
    const rows = await db
      .select()
      .from(cardAssignees)
      .where(and(...conditions));
    return rows.map((r: typeof cardAssignees.$inferSelect) =>
      this.mapToDomain(r),
    );
  }

  async isAssigned(
    cardId:   CardId,
    userId:   AssigneeId,
    options?: FindOptions<DbTx>,
  ): Promise<boolean> {
    const db = options?.tx ?? this.db;
    const conditions = [
      eq(cardAssignees.cardId, cardId),
      eq(cardAssignees.userId, userId),
    ];
    if (options?.tenantId) {
      conditions.push(eq(cardAssignees.tenantId, options.tenantId));
    }
    const rows = await db
      .select({ cardId: cardAssignees.cardId })
      .from(cardAssignees)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  async countByCardId(
    cardId:   CardId,
    options?: FindOptions<DbTx>,
  ): Promise<number> {
    const db = options?.tx ?? this.db;
    const conditions = [eq(cardAssignees.cardId, cardId)];
    if (options?.tenantId) {
      conditions.push(eq(cardAssignees.tenantId, options.tenantId));
    }
    const rows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(cardAssignees)
      .where(and(...conditions));
    return rows[0]?.count ?? 0;
  }

  async isBoardMember(
    boardId:  BoardId,
    userId:   AssigneeId,
    options?: FindOptions<DbTx>,
  ): Promise<boolean> {
    const db = options?.tx ?? this.db;
    const rows = await db
      .select({ id: boardMembers.id })
      .from(boardMembers)
      .where(
        and(
          eq(boardMembers.boardId,  boardId),
          eq(boardMembers.userId,   userId),
          isNull(boardMembers.removedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Writes
  // ──────────────────────────────────────────────────────────────────────────

  async create(tx: DbTx, entity: CardAssigneeEntity): Promise<void> {
    await tx.insert(cardAssignees).values({
      cardId:     entity.cardId,
      userId:     entity.userId,
      tenantId:   entity.tenantId,
      assignedBy: entity.assignedBy,
      assignedAt: entity.assignedAt,
    });
  }

  async delete(
    tx:     DbTx,
    cardId: CardId,
    userId: AssigneeId,
  ): Promise<void> {
    await tx
      .delete(cardAssignees)
      .where(
        and(
          eq(cardAssignees.cardId, cardId),
          eq(cardAssignees.userId, userId),
        ),
      );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mapping
  // ──────────────────────────────────────────────────────────────────────────

  private mapToDomain(
    row: typeof cardAssignees.$inferSelect,
  ): CardAssigneeEntity {
    return {
      cardId:     row.cardId     as CardId,
      userId:     row.userId     as AssigneeId,
      tenantId:   row.tenantId   as TenantId,
      assignedBy: row.assignedBy as UserId,
      assignedAt: row.assignedAt,
    };
  }
}
