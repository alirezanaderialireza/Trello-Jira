// packages/domain/src/labels/use-cases/applyLabelToCard.ts
//
// Pure use case: idempotent application of a label to a card. Returns
// `noOp: true` when the link already exists so the router can skip the
// junction insert and the outbox emit (treating the duplicate as a
// quiet success — matches Trello's behaviour and the spec's EC2).

import type { CardId, TenantId, UserId } from "../../shared/ids";
import type {
  CardLabelLink,
  LabelEntity,
  LabelId,
} from "../types";
import type { CardLabelAddedEvent } from "../../events/label.events";

import { LabelBoardMismatchError } from "../errors";

export interface ApplyLabelToCardInput {
  readonly cardId:        CardId;
  readonly card: {
    readonly id:       CardId;
    readonly boardId:  string;
    readonly tenantId: TenantId;
  };
  readonly label:         LabelEntity;
  readonly appliedBy:     UserId;
  readonly now:           Date;
  readonly eventId:       string;
  readonly correlationId?: string;
  /** True when the junction row already exists — caller flags from repo. */
  readonly alreadyApplied: boolean;
}

export interface ApplyLabelToCardOutput {
  readonly noOp: boolean;
  readonly link?: CardLabelLink;
  readonly event?: CardLabelAddedEvent;
}

export function applyLabelToCard(
  input: ApplyLabelToCardInput,
): ApplyLabelToCardOutput {
  // ── Topology guard — label must belong to the same board as the card ────
  // This catches bugs where the router accepts a labelId from a
  // different board (would also be blocked by RLS, but failing in
  // domain layer gives a friendlier error message).
  if (input.label.boardId !== input.card.boardId) {
    throw new LabelBoardMismatchError();
  }

  if (input.alreadyApplied) {
    return { noOp: true };
  }

  const link: CardLabelLink = {
    cardId:    input.cardId,
    labelId:   input.label.id,
    tenantId:  input.label.tenantId,
    appliedBy: input.appliedBy,
    appliedAt: input.now,
  };

  const event: CardLabelAddedEvent = {
    id:            input.eventId,
    type:          "card.label_added",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.cardId,
    aggregateType: "card",
    actorId:       input.appliedBy,
    tenantId:      input.label.tenantId,
    correlationId: input.correlationId,
    payload: {
      cardId:    input.cardId,
      boardId:   input.card.boardId,
      labelId:   input.label.id,
      appliedBy: input.appliedBy,
    },
  };

  return { noOp: false, link, event };
}
