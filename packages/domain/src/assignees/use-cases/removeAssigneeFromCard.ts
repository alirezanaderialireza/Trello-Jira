// packages/domain/src/assignees/use-cases/removeAssigneeFromCard.ts
//
// Pure use case: validates constraints for removing an assignee and
// returns the event. The router performs the delete after calling this.

import type { BoardId, CardId, TenantId, UserId } from "../../shared/ids";
import type { CardAssigneeRemovedEvent } from "../../events/card.events";
import {
  CardLockedAssigneeError,
  NotAssignedError,
} from "../errors";

export interface RemoveAssigneeInput {
  readonly cardId:        CardId;
  readonly boardId:       BoardId;
  readonly tenantId:      TenantId;
  readonly assigneeId:    UserId;
  readonly removedBy:     UserId;
  readonly isCardLocked:  boolean;
  readonly callerRole:    string;
  readonly isAssigned:    boolean;
  readonly now:           Date;
  readonly eventId:       string;
  readonly correlationId?: string;
}

export interface RemoveAssigneeOutput {
  readonly event: CardAssigneeRemovedEvent;
}

export function removeAssigneeFromCard(
  input: RemoveAssigneeInput,
): RemoveAssigneeOutput {
  // D9: locked card check.
  if (input.isCardLocked) {
    const callerIsAdmin =
      input.callerRole === "ADMIN" || input.callerRole === "OWNER";
    if (!callerIsAdmin) {
      throw new CardLockedAssigneeError();
    }
  }

  if (!input.isAssigned) {
    throw new NotAssignedError();
  }

  const event: CardAssigneeRemovedEvent = {
    id:            input.eventId,
    type:          "card.assignee_removed",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.cardId,
    aggregateType: "card",
    actorId:       input.removedBy,
    tenantId:      input.tenantId,
    correlationId: input.correlationId,
    payload: {
      cardId:     input.cardId,
      boardId:    input.boardId,
      assigneeId: input.assigneeId,
      removedBy:  input.removedBy,
    },
  };

  return { event };
}
