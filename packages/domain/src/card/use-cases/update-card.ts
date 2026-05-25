// packages/domain/src/card/use-cases/update-card.ts

// ✅ ارور ۱: حذف node:crypto — deps.generateCorrelationId جایگزین شد
// ✅ ارور ۲: حذف TransactionContext — generic TTx جایگزین شد
// ✅ ارور ۳: حذف "../../errors" — وجود ندارد، pattern به return تبدیل شد

import type { CardId, ListId, BoardId, UserId, TenantId, MutationId } from "../../shared/ids";

import type {
  CardRepository,
  ListRepository,
  OutboxRepository,
  IdempotencyRepository,
  AuditRepository,
  SequenceRepository,
  TransactionManager,
  JsonObject,
} from "../../ports";

import type { DomainErrorReason } from "../../errors/error-codes";

const CARD_TITLE_MAX_LENGTH = 255;

// ============================================================================
// Command & Deps
// ============================================================================

export interface UpdateCardCommand {
  cardId: string;
  title?: string;
  description?: string;
  tenantId: string;
  userId: string;
  mutationId: string;
  correlationId?: string;
}

export interface UpdateCardDeps {
  generateEventId: () => string;
  generateCorrelationId: () => string; // ✅ ارور ۱: جایگزین crypto.randomUUID
  now: () => Date;
}

export type UpdateCardResult =
  | { success: false; reason: DomainErrorReason }
  | { success: true; cardId: string; revision: number };

// ============================================================================
// Use Case
// ============================================================================

