// packages/domain/src/checklists/use-cases/addChecklistItem.ts
//
// Pure use case: validates add-item inputs and returns the entity to
// insert plus the ChecklistItemAddedEvent. The caller resolves the
// LexoRank position and feeds it in (mirrors createLabel's pattern).

import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
} from "../../shared/ids";
import type { Position } from "../../ordering/position";
import type {
  ChecklistEntity,
  ChecklistItemEntity,
  ChecklistItemId,
} from "../types";
import type { ChecklistItemAddedEvent } from "../../events/checklist.events";

import {
  ChecklistItemTextRequiredError,
  ChecklistItemTextTooLongError,
} from "../errors";

export const CHECKLIST_ITEM_TEXT_MAX_LENGTH = 500;

export interface AddChecklistItemInput {
  readonly newItemId:     ChecklistItemId;
  /** Snapshot of the parent checklist (for boardId / cardId / tenantId). */
  readonly checklist:     ChecklistEntity;
  readonly text:          string;
  readonly position:      Position;
  readonly addedBy:       UserId;
  readonly now:           Date;
  readonly eventId:       string;
  readonly correlationId?: string;
}

export interface AddChecklistItemOutput {
  readonly entity: ChecklistItemEntity;
  readonly event:  ChecklistItemAddedEvent;
}

export function addChecklistItem(
  input: AddChecklistItemInput,
): AddChecklistItemOutput {
  const trimmed = input.text.trim();
  if (trimmed.length === 0) {
    throw new ChecklistItemTextRequiredError();
  }
  if (trimmed.length > CHECKLIST_ITEM_TEXT_MAX_LENGTH) {
    throw new ChecklistItemTextTooLongError(CHECKLIST_ITEM_TEXT_MAX_LENGTH);
  }

  const entity: ChecklistItemEntity = {
    id:          input.newItemId,
    tenantId:    input.checklist.tenantId as TenantId,
    checklistId: input.checklist.id,
    text:        trimmed,
    isDone:      false,
    position:    input.position,
    createdAt:   input.now,
    createdBy:   input.addedBy,
    updatedAt:   input.now,
  };

  const event: ChecklistItemAddedEvent = {
    id:            input.eventId,
    type:          "checklist.item_added",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.checklist.cardId as CardId,
    aggregateType: "card",
    actorId:       input.addedBy,
    tenantId:      input.checklist.tenantId as TenantId,
    correlationId: input.correlationId,
    payload: {
      checklistItemId: input.newItemId,
      checklistId:     input.checklist.id,
      cardId:          input.checklist.cardId as CardId,
      boardId:         input.checklist.boardId as BoardId,
      text:            trimmed,
      isDone:          false,
      position:        input.position,
      addedBy:         input.addedBy,
    },
  };

  return { entity, event };
}
