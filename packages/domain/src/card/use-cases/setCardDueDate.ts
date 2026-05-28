// packages/domain/src/card/use-cases/setCardDueDate.ts
//
// Pure use case: produces the DB patch + outbox event for a
// "set or clear card due date" mutation. The caller (router) is
// responsible for:
//   • Validating the wire-level `string | null` against the DateOnly
//     format (e.g. via Zod regex YYYY-MM-DD). The use case assumes
//     the input is already a valid DateOnly or null.
//   • Loading the current card row (with tenantId + boardId + dueDate).
//   • Persisting the patch in the same transaction as the outbox emit.
//
// Idempotency
//   When the new due date equals the current value (including the
//   null === null case), the use case returns `{ noOp: true }` and
//   the router skips both the DB write and the outbox emit. This
//   protects against a realtime echo driving the same change back
//   into the system, and it avoids polluting the activity timeline
//   with empty deltas.
//
// Overdue
//   The use case does NOT compute overdue. Whether a date is overdue
//   depends on the *viewer's* clock, not the server's — that's a
//   render-time decision in the client (CardDueDateBadge calls
//   `isOverdue` from `apps/web/src/lib/date.ts`).

import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
} from "../../shared/ids";
import type { DateOnly } from "../../shared/date-types";
import type { CardDueDateUpdatedEvent } from "../../events/card.events";

export interface SetCardDueDateInput {
  /** Snapshot of the card before the mutation. */
  readonly card: {
    readonly id:       CardId;
    readonly boardId:  BoardId;
    readonly tenantId: TenantId;
    readonly dueDate:  DateOnly | null;
  };
  /** The new value. null clears the due date. */
  readonly newDueDate: DateOnly | null;
  readonly actorId:    UserId;
  /** Server clock — never trust client timestamps for the event. */
  readonly now:        Date;
  readonly eventId:    string;
  readonly correlationId?: string;
}

export type SetCardDueDateOutput =
  | { readonly noOp: true }
  | {
      readonly noOp:  false;
      readonly patch: { readonly dueDate: DateOnly | null };
      readonly event: CardDueDateUpdatedEvent;
    };

export function setCardDueDate(
  input: SetCardDueDateInput,
): SetCardDueDateOutput {
  const { card, newDueDate, actorId, now, eventId, correlationId } = input;

  // Idempotency / no-op short-circuit. Equality on the branded string
  // is identical to plain string equality at runtime, so this also
  // covers null === null (both "clear when already cleared").
  if (card.dueDate === newDueDate) {
    return { noOp: true };
  }

  const event: CardDueDateUpdatedEvent = {
    id:            eventId,
    type:          "card.due_date_updated",
    // `version` here is the legacy aggregate-version field on the base
    // event interface (used by some downstream projection consumers).
    // The semantic schema version of the payload itself lives in
    // `schemaVersion` and is bumped to 2 by F1.2.2.
    version:       1,
    schemaVersion: 2,
    occurredAt:    now.toISOString(),
    aggregateId:   card.id,
    aggregateType: "card",
    actorId,
    tenantId:      card.tenantId,
    correlationId,
    payload: {
      cardId:     card.id,
      boardId:    card.boardId,
      // Wire shape is plain string | null — the brand erases at the
      // JSON boundary so we cast to widen.
      oldDueDate: card.dueDate as string | null,
      newDueDate: newDueDate    as string | null,
      updatedBy:  actorId,
    },
  };

  return {
    noOp:  false,
    patch: { dueDate: newDueDate },
    event,
  };
}
