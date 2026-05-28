// packages/domain/src/checklists/use-cases/createChecklist.ts
//
// Pure use case: validates create-checklist inputs and returns the
// entity to insert plus the ChecklistCreatedEvent to enqueue in the
// outbox.
//
// All side effects (DB, clock, ID generation) are injected by the
// caller — the use case is deterministic given its inputs, so the
// snapshot test in __tests__/createChecklist.test.ts can assert on a
// fixed output.

import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
} from "../../shared/ids";
import type { Position } from "../../ordering/position";
import type { ChecklistEntity, ChecklistId } from "../types";
import type { ChecklistCreatedEvent } from "../../events/checklist.events";

import {
  ChecklistTitleRequiredError,
  ChecklistTitleTooLongError,
  DuplicateChecklistTitleError,
} from "../errors";

export const CHECKLIST_TITLE_MAX_LENGTH = 100;

export interface CreateChecklistInput {
  readonly newChecklistId: ChecklistId;
  readonly tenantId:       TenantId;
  readonly cardId:         CardId;
  readonly boardId:        BoardId;
  readonly title:          string;
  readonly position:       Position;
  readonly createdBy:      UserId;
  /** Server clock — never trust client timestamps. */
  readonly now:            Date;
  /**
   * Lower-cased titles of every other live checklist on the same
   * card. Caller resolves this from the repo so the use case stays
   * pure. Mirrors `existingNamesLower` in createLabel.
   */
  readonly existingTitlesLower: readonly string[];
  /** Event-envelope correlation hint (matches the optimistic envelope's). */
  readonly correlationId?: string;
  /** Stable event ID — caller generates so the outbox row is reproducible. */
  readonly eventId: string;
}

export interface CreateChecklistOutput {
  readonly entity: ChecklistEntity;
  readonly event:  ChecklistCreatedEvent;
}

export function createChecklist(
  input: CreateChecklistInput,
): CreateChecklistOutput {
  // ── Title validation ────────────────────────────────────────────────────
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    throw new ChecklistTitleRequiredError();
  }
  if (trimmedTitle.length > CHECKLIST_TITLE_MAX_LENGTH) {
    throw new ChecklistTitleTooLongError(CHECKLIST_TITLE_MAX_LENGTH);
  }

  // ── Case-insensitive duplicate check (Persian-friendly) ─────────────────
  // toLocaleLowerCase('fa-IR') keeps Persian letter folding consistent
  // with the DB's LOWER() in the partial-unique index. ASCII titles use
  // the same code path — JavaScript's Unicode case folding handles both.
  const candidateLower = trimmedTitle.toLocaleLowerCase("fa-IR");
  if (input.existingTitlesLower.includes(candidateLower)) {
    throw new DuplicateChecklistTitleError(trimmedTitle);
  }

  // ── Build entity ─────────────────────────────────────────────────────────
  const entity: ChecklistEntity = {
    id:        input.newChecklistId,
    tenantId:  input.tenantId,
    cardId:    input.cardId,
    boardId:   input.boardId,
    title:     trimmedTitle,
    position:  input.position,
    createdAt: input.now,
    createdBy: input.createdBy,
    updatedAt: input.now,
    deletedAt: null,
  };

  // ── Build outbox event ───────────────────────────────────────────────────
  const event: ChecklistCreatedEvent = {
    id:            input.eventId,
    type:          "checklist.created",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.cardId,
    aggregateType: "card",
    actorId:       input.createdBy,
    tenantId:      input.tenantId,
    correlationId: input.correlationId,
    payload: {
      checklistId: input.newChecklistId,
      cardId:      input.cardId,
      boardId:     input.boardId,
      title:       trimmedTitle,
      position:    input.position,
      createdBy:   input.createdBy,
    },
  };

  return { entity, event };
}
