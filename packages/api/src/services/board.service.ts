// packages/api/src/services/board.service.ts
 
import crypto from "node:crypto";
 
import type {
  CardRepository,
  ListRepository,
  OutboxRepository,
  IdempotencyRepository,
  AuditRepository,
  SequenceRepository,
  AggregateLockManager,
  TransactionManager,
  Logger,
  MoveCardCommand,
  MoveCardResult,
  MoveCardSuccessResult,
  DomainFailure,
  DomainErrorReason,
  ErrorCode,
  BoardId,
  ListId,
  CardId,
  TenantId,
  UserId,
  MutationId,
  CorrelationId,
  Revision,
  Sequence,
} from "@repo/domain";
 
import {
  getNewPosition,
  comparePositions,
} from "@repo/domain";
 
import { moveCardDomainService } from "@repo/domain";
 
// ============================================================================
// TTx generic: BoardService نباید نوع دقیق DbTx را بداند.
// TTx از طریق constructor inject می‌شود — boundary سالم است.
// ============================================================================
 
// ============================================================================
// 🏭 DomainFailure Factory
// ----------------------------------------------------------------------------
// واقعی‌ترین شکل DomainFailure را می‌سازد:
// { success: false; code: ErrorCode; message: string; retryable: boolean; correlationId: string; }
// ============================================================================
 
const RETRYABLE_CODES = new Set<DomainErrorReason>([
  "STALE_REVISION",
  "DEADLOCK_DETECTED",
  "OUTBOX_LAGGING",
]);
 
