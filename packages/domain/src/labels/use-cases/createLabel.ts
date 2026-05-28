// packages/domain/src/labels/use-cases/createLabel.ts
//
// Pure use case: validates create-label inputs and returns the entity to
// insert plus the LabelCreatedEvent to enqueue in the outbox.
//
// All side effects (DB, clock, ID generation) are injected by the
// caller — the use case is deterministic given its inputs, so the
// snapshot test in __tests__/createLabel.test.ts can assert on a fixed
// output.

import type { BoardId, TenantId, UserId } from "../../shared/ids";
import type { Position } from "../../ordering/position";
import type {
  ColorToken,
  LabelEntity,
  LabelId,
} from "../types";
import type { LabelCreatedEvent } from "../../events/label.events";

import { COLOR_TOKENS } from "../types";
import {
  DuplicateLabelNameError,
  InvalidColorTokenError,
  LabelNameRequiredError,
  LabelNameTooLongError,
} from "../errors";

export const LABEL_NAME_MAX_LENGTH = 50;

/** Inputs the caller must build (router resolves DB lookups + clock + IDs). */
export interface CreateLabelInput {
  readonly newLabelId: LabelId;
  readonly tenantId:   TenantId;
  readonly boardId:    BoardId;
  readonly name:       string;
  readonly colorToken: string; // unbranded — validated here
  readonly position:   Position;
  readonly createdBy:  UserId;
  /** Server clock — never trust client timestamps. */
  readonly now:        Date;
  /**
   * Lower-cased names of every live (non-deleted) label on the board.
   * Caller resolves this from the repo so the use case stays pure.
   */
  readonly existingNamesLower: readonly string[];
  /** Event-envelope correlation hint (matches the optimistic envelope's). */
  readonly correlationId?: string;
  /** Stable event ID — caller generates so the outbox row is reproducible. */
  readonly eventId: string;
}

export interface CreateLabelOutput {
  readonly entity: LabelEntity;
  readonly event:  LabelCreatedEvent;
}

export function createLabel(input: CreateLabelInput): CreateLabelOutput {
  // ── Name validation ───────────────────────────────────────────────────────
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new LabelNameRequiredError();
  }
  if (trimmedName.length > LABEL_NAME_MAX_LENGTH) {
    throw new LabelNameTooLongError(LABEL_NAME_MAX_LENGTH);
  }

  // ── Case-insensitive duplicate check (Persian-friendly) ──────────────────
  // toLocaleLowerCase('fa-IR') keeps Persian letter folding consistent
  // with the DB's LOWER() in the partial-unique index. ASCII names use
  // the same code path — JavaScript's Unicode case folding handles both.
  const candidateLower = trimmedName.toLocaleLowerCase("fa-IR");
  if (input.existingNamesLower.includes(candidateLower)) {
    throw new DuplicateLabelNameError(trimmedName);
  }

  // ── Colour token validation ──────────────────────────────────────────────
  if (!(COLOR_TOKENS as readonly string[]).includes(input.colorToken)) {
    throw new InvalidColorTokenError(input.colorToken);
  }
  const colorToken = input.colorToken as ColorToken;

  // ── Build entity ─────────────────────────────────────────────────────────
  const entity: LabelEntity = {
    id:         input.newLabelId,
    tenantId:   input.tenantId,
    boardId:    input.boardId,
    name:       trimmedName,
    colorToken,
    position:   input.position,
    createdAt:  input.now,
    createdBy:  input.createdBy,
    updatedAt:  input.now,
    deletedAt:  null,
  };

  // ── Build outbox event ───────────────────────────────────────────────────
  const event: LabelCreatedEvent = {
    id:            input.eventId,
    type:          "label.created",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.boardId,
    aggregateType: "board",
    actorId:       input.createdBy,
    tenantId:      input.tenantId,
    correlationId: input.correlationId,
    payload: {
      labelId:    input.newLabelId,
      boardId:    input.boardId,
      name:       trimmedName,
      colorToken,
      position:   input.position,
      createdBy:  input.createdBy,
    },
  };

  return { entity, event };
}
