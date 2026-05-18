// packages/domain/src/board/create-board.ts

import type {
  BoardRepository,
  BoardId,
  MutationId,
  RepositoryMutationResult,
  TenantId,
  Revision,
} from "./board.repository";

import type {
  OutboxRepository,
  AuditRepository,
  IdempotencyRepository,
  TransactionManager,
  SequenceRepository,
  JsonObject,
} from "../ports";

import type { UserId } from "../shared/ids";
import type { Board } from "./types";

// ============================================================================
// Constants
// ============================================================================

const BOARD_TITLE_MIN_LENGTH = 1;
const BOARD_TITLE_MAX_LENGTH = 120;
const POSTGRES_UNIQUE_VIOLATION_CODE = "23505";

// ============================================================================
// DomainError
// ============================================================================

class DomainError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(params: { code: string; message: string; retryable: boolean }) {
    super(params.message);
    this.code = params.code;
    this.retryable = params.retryable;
    this.name = "DomainError";
  }
}

// ============================================================================
// Deps & Input
// ============================================================================

export interface CreateBoardDeps {
  readonly generateBoardId: () => BoardId;
  readonly generateMutationId: () => MutationId;
  readonly generateEventId: () => string;
  readonly generateCorrelationId: () => string;
  readonly now: () => Date;
}

export interface CreateBoardInput {
  readonly title: string;
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly mutationId: string;
  readonly correlationId?: string;
}

// ============================================================================
// Use Case
// ============================================================================

export async function createBoardUseCase(
  input: CreateBoardInput,
  repo: BoardRepository,
  outboxRepo: OutboxRepository,
  auditRepo: AuditRepository,
  idempotencyRepo: IdempotencyRepository,
  txManager: TransactionManager,
  sequenceRepo: SequenceRepository,
  deps: CreateBoardDeps,
): Promise<Board> {
  return txManager.serializable(async (tx) => {
    // ----------------------------------------------------------------
    // 0. Idempotency check
    // ----------------------------------------------------------------
    const replay = await idempotencyRepo.findByMutationId<Board>(
      tx,
      input.mutationId as MutationId,
    );
    if (replay) return replay.response;

    // ----------------------------------------------------------------
    // 1. Normalize input
    // ----------------------------------------------------------------
    const title = normalizeBoardTitle(input.title);
    const tenantId = normalizeTenantId(input.tenantId);
    const now = deps.now();

    // ----------------------------------------------------------------
    // 2. Build board entity
    // ----------------------------------------------------------------
    const board: Board = {
      id: deps.generateBoardId(),
      tenantId,
      title,
      revision: 1 as Revision,
      aclVersion: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
    };

    // ----------------------------------------------------------------
    // 3. Persist board
    // ----------------------------------------------------------------
    let result: RepositoryMutationResult;
    try {
      result = await repo.create({
        board,
        mutationId: deps.generateMutationId(),
      });
    } catch (error: unknown) {
      if (isUniqueViolationError(error)) {
        throw new DomainError({
          code: "DOMAIN_INVARIANT_VIOLATION",
          message: "Board title already exists within tenant scope",
          retryable: false,
        });
      }
      throw error;
    }

    if (result.affectedRows !== 1) {
      throw new DomainError({
        code: "INFRASTRUCTURE_ERROR",
        message: "Board creation failed due to invalid persistence state",
        retryable: true,
      });
    }

    // ----------------------------------------------------------------
    // 4. Outbox event
    // ----------------------------------------------------------------
    const boardSequence = await sequenceRepo.nextBoardSequence(tx, board.id);

    // ✅ ارور ۲: Board مستقیم JsonObject نیست — Date fields باید ISO string شوند
    const boardPayload = boardToJsonObject(board);

    await outboxRepo.append(tx, {
      eventId: deps.generateEventId(),
      eventVersion: "v1",
      aggregateId: board.id,
      aggregateType: "BOARD",
      type: "BOARD_CREATED",
      sequence: boardSequence,
      occurredAt: now,
      correlationId: input.correlationId,
      payload: boardPayload,
    });

    // ----------------------------------------------------------------
    // 5. Audit trail
    // ----------------------------------------------------------------
    await auditRepo.append(tx, {
      actorId: input.userId as UserId,       // ✅ ارور ۳: string → UserId
      tenantId,
      action: "BOARD_CREATED",
      entityId: board.id,
      entityType: "BOARD",
      correlationId: input.correlationId ?? deps.generateCorrelationId(),
      beforeState: {},                       // ✅ ارور ۴: null → {} (JsonObject)
      afterState: boardPayload,              // ✅ ارور ۵: Board → JsonObject
    });

    // ----------------------------------------------------------------
    // 6. Save idempotency
    // ----------------------------------------------------------------
    await idempotencyRepo.save(tx, {
      mutationId: input.mutationId as MutationId,  // ✅ ارور ۱+۶: string → MutationId
      response: board,
      schemaVersion: "v2",
      createdAt: now,
    });

    return board;
  });
}

// ============================================================================
// Helpers
// ============================================================================

// Board → JsonObject
// Date fields به ISO string تبدیل می‌شوند چون JsonValue شامل Date نیست
function boardToJsonObject(board: Board): JsonObject {
  return {
    id: board.id,
    tenantId: board.tenantId,
    title: board.title,
    revision: board.revision,
    aclVersion: board.aclVersion,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    deletedAt: board.deletedAt ? board.deletedAt.toISOString() : null,
    archivedAt: board.archivedAt ? board.archivedAt.toISOString() : null,
  };
}

function normalizeBoardTitle(raw: string): string {
  if (typeof raw !== "string") {
    throw new DomainError({
      code: "VALIDATION_ERROR",
      message: "Board title must be a string",
      retryable: false,
    });
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized.length < BOARD_TITLE_MIN_LENGTH) {
    throw new DomainError({
      code: "VALIDATION_ERROR",
      message: "Board title is required",
      retryable: false,
    });
  }
  if (normalized.length > BOARD_TITLE_MAX_LENGTH) {
    throw new DomainError({
      code: "VALIDATION_ERROR",
      message: `Board title exceeds maximum length of ${BOARD_TITLE_MAX_LENGTH}`,
      retryable: false,
    });
  }
  return normalized;
}

function normalizeTenantId(raw: TenantId): TenantId {
  if (typeof raw !== "string") {
    throw new DomainError({
      code: "TENANT_ISOLATION_ERROR",
      message: "Tenant id must be a string",
      retryable: false,
    });
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    throw new DomainError({
      code: "TENANT_ISOLATION_ERROR",
      message: "Tenant id is required",
      retryable: false,
    });
  }
  return normalized as TenantId;
}

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { readonly code?: unknown };
  return candidate.code === POSTGRES_UNIQUE_VIOLATION_CODE;
}