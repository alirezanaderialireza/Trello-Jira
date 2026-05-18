// packages/domain/src/list/use-cases/delete-list.ts

// ✅ ارور ۱: حذف "../../errors" — وجود ندارد، pattern به return تبدیل شد
// ✅ ارور ۲: حذف TransactionContext — ports این type ندارد، generic TTx است

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

export interface DeleteListDeps {
  generateEventId: () => string;
  now: () => Date;
}

export interface DeleteListCommand {
  boardId: string;
  listId: string;
  tenantId: string;
  userId: string;
  correlationId?: string;
}

export type DeleteListResult =
  | { success: false; reason: string }
  | { success: true; boardSequence: number; deletedListId: string };

// ============================================================================
// Use Case
// ============================================================================

export async function deleteListUseCase<TTx>(
  command: DeleteListCommand,
  txManager: TransactionManager<TTx>,
  listRepo: ListRepository<TTx>,
  outboxRepo: OutboxRepository<TTx>,
  sequenceRepo: SequenceRepository<TTx>,
  deps: DeleteListDeps,
): Promise<DeleteListResult> {
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

    // ----------------------------------------------------------------
    // 3. Soft delete
    // ----------------------------------------------------------------
    const deletedAt = deps.now();
    const updatedList = { ...list, deletedAt };

    const saveSuccess = await listRepo.save(tx, {
      entity: updatedList,
      expectedRevision: list.revision,
    });

    if (!saveSuccess) {
      return { success: false, reason: "STALE_REVISION" };
    }

    // ----------------------------------------------------------------
    // 4. Board sequence
    // ----------------------------------------------------------------
    const boardSequence = await sequenceRepo.nextBoardSequence(tx, boardId);

    // ----------------------------------------------------------------
    // 5. Outbox event
    // ----------------------------------------------------------------
    // ✅ ارور ۵: append(tx, event) مستقیم — نه { event: { ... } }
    await outboxRepo.append(tx, {
      eventId: deps.generateEventId(),
      eventVersion: "v1",
      aggregateId: command.boardId,
      aggregateType: "BOARD",
      type: "LIST_DELETED",
      sequence: boardSequence,
      occurredAt: deletedAt,
      correlationId: command.correlationId,
      payload: {
        listId: list.id,
        boardId: command.boardId,
        revision: list.revision,
      },
    });

    return {
      success: true,
      boardSequence: Number(boardSequence),
      deletedListId: list.id,
    };
  });
}