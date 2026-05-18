// packages/domain/src/list/use-cases/move-list.ts

// ✅ ارور ۱: حذف DomainError — "../../errors" وجود ندارد، pattern به return تبدیل شد
// ✅ ارور ۲: حذف TransactionContext — "../../ports" این type ندارد، generic TTx است

import type { ListId, BoardId } from "../../shared/ids";

import type {
  ListRepository,
  OutboxRepository,
  SequenceRepository,
  TransactionManager,
} from "../../ports";

// ============================================================================
// Deps & Command
// ============================================================================

export interface MoveListDeps {
  generateEventId: () => string;
  now: () => Date;
}

export interface MoveListCommand {
  boardId: string;
  listId: string;
  newPosition: string;
  tenantId: string;
  userId: string;
  correlationId?: string;
}

export type MoveListResult =
  | { success: false; reason: string }
  | { success: true; boardSequence: number; updatedListRevisions: Record<string, number> };

// ============================================================================
// Use Case
// ============================================================================

export async function moveListUseCase<TTx>(
  command: MoveListCommand,
  txManager: TransactionManager<TTx>,
  listRepo: ListRepository<TTx>,
  outboxRepo: OutboxRepository<TTx>,
  sequenceRepo: SequenceRepository<TTx>,
  deps: MoveListDeps,
): Promise<MoveListResult> {
  // ✅ ارور ۴+۵: branded cast یک‌بار در ابتدا
  const listId = command.listId as ListId;
  const boardId = command.boardId as BoardId;

  return txManager.serializable(async (tx) => {
    // ----------------------------------------------------------------
    // 1. Load & lock list
    // ----------------------------------------------------------------
    // ✅ ارور ۳: signature صحیح — findById(id: ListId, options?) نه object
    const list = await listRepo.findById(listId, {
      tx,
      forUpdate: true,
      tenantId: command.tenantId,
    });

    if (!list || list.deletedAt) {
      return { success: false, reason: "NOT_FOUND" };
    }

    // ----------------------------------------------------------------
    // 2. Tenant isolation
    // ----------------------------------------------------------------
    if (list.tenantId !== command.tenantId) {
      return { success: false, reason: "UNAUTHORIZED" };
    }

    const oldPosition = list.position;

    const updatedList = {
      ...list,
      position: command.newPosition,
      updatedAt: deps.now(),
    };

    // ----------------------------------------------------------------
    // 3. OCC-safe persist
    // ----------------------------------------------------------------
    const saveSuccess = await listRepo.save(tx, {
      entity: updatedList,
      expectedRevision: list.revision,
    });

    if (!saveSuccess) {
      return { success: false, reason: "STALE_REVISION" };
    }

    // ----------------------------------------------------------------
    // 4. Revision bump + board sequence
    // ----------------------------------------------------------------
    const updatedRevision = await listRepo.incrementRevision(tx, listId);
    const boardSequence = await sequenceRepo.nextBoardSequence(tx, boardId);

    // ----------------------------------------------------------------
    // 5. Outbox event
    // ----------------------------------------------------------------
    // ✅ ارور ۶: append(tx, event) مستقیم — نه { event: { ... } }
    await outboxRepo.append(tx, {
      eventId: deps.generateEventId(),
      eventVersion: "v1",
      aggregateId: command.boardId,
      aggregateType: "BOARD",
      type: "LIST_MOVED",
      sequence: boardSequence,
      occurredAt: deps.now(),
      correlationId: command.correlationId,
      payload: {
        listId: list.id,
        boardId: command.boardId,
        oldPosition,
        newPosition: command.newPosition,
        revision: updatedRevision,
      },
    });

    return {
      success: true,
      boardSequence: Number(boardSequence),
      updatedListRevisions: { [list.id]: updatedRevision },
    };
  });
}