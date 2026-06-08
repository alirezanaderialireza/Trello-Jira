// packages/domain/src/assignees/use-cases/addAssigneeToCard.ts
//
// Pure use case: validates all constraints for adding an assignee to a
// card and returns the entity + event. All I/O results are injected.

import type { BoardId, CardId, TenantId, UserId } from "../../shared/ids";
import type { CardAssigneeEntity } from "../types";
import type { CardAssigneeAddedEvent } from "../../events/card.events";
import {
  AlreadyAssignedError,
  AssigneeNotBoardMemberError,
  CardLockedAssigneeError,
  MaxAssigneesError,
} from "../errors";

export const MAX_ASSIGNEES_PER_CARD = 50; // D4

export interface AddAssigneeInput {
  readonly cardId:         CardId;
  readonly boardId:        BoardId;
  readonly tenantId:       TenantId;
  readonly assigneeId:     UserId;
  readonly assignedBy:     UserId;
  readonly isCardLocked:   boolean;
  readonly callerRole:     string;           // "OWNER" | "ADMIN" | "MEMBER"
  readonly isAlreadyAssigned: boolean;
  readonly isBoardMember:  boolean;
  readonly currentCount:   number;
  readonly now:            Date;
  readonly eventId:        string;
  readonly correlationId?: string;
}

export interface AddAssigneeOutput {
  readonly entity: CardAssigneeEntity;
  readonly event:  CardAssigneeAddedEvent;
}

export function addAssigneeToCard(input: AddAssigneeInput): AddAssigneeOutput {
  // ── Guards ────────────────────────────────────────────────────────────────

  // D5: assignee must be an active board member.
  if (!input.isBoardMember) {
    throw new AssigneeNotBoardMemberError();
  }

  // D9: locked card — only ADMIN/OWNER may change assignees.
  if (input.isCardLocked) {
    const callerIsAdmin =
      input.callerRole === "ADMIN" || input.callerRole === "OWNER";
    if (!callerIsAdmin) {
      throw new CardLockedAssigneeError();
    }
  }

  // Idempotent guard — surface as CONFLICT so the router can cache.
  if (input.isAlreadyAssigned) {
    throw new AlreadyAssignedError();
  }

  // D4: sanity cap.
  if (input.currentCount >= MAX_ASSIGNEES_PER_CARD) {
    throw new MaxAssigneesError(MAX_ASSIGNEES_PER_CARD);
  }

  // ── Build entity ──────────────────────────────────────────────────────────
  const entity: CardAssigneeEntity = {
    cardId:     input.cardId,
    userId:     input.assigneeId,
    tenantId:   input.tenantId,
    assignedBy: input.assignedBy,
    assignedAt: input.now,
  };

  // ── Build event (v2) ─────────────────────────────────────────────────────
  const event: CardAssigneeAddedEvent = {
    id:            input.eventId,
    type:          "card.assignee_added",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.cardId,
    aggregateType: "card",
    actorId:       input.assignedBy,
    tenantId:      input.tenantId,
    correlationId: input.correlationId,
    payload: {
      cardId:      input.cardId,
      boardId:     input.boardId,
      assigneeId:  input.assigneeId,
      assignedBy:  input.assignedBy,
    },
  };

  return { entity, event };
}
