// packages/domain/src/labels/use-cases/updateLabel.ts
//
// Pure use case: validates an update patch against the current label
// state and returns the patch to apply plus the LabelUpdatedEvent.
//
// Authorisation (creator OR board admin) is decided by the router
// before invoking this — domain logic doesn't carry the role taxonomy.

import type { BoardId, TenantId, UserId } from "../../shared/ids";
import type { Position } from "../../ordering/position";
import type {
  ColorToken,
  LabelEntity,
  LabelPatch,
} from "../types";
import type { LabelUpdatedEvent } from "../../events/label.events";

import { COLOR_TOKENS } from "../types";
import {
  DuplicateLabelNameError,
  InvalidColorTokenError,
  LabelNameRequiredError,
  LabelNameTooLongError,
} from "../errors";

import { LABEL_NAME_MAX_LENGTH } from "./createLabel";

export interface UpdateLabelInput {
  readonly current:  LabelEntity;
  readonly patch: {
    readonly name?:       string;
    readonly colorToken?: string;
    readonly position?:   Position;
  };
  readonly actorId: UserId;
  readonly now:     Date;
  readonly eventId: string;
  readonly correlationId?: string;
  /**
   * Lower-cased names of every other live label on the board (excluding
   * `current.name`) — used for duplicate detection when the patch
   * changes `name`. Caller resolves this from the repo.
   */
  readonly otherExistingNamesLower: readonly string[];
}

export interface UpdateLabelOutput {
  readonly patch: LabelPatch;
  readonly event: LabelUpdatedEvent;
  /** True when the patch had no actual changes — caller should skip writes. */
  readonly noOp:  boolean;
}

export function updateLabel(input: UpdateLabelInput): UpdateLabelOutput {
  // Local mutable accumulators. `LabelPatch` and the event-changes type
  // both inherit `readonly` modifiers from their parent shapes
  // (LabelEntity, LabelUpdatedEvent.payload.changes), so we accumulate
  // into a writable structural type and cast at the return boundary.
  const eventChanges: { name?: string; colorToken?: string; position?: string } = {};
  const dbPatch:      { name?: string; colorToken?: ColorToken; position?: Position } = {};

  // ── name ─────────────────────────────────────────────────────────────────
  if (input.patch.name !== undefined) {
    const trimmedName = input.patch.name.trim();
    if (trimmedName.length === 0) {
      throw new LabelNameRequiredError();
    }
    if (trimmedName.length > LABEL_NAME_MAX_LENGTH) {
      throw new LabelNameTooLongError(LABEL_NAME_MAX_LENGTH);
    }
    if (trimmedName !== input.current.name) {
      const candidateLower = trimmedName.toLocaleLowerCase("fa-IR");
      if (input.otherExistingNamesLower.includes(candidateLower)) {
        throw new DuplicateLabelNameError(trimmedName);
      }
      dbPatch.name      = trimmedName;
      eventChanges.name = trimmedName;
    }
  }

  // ── colorToken ───────────────────────────────────────────────────────────
  if (input.patch.colorToken !== undefined) {
    if (!(COLOR_TOKENS as readonly string[]).includes(input.patch.colorToken)) {
      throw new InvalidColorTokenError(input.patch.colorToken);
    }
    const next = input.patch.colorToken as ColorToken;
    if (next !== input.current.colorToken) {
      dbPatch.colorToken      = next;
      eventChanges.colorToken = next;
    }
  }

  // ── position ─────────────────────────────────────────────────────────────
  if (input.patch.position !== undefined && input.patch.position !== input.current.position) {
    dbPatch.position      = input.patch.position;
    eventChanges.position = input.patch.position;
  }

  const noOp = Object.keys(dbPatch).length === 0;

  const event: LabelUpdatedEvent = {
    id:            input.eventId,
    type:          "label.updated",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.current.boardId as BoardId,
    aggregateType: "board",
    actorId:       input.actorId,
    tenantId:      input.current.tenantId as TenantId,
    correlationId: input.correlationId,
    payload: {
      labelId: input.current.id,
      boardId: input.current.boardId,
      changes: eventChanges,
    },
  };

  return { patch: dbPatch, event, noOp };
}
