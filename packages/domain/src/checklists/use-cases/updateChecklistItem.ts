// packages/domain/src/checklists/use-cases/updateChecklistItem.ts
//
// Pure use case: validates an item update patch (text / isDone /
// position) and returns the patch + event. Toggle semantics live here
// (D10 — no separate toggle procedure; isDone is just a field).
// Reorder semantics live here too (D11 — position field).

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
  ChecklistItemPatch,
} from "../types";
import type { ChecklistItemUpdatedEvent } from "../../events/checklist.events";

import { CHECKLIST_ITEM_TEXT_MAX_LENGTH } from "./addChecklistItem";
import {
  ChecklistItemTextRequiredError,
  ChecklistItemTextTooLongError,
} from "../errors";

export interface UpdateChecklistItemInput {
  readonly current:    ChecklistItemEntity;
  /** Parent checklist — used to populate cardId/boardId on the event. */
  readonly checklist:  ChecklistEntity;
  readonly patch: {
    readonly text?:     string;
    readonly isDone?:   boolean;
    readonly position?: Position;
  };
  readonly actorId:        UserId;
  readonly now:            Date;
  readonly eventId:        string;
  readonly correlationId?: string;
}

export interface UpdateChecklistItemOutput {
  readonly patch: ChecklistItemPatch;
  readonly event: ChecklistItemUpdatedEvent;
  readonly noOp:  boolean;
}

export function updateChecklistItem(
  input: UpdateChecklistItemInput,
): UpdateChecklistItemOutput {
  const eventChanges: {
    text?:     string;
    isDone?:   boolean;
    position?: string;
  } = {};
  const dbPatch: {
    text?:     string;
    isDone?:   boolean;
    position?: Position;
  } = {};

  if (input.patch.text !== undefined) {
    const trimmed = input.patch.text.trim();
    if (trimmed.length === 0) {
      throw new ChecklistItemTextRequiredError();
    }
    if (trimmed.length > CHECKLIST_ITEM_TEXT_MAX_LENGTH) {
      throw new ChecklistItemTextTooLongError(CHECKLIST_ITEM_TEXT_MAX_LENGTH);
    }
    if (trimmed !== input.current.text) {
      dbPatch.text      = trimmed;
      eventChanges.text = trimmed;
    }
  }

  if (
    input.patch.isDone !== undefined &&
    input.patch.isDone !== input.current.isDone
  ) {
    dbPatch.isDone      = input.patch.isDone;
    eventChanges.isDone = input.patch.isDone;
  }

  if (
    input.patch.position !== undefined &&
    input.patch.position !== input.current.position
  ) {
    dbPatch.position      = input.patch.position;
    eventChanges.position = input.patch.position;
  }

  const noOp = Object.keys(dbPatch).length === 0;

  const event: ChecklistItemUpdatedEvent = {
    id:            input.eventId,
    type:          "checklist.item_updated",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.checklist.cardId as CardId,
    aggregateType: "card",
    actorId:       input.actorId,
    tenantId:      input.current.tenantId as TenantId,
    correlationId: input.correlationId,
    payload: {
      checklistItemId: input.current.id,
      checklistId:     input.checklist.id,
      cardId:          input.checklist.cardId as CardId,
      boardId:         input.checklist.boardId as BoardId,
      changes:         eventChanges,
    },
  };

  return { patch: dbPatch, event, noOp };
}
