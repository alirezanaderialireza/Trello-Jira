// packages/domain/src/checklists/use-cases/removeChecklistItem.ts
//
// Pure use case: produces the ChecklistItemRemovedEvent. The item
// row is hard-deleted at the repository layer (junction-like — no
// business state worth retaining; same reasoning as labels'
// card_labels in F1.2.1).

import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
} from "../../shared/ids";
import type {
  ChecklistEntity,
  ChecklistItemEntity,
} from "../types";
import type { ChecklistItemRemovedEvent } from "../../events/checklist.events";

export interface RemoveChecklistItemInput {
  readonly item:           ChecklistItemEntity;
  readonly checklist:      ChecklistEntity;
  readonly actorId:        UserId;
  readonly now:            Date;
  readonly eventId:        string;
  readonly correlationId?: string;
}

export interface RemoveChecklistItemOutput {
  readonly event: ChecklistItemRemovedEvent;
}

export function removeChecklistItem(
  input: RemoveChecklistItemInput,
): RemoveChecklistItemOutput {
  const event: ChecklistItemRemovedEvent = {
    id:            input.eventId,
    type:          "checklist.item_removed",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.checklist.cardId as CardId,
    aggregateType: "card",
    actorId:       input.actorId,
    tenantId:      input.item.tenantId as TenantId,
    correlationId: input.correlationId,
    payload: {
      checklistItemId: input.item.id,
      checklistId:     input.checklist.id,
      cardId:          input.checklist.cardId as CardId,
      boardId:         input.checklist.boardId as BoardId,
    },
  };

  return { event };
}
