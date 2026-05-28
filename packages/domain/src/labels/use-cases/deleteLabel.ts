// packages/domain/src/labels/use-cases/deleteLabel.ts
//
// Pure use case: produces the LabelDeletedEvent given the label being
// removed and the count of card_labels junction rows that will be
// hard-deleted alongside it.
//
// Authorisation (board admin) is enforced by the router before this is
// called.

import type { LabelEntity } from "../types";
import type { UserId } from "../../shared/ids";
import type { LabelDeletedEvent } from "../../events/label.events";

export interface DeleteLabelInput {
  readonly current:           LabelEntity;
  readonly affectedCardCount: number;
  readonly actorId:           UserId;
  readonly now:               Date;
  readonly eventId:           string;
  readonly correlationId?:    string;
}

export interface DeleteLabelOutput {
  readonly event: LabelDeletedEvent;
}

export function deleteLabel(input: DeleteLabelInput): DeleteLabelOutput {
  const event: LabelDeletedEvent = {
    id:            input.eventId,
    type:          "label.deleted",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.current.boardId,
    aggregateType: "board",
    actorId:       input.actorId,
    tenantId:      input.current.tenantId,
    correlationId: input.correlationId,
    payload: {
      labelId:           input.current.id,
      boardId:           input.current.boardId,
      affectedCardCount: input.affectedCardCount,
    },
  };

  return { event };
}
