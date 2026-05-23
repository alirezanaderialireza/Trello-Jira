// packages/domain/src/card/use-cases/delete-card.ts

// ✅ ارور ۱: حذف TransactionContext — generic TTx
// ✅ ارور ۲: حذف "../../errors" — وجود ندارد

import type { CardId, BoardId } from "../../shared/ids";

import type {
  CardRepository,
  OutboxRepository,
  SequenceRepository,
  TransactionManager,
} from "../../ports";

// ============================================================================
// Deps & Command
// ============================================================================

export interface DeleteCardDeps {
  generateEventId: () => string;
  now: () => Date;
}

export interface DeleteCardCommand {
  cardId: string;
  tenantId: string;
  userId: string;
  correlationId?: string;
}

export type DeleteCardResult =
  | { success: false; reason: string }
  | { success: true; cardId: string };

// ============================================================================
// Use Case
// ============================================================================

export async function deleteCardUseCase<TTx>(
  command: DeleteCardCommand,
  txManager: TransactionManager<TTx>,
  cardRepo: CardRepository<TTx>,
  outboxRepo: OutboxRepository<TTx>,
  sequenceRepo: SequenceRepository<TTx>,
  deps: DeleteCardDeps,
): Promise<DeleteCardResult> {
  const cardId = command.cardId as CardId;

  return txManager.serializable(async (tx) => {
    // ----------------------------------------------------------------
    // 1. Load & lock card
    // ----------------------------------------------------------------
    // ✅ ارور ۳: signature صحیح — findById(id: CardId, options?) نه object
    const card = await cardRepo.findById(cardId, {
      tx,
      forUpdate: true,
      tenantId: command.tenantId,
    });

    if (!card || card.deletedAt) {
      return { success: false, reason: "NOT_FOUND" };
    }

    if (card.tenantId !== command.tenantId) {
      return { success: false, reason: "UNAUTHORIZED" };
    }

    // ----------------------------------------------------------------
    // 2. Soft delete
    // ----------------------------------------------------------------
    const deletedAt = deps.now();
    const updatedCard = { ...card, deletedAt };

    const saveSuccess = await cardRepo.save(tx, {
      entity: updatedCard,
      expectedRevision: card.revision,
    });

    if (!saveSuccess) {
      return { success: false, reason: "STALE_REVISION" };
    }

    // ----------------------------------------------------------------
    // 3. Board sequence (monotonic per board) — required for the realtime
    //    consumer ordering contract. Bug #2 fix: previously the outbox
    //    event was stamped with `card.revision`, which is per-card and
    //    therefore collides with other events for the same board (and
    //    even with the card's own previous events). Subscribers ordered
    //    by `sequence` would either skip events or replay them out of
    //    order. We now ask the SequenceRepository for the next monotonic
    //    `boardSequence`, matching update-card / move-card / create-card.
    // ----------------------------------------------------------------
    const boardSequence = await sequenceRepo.nextBoardSequence(
      tx,
      card.boardId as BoardId,
    );

    // ----------------------------------------------------------------
    // 4. Outbox event
    // ----------------------------------------------------------------
    // ✅ ارور ۴: append(tx, event) مستقیم — نه { tx, event: {...} }
    await outboxRepo.append(tx, {
      eventId: deps.generateEventId(),
      eventVersion: "v1",
      aggregateId: card.boardId,
      aggregateType: "BOARD",
      type: "CARD_DELETED",
      sequence: boardSequence,
      occurredAt: deletedAt,
      correlationId: command.correlationId,
      payload: {
        cardId: card.id,
        boardId: card.boardId,
        listId: card.listId,
        actorUserId: command.userId,
      },
    });

    return { success: true, cardId: card.id };
  });
}
