// packages/domain/src/list/move-list.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// MoveListHandler — wraps the existing functional `moveListUseCase` in the
// same class-style command-handler shape that CreateListHandler uses, so the
// tRPC services container can construct it uniformly.
//
// The actual business logic still lives in `./use-cases/move-list.ts`. This
// class just adds:
//   • Dependency injection of TxManager + repositories.
//   • Translation of the loosely-typed `reason: string` returned by the
//     functional use case into the shared `DomainErrorReason` union.
//   • A consistent `execute()` API matching CreateListHandler.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ListRepository,
  OutboxRepository,
  SequenceRepository,
  TransactionManager,
  Logger,
} from "../ports";
import type { DomainErrorReason } from "../errors/error-codes";
import { moveListUseCase, type MoveListCommand as InnerCommand } from "./use-cases/move-list";

// ============================================================================
// Public Contracts (mirror CreateListHandler)
// ============================================================================

export interface MoveListCommand {
  boardId: string;
  listId: string;
  newPosition: string;
  tenantId: string;
  userId: string;
  mutationId: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
}

export type MoveListResult =
  | { success: false; reason: DomainErrorReason }
  | {
      success: true;
      boardSequence: number;
      updatedListRevisions: Record<string, number>;
    };

// ============================================================================
// Handler
// ============================================================================

export class MoveListHandler<DbTx = unknown> {
  constructor(
    private readonly txManager: TransactionManager<DbTx>,
    private readonly listRepo: ListRepository<DbTx>,
    private readonly outboxRepo: OutboxRepository<DbTx>,
    private readonly sequenceRepo: SequenceRepository<DbTx>,
    private readonly logger: Logger,
    private readonly deps: {
      generateEventId: () => string;
      now: () => Date;
    } = {
      generateEventId: () => crypto.randomUUID(),
      now: () => new Date(),
    },
  ) {}

  async execute(command: MoveListCommand): Promise<MoveListResult> {
    const trace = {
      traceId: command.traceId,
      spanId: command.spanId,
      correlationId: command.correlationId,
      mutationId: command.mutationId,
    };

    const trimmedPosition = command.newPosition?.trim();
    if (!trimmedPosition) {
      return { success: false, reason: "INVALID_REQUEST_PAYLOAD" };
    }

    const inner: InnerCommand = {
      boardId: command.boardId,
      listId: command.listId,
      newPosition: trimmedPosition,
      tenantId: command.tenantId,
      userId: command.userId,
      correlationId: command.correlationId,
    };

    try {
      const result = await moveListUseCase(
        inner,
        this.txManager,
        this.listRepo,
        this.outboxRepo,
        this.sequenceRepo,
        {
          generateEventId: this.deps.generateEventId,
          now: this.deps.now,
        },
      );

      if (result.success) {
        this.logger.info({
          event: "list_moved",
          listId: command.listId,
          boardId: command.boardId,
          boardSequence: result.boardSequence,
          ...trace,
        });
        return result;
      }

      // The functional use case returns string reasons. Map the known ones to
      // the domain enum; anything unknown becomes INVALID_REQUEST_PAYLOAD so
      // the API maps it to a stable client error.
      return {
        success: false,
        reason: this.mapReason(result.reason),
      };
    } catch (error: unknown) {
      const safeCode =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "UNKNOWN_DB_ERROR";

      this.logger.error({
        event: "move_list_failed",
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

  private mapReason(raw: string): DomainErrorReason {
    switch (raw) {
      case "NOT_FOUND":
      case "UNAUTHORIZED":
      case "FORBIDDEN":
      case "STALE_REVISION":
      case "ACL_MISMATCH":
      case "DEADLOCK_DETECTED":
      case "OUTBOX_LAGGING":
      case "BOARD_ARCHIVED":
        return raw;
      default:
        return "INVALID_REQUEST_PAYLOAD";
    }
  }
}
