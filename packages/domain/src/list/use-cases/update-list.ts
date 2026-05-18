// packages/domain/src/list/use-cases/update-list.ts

// ✅ ارور ۱: حذف node:crypto — domain نباید از crypto مستقیم استفاده کند
// correlationId fallback را به deps منتقل می‌کنیم

// ✅ ارور ۲: حذف DomainError class — در این فایل throw نمی‌کنیم، return می‌کنیم
// use-case pattern این فایل result-based است نه exception-based

import type { ListId, BoardId, UserId, TenantId, MutationId } from "../../shared/ids";

import type {
  ListRepository,
  OutboxRepository,
  SequenceRepository,
  IdempotencyRepository,
  AuditRepository,
  TransactionManager,
  JsonObject,
} from "../../ports";
// ✅ ارور ۳: TransactionContext وجود ندارد — ports از generic TTx استفاده می‌کند

// ============================================================================
// Deps & Command
// ============================================================================

export interface UpdateListDeps {
  generateEventId: () => string;
  generateCorrelationId: () => string; // ✅ ارور ۱: جایگزین crypto.randomUUID
  now: () => Date;
}

export interface UpdateListCommand {
  listId: string;
  boardId: string;
  tenantId: string;
  userId: string;
  title?: string;
  // ✅ ارور ۵: description حذف شد — List type این فیلد را ندارد
  mutationId: string;
  correlationId?: string;
}

export type UpdateListResponse = {
  boardSequence: number;
  updatedListId: string;
  title: string;
};

export type UpdateListResult =
  | { success: false; reason: string }
  | { success: true; data: UpdateListResponse };

const LIST_TITLE_MAX_LENGTH = 255;

// ============================================================================
// Use Case
// ============================================================================

export async function updateListUseCase<TTx>(
  command: UpdateListCommand,
  txManager: TransactionManager<TTx>,
  listRepo: ListRepository<TTx>,
  outboxRepo: OutboxRepository<TTx>,
  sequenceRepo: SequenceRepository<TTx>,
  idempotencyRepo: IdempotencyRepository<TTx>,
  auditRepo: AuditRepository<TTx>,
  deps: UpdateListDeps,
): Promise<UpdateListResult> {
  // ✅ ارور ۶: branded cast یک‌بار در ابتدا
  const listId = command.listId as ListId;
  const boardId = command.boardId as BoardId;
  const userId = command.userId as UserId;
  const tenantId = command.tenantId as TenantId;
  const mutationId = command.mutationId as MutationId;

  return txManager.serializable(async (tx) => {
    // ----------------------------------------------------------------
    // 0. Idempotency check
    // ----------------------------------------------------------------
    const replay = await idempotencyRepo.findByMutationId<UpdateListResponse>(
      tx,
      mutationId,
    );
    if (replay) return { success: true, data: replay.response };

    // ----------------------------------------------------------------
    // 1. Load & lock list
    // ----------------------------------------------------------------
    // ✅ ارور ۴: signature صحیح — findById(id: ListId, options?)
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
    // 3. Normalize & apply updates
    // ----------------------------------------------------------------
    let updated = false;
    let newTitle = list.title;

    if (command.title !== undefined) {
      newTitle = normalizeTitle(command.title);
      updated = true;
    }

    if (!updated) {
      return { success: false, reason: "INVALID_REQUEST_PAYLOAD" };
    }

    // ✅ ارور ۵: description وجود ندارد در List — فقط title آپدیت می‌شود
    const updatedList = {
      ...list,
      title: newTitle,
      updatedAt: deps.now(),
    };

    // ----------------------------------------------------------------
    // 4. OCC-safe persist
    // ----------------------------------------------------------------
    const saveSuccess = await listRepo.save(tx, {
      entity: updatedList,
      expectedRevision: list.revision,
    });

    if (!saveSuccess) {
      return { success: false, reason: "STALE_REVISION" };
    }

    // ----------------------------------------------------------------
    // 5. Board sequence
    // ----------------------------------------------------------------
    const boardSequence = await sequenceRepo.nextBoardSequence(tx, boardId);

    // ----------------------------------------------------------------
    // 6. Outbox event
    // ----------------------------------------------------------------
    await outboxRepo.append(tx, {
      eventId: deps.generateEventId(),
      eventVersion: "v1",
      aggregateId: command.boardId,
      aggregateType: "BOARD",
      type: "LIST_UPDATED",
      sequence: boardSequence,
      occurredAt: deps.now(),
      correlationId: command.correlationId,
      payload: {
        listId: list.id,
        boardId: command.boardId,
        title: updatedList.title,
        revision: list.revision,
      } satisfies JsonObject,
    });

    // ----------------------------------------------------------------
    // 7. Audit trail
    // ----------------------------------------------------------------
    // ✅ ارور ۶: actorId/tenantId branded cast
    // ✅ ارور ۷: beforeState null → {}, afterState List → JsonObject
    const beforeSnapshot: JsonObject = {
      title: list.title,
    };
    const afterSnapshot: JsonObject = {
      title: updatedList.title,
      listId: list.id,
      boardId: command.boardId,
    };

    await auditRepo.append(tx, {
      actorId: userId,                                           // ✅ UserId
      tenantId,                                                  // ✅ TenantId
      action: "LIST_UPDATED",
      entityId: list.id,
      entityType: "LIST",
      correlationId: command.correlationId ?? deps.generateCorrelationId(), // ✅ بدون crypto
      beforeState: beforeSnapshot,                               // ✅ JsonObject نه null
      afterState: afterSnapshot,                                 // ✅ JsonObject نه List
    });

    // ----------------------------------------------------------------
    // 8. Save idempotency
    // ----------------------------------------------------------------
    const response: UpdateListResponse = {
      boardSequence: Number(boardSequence),
      updatedListId: list.id,
      title: updatedList.title,
    };

    await idempotencyRepo.save(tx, {
      mutationId,                   // ✅ MutationId branded
      response,
      schemaVersion: "v2",
      createdAt: deps.now(),
    });

    return { success: true, data: response };
  });
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeTitle(raw: string): string {
  if (typeof raw !== "string") {
    throw new TypeError("List title must be a string");
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (!normalized.length) {
    throw new RangeError("List title is required");
  }
  if (normalized.length > LIST_TITLE_MAX_LENGTH) {
    throw new RangeError(
      `List title exceeds max length of ${LIST_TITLE_MAX_LENGTH}`,
    );
  }
  return normalized;
}