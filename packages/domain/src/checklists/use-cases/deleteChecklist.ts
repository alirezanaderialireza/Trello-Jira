// packages/domain/src/checklists/use-cases/deleteChecklist.ts
//
// Pure use case: produces the ChecklistDeletedEvent given the checklist
// being removed and the count of items that will be hard-deleted
// alongside it.
//
// Authorisation (creator OR board admin per D13) is enforced by the
// router before this is called.

import type { UserId } from "../../shared/ids";
import type { ChecklistEntity } from "../types";
import type { ChecklistDeletedEvent } from "../../events/checklist.events";

export interface DeleteChecklistInput {
  readonly current:           ChecklistEntity;
  readonly affectedItemCount: number;
  readonly actorId:           UserId;
  readonly now:               Date;
  readonly eventId:           string;
  readonly correlationId?:    string;
}

export interface DeleteChecklistOutput {
  readonly event: ChecklistDeletedEvent;
}

export function deleteChecklist(
  input: DeleteChecklistInput,
): DeleteChecklistOutput {
  const event: ChecklistDeletedEvent = {
    id:            input.eventId,
    type:          "checklist.deleted",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.current.cardId,
    aggregateType: "card",
    actorId:       input.actorId,
    tenantId:      input.current.tenantId,
    correlationId: input.correlationId,
    payload: {
      checklistId:       input.current.id,
      cardId:            input.current.cardId,
      boardId:           input.current.boardId,
      affectedItemCount: input.affectedItemCount,
    },
  };

  return { event };
}
