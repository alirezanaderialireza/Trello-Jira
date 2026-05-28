// packages/domain/src/card/use-cases/create-card.ts

// ✅ ارور ۱: حذف TransactionContext — generic TTx جایگزین شد
// ✅ ارور ۲: حذف "../../errors" — وجود ندارد، pattern به return/throw TypeError شد

import type { ListId, CardId, BoardId, TenantId } from "../../shared/ids";

import type {
  CardRepository,
  ListRepository,
  OutboxRepository,
  TransactionManager,
} from "../../ports";

import { getNewPosition } from "../../ordering";

const CARD_TITLE_MAX_LENGTH = 255;

// ============================================================================
// Command & Deps
// ============================================================================

export interface CreateCardDeps {
  generateCardId: () => string;
  generateEventId: () => string;
  now: () => Date;
}

export interface CreateCardCommand {
  listId: string;
  title: string;
  description?: string;
  tenantId: string;
  userId: string;
  correlationId?: string;
}

export type CreateCardResult =
  | { success: false; reason: string }
  | { success: true; cardId: string; position: string; boardId: string };

// ============================================================================
// Use Case
// ============================================================================

export async function createCardUseCase<TTx>(
  command: CreateCardCommand,
  txManager: TransactionManager<TTx>,
  listRepo: ListRepository<TTx>,
  cardRepo: CardRepository<TTx>,
  outboxRepo: OutboxRepository<TTx>,
  deps: CreateCardDeps,
): Promise<CreateCardResult> {
  // ✅ branded cast یک‌بار در ابتدا
  const listId = command.listId as ListId;
  const tenantId = command.tenantId as TenantId;

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

    if (list.tenantId !== command.tenantId) {
      return { success: false, reason: "UNAUTHORIZED" };
    }

    // ----------------------------------------------------------------
    // 2. Compute new position
    // ----------------------------------------------------------------
    // ✅ ارور ۴: findLastByListId وجود ندارد — صحیح: getLastCardInList(params)
    const lastCard = await cardRepo.getLastCardInList({
      listId: list.id as ListId,
      tenantId,
      tx,
    });
    const position = getNewPosition(lastCard?.position, undefined);

    // ----------------------------------------------------------------
    // 3. Normalize
    // ----------------------------------------------------------------
    const title = normalizeTitle(command.title);
    // ✅ ارور ۶: Card.description نوع string|null دارد نه string|undefined
    const description = normalizeDescription(command.description);

    const now = deps.now();

    // ----------------------------------------------------------------
    // 4. Build card entity — باید کاملاً با Card interface match کند
    // ----------------------------------------------------------------
    // ✅ ارور ۵: Card interface شامل revision, updatedAt, deletedAt است
    const card = {
      id: deps.generateCardId() as CardId,
      tenantId: command.tenantId,
      boardId: list.boardId,
      listId: list.id,
      title,
      description,
      position,
      revision: 0,
      dueDate: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    // ----------------------------------------------------------------
    // 5. Persist card
    // ----------------------------------------------------------------
    // ✅ ارور ۵+۶: create(card, tx) → void — نه { affectedRows }
    await cardRepo.create(card, tx);

    // ----------------------------------------------------------------
    // 6. Increment list revision
    // ----------------------------------------------------------------
    // ✅ ارور ۷: incrementRevision(tx, listId) — نه object
    const listRevision = await listRepo.incrementRevision(tx, list.id as ListId);

    // ----------------------------------------------------------------
    // 7. Outbox event
    // ----------------------------------------------------------------
    // ✅ ارور ۸: append(tx, event) مستقیم — نه { tx, event: {...} }
    await outboxRepo.append(tx, {
      eventId: deps.generateEventId(),
      eventVersion: "v1",
      aggregateId: list.boardId,
      aggregateType: "BOARD",
      type: "CARD_CREATED",
      sequence: listRevision,
      occurredAt: now,
      correlationId: command.correlationId,
      payload: {
        cardId: card.id,
        boardId: card.boardId,
        listId: card.listId,
        position: card.position,
        title: card.title,
        revision: listRevision,
        actorUserId: command.userId,
      },
    });

    return {
      success: true,
      cardId: card.id,
      position: card.position,
      boardId: card.boardId,
    };
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
function normalizeDescription(raw?: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new TypeError("Card description must be a string");
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  return normalized.length === 0 ? null : normalized;
}