export async function updateCardUseCase<TTx>(
  command: UpdateCardCommand,
  txManager: TransactionManager<TTx>,
  listRepo: ListRepository<TTx>,
  cardRepo: CardRepository<TTx>,
  outboxRepo: OutboxRepository<TTx>,
  idempotencyRepo: IdempotencyRepository<TTx>,
  auditRepo: AuditRepository<TTx>,
  sequenceRepo: SequenceRepository<TTx>,
  deps: UpdateCardDeps,
): Promise<UpdateCardResult> {
  // ✅ ارور ۴+۷+۸: branded cast یک‌بار در ابتدا
  const cardId = command.cardId as CardId;
  const listId_placeholder = undefined; // listId از card load می‌شود
  const boardId_placeholder = undefined; // boardId از card load می‌شود
  const userId = command.userId as UserId;
  const tenantId = command.tenantId as TenantId;
  const mutationId = command.mutationId as MutationId;

  return txManager.serializable(async (tx) => {
    // ----------------------------------------------------------------
    // 1. Idempotency check
    // ----------------------------------------------------------------
    // ✅ ارور ۴: string → MutationId
    const replay = await idempotencyRepo.findByMutationId<UpdateCardResult>(tx, mutationId);
    if (replay) return replay.response;

    // ----------------------------------------------------------------
    // 2. Load & lock card
    // ----------------------------------------------------------------
    // ✅ ارور ۵: signature صحیح — findById(id: CardId, options?) نه object
    const card = await cardRepo.findById(cardId, {
      tx,
      forUpdate: true,
      tenantId: command.tenantId,
    });

    if (!card || card.deletedAt) return { success: false, reason: "NOT_FOUND" };
    if (card.tenantId !== command.tenantId) return { success: false, reason: "UNAUTHORIZED" };

    // ----------------------------------------------------------------
    // 3. Normalize & apply updates
    // ----------------------------------------------------------------
    let updated = false;
    let newTitle = card.title;
    // ✅ ارور ۶: Card.description نوع string|null دارد نه string|undefined
    let newDescription: string | null = card.description;

    if (command.title !== undefined) {
      newTitle = normalizeTitle(command.title);
      updated = true;
    }
    if (command.description !== undefined) {
      // ✅ ارور ۶: normalizeDescription حالا string|null برمی‌گرداند
      newDescription = normalizeDescription(command.description);
      updated = true;
    }
    if (!updated) return { success: false, reason: "INVALID_REQUEST_PAYLOAD" };

    const updatedCard = {
      ...card,
      title: newTitle,
      description: newDescription,
      updatedAt: deps.now(),
    };

    // ----------------------------------------------------------------
    // 4. OCC-safe persist
    // ----------------------------------------------------------------
    const saveSuccess = await cardRepo.save(tx, {
      entity: updatedCard,
      expectedRevision: card.revision,
    });
    if (!saveSuccess) return { success: false, reason: "STALE_REVISION" };

    // ----------------------------------------------------------------
    // 5. List revision + board sequence
    // ----------------------------------------------------------------
    // ✅ ارور ۷: card.listId as ListId
    const listRevision = await listRepo.incrementRevision(
      tx,
      card.listId as ListId,
    );
    // ✅ ارور ۸: card.boardId as BoardId
    const boardSequence = await sequenceRepo.nextBoardSequence(
      tx,
      card.boardId as BoardId,
    );

    // ----------------------------------------------------------------
    // 6. Outbox event
    // ----------------------------------------------------------------
    await outboxRepo.append(tx, {
      eventId: deps.generateEventId(),
      eventVersion: "v2",
      aggregateId: card.boardId,
      aggregateType: "BOARD",
      type: "CARD_UPDATED",
      sequence: boardSequence,
      occurredAt: deps.now(),
      correlationId: command.correlationId,
      payload: {
        cardId: card.id,
        boardId: card.boardId,
        listId: card.listId,
        title: updatedCard.title,
        description: updatedCard.description,
        revision: listRevision,
      } satisfies JsonObject,
    });

    // ----------------------------------------------------------------
    // 7. Audit trail
    // ----------------------------------------------------------------
    // ✅ ارور ۹+۱۰: UserId, TenantId branded
    // ✅ ارور ۱۱: beforeState null → JsonObject
    // ✅ ارور ۱۲: afterState Card → JsonObject
    const beforeSnapshot: JsonObject = {
      title: card.title,
      description: card.description,
    };
    const afterSnapshot: JsonObject = {
      title: updatedCard.title,
      description: updatedCard.description,
      cardId: card.id,
    };

    await auditRepo.append(tx, {
      actorId: userId,
      tenantId,
      action: "CARD_UPDATED",
      entityId: card.id,
      entityType: "CARD",
      correlationId: command.correlationId ?? deps.generateCorrelationId(),
      beforeState: beforeSnapshot,
      afterState: afterSnapshot,
    });

    // ----------------------------------------------------------------
    // 8. Save idempotency
    // ----------------------------------------------------------------
    // Bug #1 fix: the response must reflect the NEW revision (post-save).
    // Previously this returned `updatedCard.revision`, but `updatedCard`
    // was constructed by spreading `card` (revision = N) without bumping;
    // the OCC save in step 4 increments the row from N to N+1 in the DB.
    // Returning N caused the next client mutation to send
    // `expectedRevision: N` and trigger a spurious STALE_REVISION even
    // though no real conflict had occurred.
    const response: UpdateCardResult = {
      success: true,
      cardId: card.id,
      revision: updatedCard.revision + 1,
    };

    // ✅ ارور ۱۳: mutationId branded
    await idempotencyRepo.save(tx, {
      mutationId,
      response,
      schemaVersion: "v2",
      createdAt: deps.now(),
    });

    return response;
  });
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeTitle(raw: string): string {
  if (typeof raw !== "string") {
    throw new TypeError("Card title must be a string");
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (!normalized.length) {
    throw new RangeError("Card title is required");
  }
  if (normalized.length > CARD_TITLE_MAX_LENGTH) {
    throw new RangeError(`Card title exceeds max length of ${CARD_TITLE_MAX_LENGTH}`);
  }
  return normalized;
}

// ✅ ارور ۶: string|null نه string|undefined — Card.description نوع null دارد
function normalizeDescription(raw: string): string | null {
  const normalized = raw.trim().replace(/\s+/g, " ");
  return normalized.length === 0 ? null : normalized;
}