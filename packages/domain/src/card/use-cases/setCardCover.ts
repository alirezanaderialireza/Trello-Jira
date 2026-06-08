// packages/domain/src/card/use-cases/setCardCover.ts
//
// Phase 1.2 (F1.2.7) — pure use case: set or clear the cover on a card.
// Mirrors setCardDueDate exactly: same no-op detection, same output union.

import type { BoardId, CardId, TenantId, UserId } from "../../shared/ids";
import type { CardCoverUpdatedEvent, CoverData } from "../../events/card.events";

export interface SetCardCoverInput {
  readonly card: {
    readonly id:        CardId;
    readonly boardId:   BoardId;
    readonly tenantId:  TenantId;
    readonly coverData: CoverData | null;
  };
  readonly newCover:   CoverData | null;
  readonly actorId:    UserId;
  readonly now:        Date;
  readonly eventId:    string;
  readonly correlationId?: string;
}

export type SetCardCoverOutput =
  | { readonly noOp: true }
  | {
      readonly noOp:  false;
      readonly patch: { readonly coverData: CoverData | null };
      readonly event: CardCoverUpdatedEvent;
    };

function coverEqual(a: CoverData | null, b: CoverData | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.type === b.type && a.id === b.id;
}

function validateCover(cover: CoverData): void {
  if (cover.type !== "color" && cover.type !== "gradient") {
    throw new Error(`INVALID_COVER_TYPE: ${cover.type}`);
  }
  if (!cover.id || cover.id.trim().length === 0) {
    throw new Error("INVALID_COVER_ID: id must be non-empty");
  }
}

export function setCardCover(input: SetCardCoverInput): SetCardCoverOutput {
  const { card, newCover, actorId, now, eventId, correlationId } = input;

  if (newCover !== null) validateCover(newCover);

  if (coverEqual(card.coverData, newCover)) {
    return { noOp: true };
  }

  const event: CardCoverUpdatedEvent = {
    id:            eventId,
    type:          "card.cover_updated",
    version:       1,
    schemaVersion: 2,
    occurredAt:    now.toISOString(),
    aggregateId:   card.id,
    aggregateType: "card",
    actorId,
    tenantId:      card.tenantId,
    correlationId,
    payload: {
      cardId:    card.id,
      boardId:   card.boardId,
      oldCover:  card.coverData,
      newCover,
      updatedBy: actorId,
    },
  };

  return { noOp: false, patch: { coverData: newCover }, event };
}
