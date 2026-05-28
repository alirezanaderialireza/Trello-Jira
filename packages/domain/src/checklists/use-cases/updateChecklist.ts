// packages/domain/src/checklists/use-cases/updateChecklist.ts
//
// Pure use case: validates an update patch (title and/or position)
// against the current checklist state and returns the patch to apply
// plus the ChecklistUpdatedEvent. F1.2.3.a D12 — D11 mirror for items.

import type { BoardId, TenantId, UserId } from "../../shared/ids";
import type { Position } from "../../ordering/position";
import type {
  ChecklistEntity,
  ChecklistPatch,
} from "../types";
import type { ChecklistUpdatedEvent } from "../../events/checklist.events";

import { CHECKLIST_TITLE_MAX_LENGTH } from "./createChecklist";
import {
  ChecklistTitleRequiredError,
  ChecklistTitleTooLongError,
  DuplicateChecklistTitleError,
} from "../errors";

export interface UpdateChecklistInput {
  readonly current: ChecklistEntity;
  readonly patch: {
    readonly title?:    string;
    readonly position?: Position;
  };
  readonly actorId:        UserId;
  readonly now:            Date;
  readonly eventId:        string;
  readonly correlationId?: string;
  readonly otherExistingTitlesLower: readonly string[];
}

export interface UpdateChecklistOutput {
  readonly patch: ChecklistPatch;
  readonly event: ChecklistUpdatedEvent;
  readonly noOp:  boolean;
}

export function updateChecklist(
  input: UpdateChecklistInput,
): UpdateChecklistOutput {
  const eventChanges: { title?: string; position?: string } = {};
  const dbPatch:      { title?: string; position?: Position } = {};

  if (input.patch.title !== undefined) {
    const trimmed = input.patch.title.trim();
    if (trimmed.length === 0) {
      throw new ChecklistTitleRequiredError();
    }
    if (trimmed.length > CHECKLIST_TITLE_MAX_LENGTH) {
      throw new ChecklistTitleTooLongError(CHECKLIST_TITLE_MAX_LENGTH);
    }
    if (trimmed !== input.current.title) {
      const candidateLower = trimmed.toLocaleLowerCase("fa-IR");
      if (input.otherExistingTitlesLower.includes(candidateLower)) {
        throw new DuplicateChecklistTitleError(trimmed);
      }
      dbPatch.title      = trimmed;
      eventChanges.title = trimmed;
    }
  }

  if (
    input.patch.position !== undefined &&
    input.patch.position !== input.current.position
  ) {
    dbPatch.position      = input.patch.position;
    eventChanges.position = input.patch.position;
  }

  const noOp = Object.keys(dbPatch).length === 0;

  const event: ChecklistUpdatedEvent = {
    id:            input.eventId,
    type:          "checklist.updated",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.current.cardId,
    aggregateType: "card",
    actorId:       input.actorId,
    tenantId:      input.current.tenantId as TenantId,
    correlationId: input.correlationId,
    payload: {
      checklistId: input.current.id,
      cardId:      input.current.cardId,
      boardId:     input.current.boardId as BoardId,
      changes:     eventChanges,
    },
  };

  return { patch: dbPatch, event, noOp };
}