function makeDomainFailure(
  code: DomainErrorReason,
  correlationId: string,
  message?: string,
  metadata?: Readonly<Record<string, unknown>>,
): DomainFailure {
  return {
    success: false,
    code: code as ErrorCode,
    message: message ?? code,
    retryable: RETRYABLE_CODES.has(code),
    correlationId,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
 
// ============================================================================
// 🏭 MoveCardSuccessResult Factory
// ============================================================================
 
function makeMoveCardSuccess(
  boardSequence: Sequence,
  updatedListRevisions: Readonly<Partial<Record<ListId, Revision>>>,
  replayed?: boolean,
): MoveCardSuccessResult {
  return {
    success: true,
    boardSequence,
    updatedListRevisions,
    ...(replayed !== undefined ? { replayed } : {}),
  };
}
 
// ============================================================================
// 🏗️ BoardService
// ============================================================================
 
export class BoardService<TTx = unknown> {
  private readonly COMMAND_TTL_MS = 5 * 60 * 1000;
  private readonly CLOCK_SKEW_MS = 30_000;
  private readonly CURRENT_SCHEMA_VERSION = "v2";
  private readonly LEXORANK_REBALANCE_THRESHOLD = 255;
 
  constructor(
    private readonly txManager: TransactionManager<TTx>,
    private readonly cardRepo: CardRepository<TTx>,
    private readonly listRepo: ListRepository<TTx>,
    private readonly outboxRepo: OutboxRepository<TTx>,
    private readonly idempotencyRepo: IdempotencyRepository<TTx>,
    private readonly auditRepo: AuditRepository<TTx>,
    private readonly sequenceRepo: SequenceRepository<TTx>,
    private readonly lockManager: AggregateLockManager<TTx>,
    private readonly logger: Logger,
  ) {}
 
  // ==========================================================================
  // 🔄 MOVE CARD
  // ==========================================================================
 
  async moveCard(command: MoveCardCommand): Promise<MoveCardResult> {
    const correlationId = command.correlationId as string;
 
    // ------------------------------------------------------------------
    // 1. Command TTL check (outside transaction — cheap guard)
    // ------------------------------------------------------------------
    const now = Date.now();
    const issuedAt = command.issuedAt.getTime();
    if (now - issuedAt > this.COMMAND_TTL_MS + this.CLOCK_SKEW_MS) {
      this.logger.warn({
        event: "move_card_command_expired",
        correlationId,
        mutationId: command.mutationId,
        issuedAt: command.issuedAt.toISOString(),
      });
      return makeDomainFailure("COMMAND_EXPIRED", correlationId);
    }
 
    // ------------------------------------------------------------------
    // 2. Run inside SERIALIZABLE transaction
    // ------------------------------------------------------------------
    return this.txManager.serializable(async (tx) => {
      // ----------------------------------------------------------------
      // 3. Idempotency check — FIRST thing inside transaction
      // ----------------------------------------------------------------
      const existing = await this.idempotencyRepo.findByMutationId<MoveCardSuccessResult>(
        tx,
        command.mutationId,
      );
      if (existing) {
        this.logger.info({
          event: "move_card_idempotent_replay",
          correlationId,
          mutationId: command.mutationId,
        });
        return { ...existing.response, replayed: true };
      }
 
      // ----------------------------------------------------------------
      // 4. Load card with FOR UPDATE lock
      // ----------------------------------------------------------------
      const card = await this.cardRepo.findById(command.cardId, {
        tx,
        forUpdate: true,
        tenantId: command.tenantId,
      });
      if (!card) {
        return makeDomainFailure("NOT_FOUND", correlationId, "Card not found", {
          cardId: command.cardId,
        });
      }
 
      // ----------------------------------------------------------------
      // 5. Tenant isolation guard
      // ----------------------------------------------------------------
      if (card.tenantId !== command.tenantId) {
        this.logger.error({
          event: "move_card_tenant_mismatch",
          correlationId,
          cardTenantId: card.tenantId,
          commandTenantId: command.tenantId,
          classification: "SENSITIVE",
        });
        return makeDomainFailure("FORBIDDEN", correlationId);
      }
 
      // ----------------------------------------------------------------
      // 6. Load target list with FOR UPDATE lock
      // ----------------------------------------------------------------
      const targetList = await this.listRepo.findById(command.targetListId, {
        tx,
        forUpdate: true,
        tenantId: command.tenantId,
      });
      if (!targetList) {
        return makeDomainFailure("NOT_FOUND", correlationId, "Target list not found", {
          listId: command.targetListId,
        });
      }
 
      // ----------------------------------------------------------------
      // 7. ACL check
      // ----------------------------------------------------------------
      const acl = await this.listRepo.getBoardAclForUpdate(
        tx,
        targetList.boardId as BoardId,
      );
      if (
        command.expectedAclVersion !== undefined &&
        acl.version !== command.expectedAclVersion
      ) {
        return makeDomainFailure("ACL_MISMATCH", correlationId, undefined, {
          expectedAclVersion: command.expectedAclVersion,
          actualAclVersion: acl.version,
        });
      }
      if (!acl.canMoveCards(command.userId)) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }
 
      // ----------------------------------------------------------------
      // 8. OCC: list revision check
      // ----------------------------------------------------------------
      if (command.expectedListRevisions) {
        for (const [listId, expectedRev] of Object.entries(
          command.expectedListRevisions,
        ) as [ListId, Revision][]) {
          const list = await this.listRepo.findById(listId, { tx, tenantId: command.tenantId });
          if (!list) {
            return makeDomainFailure("NOT_FOUND", correlationId, `List ${listId} not found`);
          }
          if (list.revision !== expectedRev) {
            return makeDomainFailure("STALE_REVISION", correlationId, undefined, {
              listId,
              expectedRevision: expectedRev,
              actualRevision: list.revision,
            });
          }
        }
      }
 
      // ----------------------------------------------------------------
      // 9. Load neighbour cards for position calculation
      // ----------------------------------------------------------------
      const prevCard = command.prevId
        ? await this.cardRepo.findById(command.prevId, { tx, tenantId: command.tenantId })
        : null;
      const nextCard = command.nextId
        ? await this.cardRepo.findById(command.nextId, { tx, tenantId: command.tenantId })
        : null;
 
      // ----------------------------------------------------------------
      // 10. Pure domain service — deterministic, side-effect free
      // ----------------------------------------------------------------
      const domainResult = moveCardDomainService({
        card,
        targetList,
        prevCard,
        nextCard,
        mode: command.mode,
      });
 
      if (!domainResult.success) {
        return makeDomainFailure(domainResult.reason, correlationId);
      }
 
      const updatedCard = domainResult.card;
 
      // ----------------------------------------------------------------
      // 11. Persist: OCC-safe save
      // ----------------------------------------------------------------
      const saved = await this.cardRepo.save(tx, {
        entity: updatedCard,
        expectedRevision: card.revision,
      });
 
      if (!saved) {
        return makeDomainFailure("STALE_REVISION", correlationId, "Card save OCC conflict");
      }
 
      // ----------------------------------------------------------------
      // 12. Bump list revisions
      // ----------------------------------------------------------------
      const updatedListRevisions: Partial<Record<ListId, Revision>> = {};
 
      const newSourceRev = await this.listRepo.incrementRevision(
        tx,
        card.listId as ListId,
      );
      updatedListRevisions[card.listId as ListId] = newSourceRev as Revision;
 
      if (command.targetListId !== card.listId) {
        const newTargetRev = await this.listRepo.incrementRevision(
          tx,
          command.targetListId,
        );
        updatedListRevisions[command.targetListId] = newTargetRev as Revision;
      }
 
      // ----------------------------------------------------------------
      // 13. Board sequence (monotonic, for realtime sync)
      // ----------------------------------------------------------------
      const boardSequence = await this.sequenceRepo.nextBoardSequence(
        tx,
        targetList.boardId as BoardId,
      );
 
      // ----------------------------------------------------------------
      // 14. Outbox event
      // ----------------------------------------------------------------
      await this.outboxRepo.append(tx, {
        eventId: crypto.randomUUID(),
        aggregateId: targetList.boardId,
        aggregateType: "Board",
        type: "card.moved",
        occurredAt: new Date(),
        correlationId,
        eventVersion: this.CURRENT_SCHEMA_VERSION,
        sequence: boardSequence,
        payload: {
          cardId: command.cardId,
          fromListId: card.listId,
          toListId: command.targetListId,
          newPosition: updatedCard.position,
          updatedListRevisions: updatedListRevisions as Record<string, number>,
          boardSequence,
          userId: command.userId,
          tenantId: command.tenantId,
        },
      });
 
      // ----------------------------------------------------------------
      // 15. Audit log
      // ----------------------------------------------------------------
      await this.auditRepo.append(tx, {
        actorId: command.userId as UserId,
        tenantId: command.tenantId as TenantId,
        action: "card.moved",
        entityId: command.cardId,
        entityType: "Card",
        correlationId,
        beforeState: {
          listId: card.listId,
          position: card.position,
          revision: card.revision,
        },
        afterState: {
          listId: updatedCard.listId,
          position: updatedCard.position,
          revision: updatedCard.revision,
        },
      });
 
      // ----------------------------------------------------------------
      // 16. Save idempotency record
      // ----------------------------------------------------------------
      const successResult = makeMoveCardSuccess(
        boardSequence as Sequence,
        updatedListRevisions as Readonly<Partial<Record<ListId, Revision>>>,
      );
 
      await this.idempotencyRepo.save(tx, {
        mutationId: command.mutationId as MutationId,
        response: successResult,
        schemaVersion: this.CURRENT_SCHEMA_VERSION,
        createdAt: new Date(),
      });
 
      this.logger.info({
        event: "move_card_success",
        correlationId,
        mutationId: command.mutationId,
        cardId: command.cardId,
        fromListId: card.listId,
        toListId: command.targetListId,
        boardSequence,
      });
 
      return successResult;
    });
  }
 
  // ==========================================================================
  // 🔄 MOVE LIST
  // ==========================================================================
 
  async moveList(command: {
    boardId: string;
    listId: string;
    newPosition: string;
    userId: string;
    tenantId: string;
    correlationId: string;
    mutationId: string;
  }): Promise<MoveCardResult> {
    const correlationId = command.correlationId;
 
    return this.txManager.serializable(async (tx) => {
      // Idempotency
      const existing = await this.idempotencyRepo.findByMutationId(
        tx,
        command.mutationId as MutationId,
      );
      if (existing) {
        return { ...(existing.response as MoveCardSuccessResult), replayed: true };
      }
 
      const list = await this.listRepo.findById(command.listId as ListId, {
        tx,
        forUpdate: true,
        tenantId: command.tenantId,
      });
      if (!list) {
        return makeDomainFailure("NOT_FOUND", correlationId, "List not found");
      }
      if (list.tenantId !== command.tenantId) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }
      if (list.boardId !== command.boardId) {
        return makeDomainFailure("TOPOLOGY_MISMATCH", correlationId);
      }
 
      const beforePosition = list.position;
 
      // ✅ Fix H-05: moveList — pass expectedRevision for OCC safety
      //    Old code set entity without bumping revision, creating silent stale writes.
      //    save() with expectedRevision enforces OCC at DB level (UPDATE ... WHERE revision = N).
      const saved = await this.listRepo.save(tx, {
        entity: { ...list, position: command.newPosition },
        expectedRevision: list.revision,  // ✅ OCC guard
      });
      if (!saved) {
        return makeDomainFailure("STALE_REVISION", correlationId);
      }
 
      const boardSequence = await this.sequenceRepo.nextBoardSequence(
        tx,
        command.boardId as BoardId,
      );
 
      await this.outboxRepo.append(tx, {
        eventId: crypto.randomUUID(),
        aggregateId: command.boardId,
        aggregateType: "Board",
        type: "list.moved",
        occurredAt: new Date(),
        correlationId,
        eventVersion: this.CURRENT_SCHEMA_VERSION,
        sequence: boardSequence,
        payload: {
          listId: command.listId,
          boardId: command.boardId,
          newPosition: command.newPosition,
          boardSequence,
          userId: command.userId,
          tenantId: command.tenantId,
        },
      });
 
      await this.auditRepo.append(tx, {
        actorId: command.userId as UserId,
        tenantId: command.tenantId as TenantId,
        action: "list.moved",
        entityId: command.listId,
        entityType: "List",
        correlationId,
        beforeState: { position: beforePosition },
        afterState: { position: command.newPosition },
      });
 
      const result = makeMoveCardSuccess(
        boardSequence as Sequence,
        {},
      );
 
      await this.idempotencyRepo.save(tx, {
        mutationId: command.mutationId as MutationId,
        response: result,
        schemaVersion: this.CURRENT_SCHEMA_VERSION,
        createdAt: new Date(),
      });
 
      return result;
    });
  }
 
  // ==========================================================================
  // ➕ CREATE CARD
  // ==========================================================================
 
  async createCard(command: {
    listId: string;
    title: string;
    description?: string;
    userId: string;
    tenantId: string;
    mutationId: string;
    correlationId?: string;
  }): Promise<{ success: true; cardId: string } | DomainFailure> {
    const correlationId = command.correlationId ?? crypto.randomUUID();
 
    return this.txManager.serializable(async (tx) => {
      // Idempotency
      const existing = await this.idempotencyRepo.findByMutationId(
        tx,
        command.mutationId as MutationId,
      );
      if (existing) {
        return existing.response as { success: true; cardId: string };
      }
 
      const list = await this.listRepo.findById(command.listId as ListId, {
        tx,
        forUpdate: true,
        tenantId: command.tenantId,
      });
      if (!list) {
        return makeDomainFailure("NOT_FOUND", correlationId, "List not found");
      }
      if (list.tenantId !== command.tenantId) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }

      // ✅ Fix H-03: ACL check for createCard (was missing entirely)
      const acl = await this.listRepo.getBoardAclForUpdate(
        tx,
        list.boardId as BoardId,
      );
      if (!acl.canMoveCards(command.userId as UserId)) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }
 
      // Position: append after last card
      const lastCard = await this.cardRepo.getLastCardInList({
        listId: command.listId as ListId,
        tenantId: command.tenantId as TenantId,
        tx,
      });
      const position = getNewPosition(lastCard?.position, undefined);
 
      const cardId = crypto.randomUUID();
      const now = new Date();
 
      await this.cardRepo.create(
        {
          id: cardId,
          tenantId: command.tenantId,
          boardId: list.boardId,
          listId: command.listId,
          title: command.title,
          description: command.description ?? null,
          position,
          revision: 0,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        tx,
      );
 
      const boardSequence = await this.sequenceRepo.nextBoardSequence(
        tx,
        list.boardId as BoardId,
      );
 
      await this.outboxRepo.append(tx, {
        eventId: crypto.randomUUID(),
        aggregateId: list.boardId,
        aggregateType: "Board",
        type: "card.created",
        occurredAt: now,
        correlationId,
        eventVersion: this.CURRENT_SCHEMA_VERSION,
        sequence: boardSequence,
        payload: {
          cardId,
          listId: command.listId,
          boardId: list.boardId,
          title: command.title,
          position,
          boardSequence,
          userId: command.userId,
          tenantId: command.tenantId,
        },
      });
 
      await this.auditRepo.append(tx, {
        actorId: command.userId as UserId,
        tenantId: command.tenantId as TenantId,
        action: "card.created",
        entityId: cardId,
        entityType: "Card",
        correlationId,
        beforeState: {},
        afterState: { cardId, listId: command.listId, title: command.title, position },
      });
 
      const result = { success: true as const, cardId };
 
      await this.idempotencyRepo.save(tx, {
        mutationId: command.mutationId as MutationId,
        response: result,
        schemaVersion: this.CURRENT_SCHEMA_VERSION,
        createdAt: now,
      });
 
      this.logger.info({
        event: "create_card_success",
        correlationId,
        mutationId: command.mutationId,
        cardId,
        listId: command.listId,
      });
 
      return result;
    });
  }
 
  // ==========================================================================
  // 🗑️ DELETE CARD
  // ==========================================================================
 
  async deleteCard(command: {
    cardId: string;
    userId: string;
    tenantId: string;
    mutationId: string;
    correlationId?: string;
  }): Promise<{ success: true } | DomainFailure> {
    const correlationId = command.correlationId ?? crypto.randomUUID();
 
    return this.txManager.serializable(async (tx) => {
      const existing = await this.idempotencyRepo.findByMutationId(
        tx,
        command.mutationId as MutationId,
      );
      if (existing) {
        return existing.response as { success: true };
      }
 
      const card = await this.cardRepo.findById(command.cardId, {
        tx,
        forUpdate: true,
        tenantId: command.tenantId,
      });
      if (!card) {
        return makeDomainFailure("NOT_FOUND", correlationId, "Card not found");
      }
      if (card.tenantId !== command.tenantId) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }

      // ✅ Fix H-01: ACL check for deleteCard (was missing entirely)
      const acl = await this.listRepo.getBoardAclForUpdate(
        tx,
        card.boardId as BoardId,
      );
      if (!acl.canMoveCards(command.userId as UserId)) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }
 
      await this.cardRepo.delete(tx, command.cardId as CardId);
 
      const boardSequence = await this.sequenceRepo.nextBoardSequence(
        tx,
        card.boardId as BoardId,
      );
 
      await this.outboxRepo.append(tx, {
        eventId: crypto.randomUUID(),
        aggregateId: card.boardId,
        aggregateType: "Board",
        type: "card.deleted",
        occurredAt: new Date(),
        correlationId,
        eventVersion: this.CURRENT_SCHEMA_VERSION,
        sequence: boardSequence,
        payload: {
          cardId: command.cardId,
          listId: card.listId,
          boardId: card.boardId,
          boardSequence,
          userId: command.userId,
          tenantId: command.tenantId,
        },
      });
 
      await this.auditRepo.append(tx, {
        actorId: command.userId as UserId,
        tenantId: command.tenantId as TenantId,
        action: "card.deleted",
        entityId: command.cardId,
        entityType: "Card",
        correlationId,
        beforeState: { listId: card.listId, title: card.title, position: card.position },
        afterState: { deletedAt: new Date().toISOString() },
      });
 
      const result = { success: true as const };
 
      await this.idempotencyRepo.save(tx, {
        mutationId: command.mutationId as MutationId,
        response: result,
        schemaVersion: this.CURRENT_SCHEMA_VERSION,
        createdAt: new Date(),
      });
 
      return result;
    });
  }
 
  // ==========================================================================
  // ✏️ UPDATE CARD
  // ==========================================================================
 
  async updateCard(command: {
    cardId: string;
    title?: string;
    description?: string;
    tenantId: string;
    userId: string;
    mutationId: string;
    correlationId?: string;
  }): Promise<{ success: true } | DomainFailure> {
    const correlationId = command.correlationId ?? crypto.randomUUID();
 
    return this.txManager.serializable(async (tx) => {
      const existing = await this.idempotencyRepo.findByMutationId(
        tx,
        command.mutationId as MutationId,
      );
      if (existing) {
        return existing.response as { success: true };
      }
 
      const card = await this.cardRepo.findById(command.cardId, {
        tx,
        forUpdate: true,
        tenantId: command.tenantId,
      });
      if (!card) {
        return makeDomainFailure("NOT_FOUND", correlationId, "Card not found");
      }
      if (card.tenantId !== command.tenantId) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }

      // ✅ Fix H-02: ACL check for updateCard (was missing entirely)
      const acl = await this.listRepo.getBoardAclForUpdate(
        tx,
        card.boardId as BoardId,
      );
      if (!acl.canMoveCards(command.userId as UserId)) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }
 
      const updatedCard = {
        ...card,
        ...(command.title !== undefined ? { title: command.title } : {}),
        ...(command.description !== undefined ? { description: command.description } : {}),
        updatedAt: new Date(),
      };
 
      const saved = await this.cardRepo.save(tx, {
        entity: updatedCard,
        expectedRevision: card.revision,
      });
      if (!saved) {
        return makeDomainFailure("STALE_REVISION", correlationId);
      }
 
      const boardSequence = await this.sequenceRepo.nextBoardSequence(
        tx,
        card.boardId as BoardId,
      );
 
      await this.outboxRepo.append(tx, {
        eventId: crypto.randomUUID(),
        aggregateId: card.boardId,
        aggregateType: "Board",
        type: "card.updated",
        occurredAt: new Date(),
        correlationId,
        eventVersion: this.CURRENT_SCHEMA_VERSION,
        sequence: boardSequence,
        payload: {
          cardId: command.cardId,
          listId: card.listId,
          boardId: card.boardId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.description !== undefined ? { description: command.description } : {}),
          boardSequence,
          userId: command.userId,
          tenantId: command.tenantId,
        },
      });
 
      await this.auditRepo.append(tx, {
        actorId: command.userId as UserId,
        tenantId: command.tenantId as TenantId,
        action: "card.updated",
        entityId: command.cardId,
        entityType: "Card",
        correlationId,
        beforeState: { title: card.title, description: card.description ?? null },
        afterState: {
          title: updatedCard.title,
          description: updatedCard.description ?? null,
        },
      });
 
      const result = { success: true as const };
 
      await this.idempotencyRepo.save(tx, {
        mutationId: command.mutationId as MutationId,
        response: result,
        schemaVersion: this.CURRENT_SCHEMA_VERSION,
        createdAt: new Date(),
      });
 
      return result;
    });
  }
 
  // ==========================================================================
  // ✏️ UPDATE LIST
  // ==========================================================================
 
  async updateList(command: {
    listId: string;
    boardId: string;
    tenantId: string;
    userId: string;
    title?: string;
    description?: string;
    mutationId: string;
    correlationId?: string;
  }): Promise<{ success: true } | DomainFailure> {
    const correlationId = command.correlationId ?? crypto.randomUUID();
 
    return this.txManager.serializable(async (tx) => {
      const existing = await this.idempotencyRepo.findByMutationId(
        tx,
        command.mutationId as MutationId,
      );
      if (existing) {
        return existing.response as { success: true };
      }
 
      const list = await this.listRepo.findById(command.listId as ListId, {
        tx,
        forUpdate: true,
        tenantId: command.tenantId,
      });
      if (!list) {
        return makeDomainFailure("NOT_FOUND", correlationId, "List not found");
      }
      if (list.tenantId !== command.tenantId) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }
      if (list.boardId !== command.boardId) {
        return makeDomainFailure("TOPOLOGY_MISMATCH", correlationId);
      }
 
      const updatedList = {
        ...list,
        ...(command.title !== undefined ? { title: command.title } : {}),
        updatedAt: new Date(),
      };
 
      const saved = await this.listRepo.save(tx, {
        entity: updatedList,
        expectedRevision: list.revision,
      });
      if (!saved) {
        return makeDomainFailure("STALE_REVISION", correlationId);
      }
 
      const boardSequence = await this.sequenceRepo.nextBoardSequence(
        tx,
        command.boardId as BoardId,
      );
 
      await this.outboxRepo.append(tx, {
        eventId: crypto.randomUUID(),
        aggregateId: command.boardId,
        aggregateType: "Board",
        type: "list.updated",
        occurredAt: new Date(),
        correlationId,
        eventVersion: this.CURRENT_SCHEMA_VERSION,
        sequence: boardSequence,
        payload: {
          listId: command.listId,
          boardId: command.boardId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          boardSequence,
          userId: command.userId,
          tenantId: command.tenantId,
        },
      });
 
      await this.auditRepo.append(tx, {
        actorId: command.userId as UserId,
        tenantId: command.tenantId as TenantId,
        action: "list.updated",
        entityId: command.listId,
        entityType: "List",
        correlationId,
        beforeState: { title: list.title },
        afterState: { title: updatedList.title },
      });
 
      const result = { success: true as const };
 
      await this.idempotencyRepo.save(tx, {
        mutationId: command.mutationId as MutationId,
        response: result,
        schemaVersion: this.CURRENT_SCHEMA_VERSION,
        createdAt: new Date(),
      });
 
      return result;
    });
  }
 
  // ==========================================================================
  // 🗑️ DELETE LIST
  // ==========================================================================
 
  async deleteList(command: {
    listId: string;
    boardId: string;
    tenantId: string;
    userId: string;
    mutationId: string;
    correlationId?: string;
  }): Promise<{ success: true } | DomainFailure> {
    const correlationId = command.correlationId ?? crypto.randomUUID();
 
    return this.txManager.serializable(async (tx) => {
      const existing = await this.idempotencyRepo.findByMutationId(
        tx,
        command.mutationId as MutationId,
      );
      if (existing) {
        return existing.response as { success: true };
      }
 
      const list = await this.listRepo.findById(command.listId as ListId, {
        tx,
        forUpdate: true,
        tenantId: command.tenantId,
      });
      if (!list) {
        return makeDomainFailure("NOT_FOUND", correlationId, "List not found");
      }
      if (list.tenantId !== command.tenantId) {
        return makeDomainFailure("FORBIDDEN", correlationId);
      }
      if (list.boardId !== command.boardId) {
        return makeDomainFailure("TOPOLOGY_MISMATCH", correlationId);
      }
 
      // Soft delete via save with deletedAt
      const saved = await this.listRepo.save(tx, {
        entity: { ...list, deletedAt: new Date() },
        expectedRevision: list.revision,
      });
      if (!saved) {
        return makeDomainFailure("STALE_REVISION", correlationId);
      }
 
      const boardSequence = await this.sequenceRepo.nextBoardSequence(
        tx,
        command.boardId as BoardId,
      );
 
      await this.outboxRepo.append(tx, {
        eventId: crypto.randomUUID(),
        aggregateId: command.boardId,
        aggregateType: "Board",
        type: "list.deleted",
        occurredAt: new Date(),
        correlationId,
        eventVersion: this.CURRENT_SCHEMA_VERSION,
        sequence: boardSequence,
        payload: {
          listId: command.listId,
          boardId: command.boardId,
          boardSequence,
          userId: command.userId,
          tenantId: command.tenantId,
        },
      });
 
      await this.auditRepo.append(tx, {
        actorId: command.userId as UserId,
        tenantId: command.tenantId as TenantId,
        action: "list.deleted",
        entityId: command.listId,
        entityType: "List",
        correlationId,
        beforeState: { title: list.title, position: list.position },
        afterState: { deletedAt: new Date().toISOString() },
      });
 
      const result = { success: true as const };
 
      await this.idempotencyRepo.save(tx, {
        mutationId: command.mutationId as MutationId,
        response: result,
        schemaVersion: this.CURRENT_SCHEMA_VERSION,
        createdAt: new Date(),
      });
 
      return result;
    });
  }
}