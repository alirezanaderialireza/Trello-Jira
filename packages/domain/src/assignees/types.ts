// packages/domain/src/assignees/types.ts
//
// Phase 1.2 (F1.2.5) — Card Assignees domain types.
//
// AssigneeId = userId (varchar 128, not uuid) — consistent with
// board_members.user_id and the project-wide D9 decision from F3b.
// Wire-level strings in events stay as plain string; branding happens
// at the entity/repository boundary.

import type { BoardId, CardId, TenantId, UserId } from "../shared/ids";
import type { FindOptions } from "../ports";

// ============================================================================
// 1. Branded ID (alias of UserId for clarity at call-sites)
// ============================================================================

/** The userId of an assignee. Same underlying type as UserId. */
export type AssigneeId = UserId;

// ============================================================================
// 2. Entity
// ============================================================================

export interface CardAssigneeEntity {
  readonly cardId:     CardId;
  readonly userId:     AssigneeId;
  readonly tenantId:   TenantId;
  readonly assignedBy: UserId;
  readonly assignedAt: Date;
}

// ============================================================================
// 3. Read projection (joined with users table for UI display)
// ============================================================================

export interface AssigneeDto {
  readonly userId:      string;
  readonly displayName: string;
  readonly avatarUrl:   string | null;
  readonly email:       string;
  readonly assignedAt:  string; // ISO-8601
}

// ============================================================================
// 4. Repository port
// ============================================================================

export interface CardAssigneesRepository<TTx = unknown> {
  // ── Reads ────────────────────────────────────────────────────────────────

  findByCardId(
    cardId:  CardId,
    options?: FindOptions<TTx>,
  ): Promise<CardAssigneeEntity[]>;

  /** Joined with users → AssigneeDto[]. Used by the list procedure. */
  findByCardIdWithUsers(
    cardId:  CardId,
    options?: FindOptions<TTx>,
  ): Promise<AssigneeDto[]>;

  /** "My Cards" reverse lookup — used by F1.5 sidebar filter. */
  findByUserId(
    userId:  AssigneeId,
    options?: FindOptions<TTx>,
  ): Promise<CardAssigneeEntity[]>;

  isAssigned(
    cardId:  CardId,
    userId:  AssigneeId,
    options?: FindOptions<TTx>,
  ): Promise<boolean>;

  countByCardId(
    cardId:  CardId,
    options?: FindOptions<TTx>,
  ): Promise<number>;

  /**
   * Checks whether userId is an active member of boardId.
   * Used by the router for the D5 assignee-must-be-board-member guard.
   */
  isBoardMember(
    boardId: BoardId,
    userId:  AssigneeId,
    options?: FindOptions<TTx>,
  ): Promise<boolean>;

  // ── Writes ───────────────────────────────────────────────────────────────

  create(tx: TTx, entity: CardAssigneeEntity): Promise<void>;

  delete(
    tx:     TTx,
    cardId: CardId,
    userId: AssigneeId,
  ): Promise<void>;
}
