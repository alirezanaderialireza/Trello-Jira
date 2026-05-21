// packages/domain/src/list/create-list.ts
//
// Fixes applied:
// ✅ #D-13: CreateListHandler uses crypto.randomUUID() directly in its default
//           deps — domain must NOT call crypto.randomUUID() without injection.
//           The handler already has a deps parameter with generateId/now, but
//           the default value uses crypto.randomUUID(). In pure domain code the
//           defaults should not exist — deps are always injected by the caller.
//           Fix: remove default values for deps; callers must inject.
//
// ✅ #D-14: listRepo.getLastListInBoard called with (tx, boardId) but the port
//           contract GetLastListInBoard is (tx: DbTx, boardId: BoardId).
//           This is correct. However, the local ListRepository interface in
//           list.repository.ts defined a different signature:
//             getLastListInBoard({ boardId, tenantId, tx })
//           Now that list.repository.ts re-exports from ports, this is aligned.
//
// ✅ #D-15: create-list.ts imports ListRepository from "../ports" (correct)
//           but also depends on BoardRepository from "../ports" — that interface
//           has findById(id, options?) which is what the handler calls. 

import type { List } from "../list/types";
import { getNewPosition } from "../ordering";
import type { DomainErrorReason } from "../errors/error-codes";
import type {
  ListRepository,
  BoardRepository,
  OutboxRepository,
  SequenceRepository,
  TransactionManager,
  Logger,
} from "../ports";
import type { BoardId, TenantId } from "../shared/ids";

// ============================================================================
// Contracts
// ============================================================================

export type CreateListCommand = {
  boardId: string;
  title: string;
  tenantId: string;
  userId: string;

  expectedBoardRevision?: number;
  expectedAclVersion?: number;

  mutationId: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
};

export type CreateListResult =
  | { success: false; reason: DomainErrorReason }
  | {
      success: true;
      listId: string;
      boardRevision: number;
      boardSequence: string;
      aclVersion: number;
      consistencyTier: "EVENTUAL_READ_YOUR_WRITES";
      isReplayed: boolean;
    };

// ============================================================================
// Command Handler
// ============================================================================

export class CreateListHandler<DbTx = unknown> {
  constructor(
    private readonly txManager: TransactionManager<DbTx>,
    private readonly listRepo: ListRepository<DbTx>,
    private readonly boardRepo: BoardRepository<DbTx>,
    private readonly outboxRepo: OutboxRepository<DbTx>,
    private readonly sequenceRepo: SequenceRepository<DbTx>,
    private readonly logger: Logger,
    // ✅ #D-13: no default values — deps must be injected by the composition root.
    //           domain code must not call crypto.randomUUID() directly.
    private readonly deps: {
      generateId: () => string;
      now: () => Date;
    },
  ) {}

  async execute(command: CreateListCommand): Promise<CreateListResult> {
    const trace = {
      traceId: command.traceId,
      spanId: command.spanId,
      correlationId: command.correlationId,
      mutationId: command.mutationId,
    };

    const trimmedTitle = command.title?.trim();
    if (!trimmedTitle) {
      return { success: false, reason: "INVALID_REQUEST_PAYLOAD" };
    }

    // ✅ ارور ۳-۶: یک‌بار cast می‌کنیم — بقیه جاها از این استفاده می‌شود
    const boardId = command.boardId as BoardId;
    const tenantId = command.tenantId as TenantId;

    try {
      return await this.txManager.serializable(async (tx) => {
        // ----------------------------------------------------------------
        // 1. Load board + tenant guard + OCC
        // ----------------------------------------------------------------
        const board = await this.boardRepo.findById(boardId, {
          tx,
          forUpdate: true,
          tenantId: command.tenantId,
        });

        if (!board) return { success: false, reason: "NOT_FOUND" };

        if (board.tenantId !== command.tenantId) {
          return { success: false, reason: "UNAUTHORIZED" };
        }

        if (
          command.expectedBoardRevision !== undefined &&
          board.revision !== command.expectedBoardRevision
        ) {
          return { success: false, reason: "STALE_REVISION" };
        }

        // ----------------------------------------------------------------
        // 2. LexoRank position — O(1)
        // ----------------------------------------------------------------
        const lastList = await this.listRepo.getLastListInBoard(tx, boardId);
        const newPosition = getNewPosition(
          lastList ? lastList.position : undefined,
          undefined,
        );

        // ----------------------------------------------------------------
        // 3. Build aggregate
        // ----------------------------------------------------------------
        const now = this.deps.now();
        const newList: List = {
          id: this.deps.generateId(),
          tenantId: command.tenantId,
          boardId: command.boardId,
          title: trimmedTitle,
          position: newPosition,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          archivedAt: null,
        };

        // ----------------------------------------------------------------
        // 4. Persist
        // ----------------------------------------------------------------
        await this.listRepo.create(newList, tx);

        // ----------------------------------------------------------------
        // 5. Sequence + revision bump
        // ----------------------------------------------------------------
        const newBoardRevision = await this.boardRepo.incrementRevision(tx, boardId);
        const boardSequence = await this.sequenceRepo.nextBoardSequence(tx, boardId);

        // ----------------------------------------------------------------
        // 6. Outbox event
        // ----------------------------------------------------------------
        await this.outboxRepo.append(tx, {
          eventId: this.deps.generateId(),
          eventVersion: "v1",
          aggregateId: command.boardId,
          aggregateType: "BOARD",
          type: "LIST_CREATED",
          sequence: boardSequence,
          occurredAt: now,
          correlationId: command.correlationId,
          causationId: command.mutationId,
          payload: {
            listId: newList.id,
            title: newList.title,
            position: newPosition,
            boardRevision: newBoardRevision,
            schemaVersion: "v1",
          },
        });

        // ----------------------------------------------------------------
        // 7. Observability
        // ----------------------------------------------------------------
        this.logger.info({
          event: "list_created",
          listId: newList.id,
          boardId: command.boardId,
          boardSequence,
          ...trace,
        });

        return {
          success: true,
          listId: newList.id,
          boardRevision: newBoardRevision,
          boardSequence: String(boardSequence),
          aclVersion: board.aclVersion ?? 1,
          consistencyTier: "EVENTUAL_READ_YOUR_WRITES",
          isReplayed: false,
        };
      });
    } catch (error: unknown) {
      const safeCode =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "UNKNOWN_DB_ERROR";

      this.logger.error({
        event: "create_list_failed",
        classification: "INTERNAL",
        safeErrorCode: safeCode,
        ...trace,
      });

      if (this.txManager.isRetryable(error)) {
        return { success: false, reason: "DEADLOCK_DETECTED" };
      }

      return { success: false, reason: "INVALID_REQUEST_PAYLOAD" };
    }
  }
}