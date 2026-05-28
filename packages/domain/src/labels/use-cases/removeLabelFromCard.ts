// packages/domain/src/labels/use-cases/removeLabelFromCard.ts
//
// Pure use case: idempotent removal of a label from a card. Returns
// `noOp: true` when the junction row didn't exist (e.g. realtime echo
// of a remove that already happened) so the caller can skip the
// outbox emit.

import type { CardId, TenantId, UserId } from "../../shared/ids";
import type { LabelId } from "../types";
import type { CardLabelRemovedEvent } from "../../events/label.events";

export interface RemoveLabelFromCardInput {
  readonly cardId:        CardId;
  readonly labelId:       LabelId;
  readonly boardId:       string;
  readonly tenantId:      TenantId;
  readonly actorId:       UserId;
  readonly now:           Date;
  readonly eventId:       string;
  readonly correlationId?: string;
  /** True when no junction row was found — caller flags from repo. */
  readonly notPresent: boolean;
}

export interface RemoveLabelFromCardOutput {
  readonly noOp: boolean;
  readonly event?: CardLabelRemovedEvent;
}

export function removeLabelFromCard(
  input: RemoveLabelFromCardInput,
): RemoveLabelFromCardOutput {
  if (input.notPresent) {
    return { noOp: true };
  }

  const event: CardLabelRemovedEvent = {
    id:            input.eventId,
    type:          "card.label_removed",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.cardId,
    aggregateType: "card",
    actorId:       input.actorId,
    tenantId:      input.tenantId,
    correlationId: input.correlationId,
    payload: {
      cardId:  input.cardId,
      boardId: input.boardId,
      labelId: input.labelId,
    },
  };

  return { noOp: false, event };
}
