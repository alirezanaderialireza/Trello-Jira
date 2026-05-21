// apps/web/src/features/board/store/event-application/dispatcher.ts

import type {
  AppDomainEvent,
  // ── Phase 1-2 ───────────────────────────────────────────────────────────
  CardCreatedEvent,
  CardUpdatedEvent,
  CardDeletedEvent,
  CardMovedEvent,
  ListCreatedEvent,
  ListUpdatedEvent,
  ListMovedEvent,
  ListDeletedEvent,
  // ── Phase 4 card sub-events ─────────────────────────────────────────────
  CardLockedEvent,
  CardUnlockedEvent,
  CardAssigneeAddedEvent,
  CardAssigneeRemovedEvent,
  CardDueDateUpdatedEvent,
  CardLabelAddedEvent,
  CardLabelRemovedEvent,
  // ── Phase 4 label ────────────────────────────────────────────────────────
  LabelCreatedEvent,
  LabelUpdatedEvent,
  LabelDeletedEvent,
  // ── Phase 4 checklist ────────────────────────────────────────────────────
  ChecklistCreatedEvent,
  ChecklistItemAddedEvent,
  ChecklistItemUpdatedEvent,
  ChecklistItemRemovedEvent,
  ChecklistDeletedEvent,
  // ── Phase 4 comment ──────────────────────────────────────────────────────
  CommentCreatedEvent,
  CommentUpdatedEvent,
  CommentDeletedEvent,
  // ── Phase 4 attachment ───────────────────────────────────────────────────
  AttachmentAddedEvent,
  AttachmentRemovedEvent,
  // ── Phase 4 template ─────────────────────────────────────────────────────
  TemplateCreatedEvent,
  TemplateUpdatedEvent,
  TemplateDeletedEvent,
  TemplateAppliedEvent,
} from "@repo/domain";

import type { BoardStoreState } from "../useBoardStore";
import { telemetry } from "../../devtools/logEvent";

import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ── Phase 1-2 reducers ────────────────────────────────────────────────────────
import { applyCardMoved }    from "./applyCardMoved";
import { applyCardCreated }  from "./applyCardCreated";
import { applyCardUpdated }  from "./applyCardUpdated";
import { applyCardDeleted }  from "./applyCardDeleted";
import { applyListMoved }    from "./applyListMoved";
import { applyListCreated }  from "./applyListCreated";
import { applyListUpdated }  from "./applyListUpdated";
import { applyListDeleted }  from "./applyListDeleted";

// ── Phase 4 card sub-event reducers ──────────────────────────────────────────
import { applyCardLocked, applyCardUnlocked }             from "./applyCardLocked";
import { applyCardAssigneeAdded, applyCardAssigneeRemoved } from "./applyCardAssignee";
import { applyCardDueDateUpdated }                        from "./applyCardDueDate";
import { applyCardLabelAdded, applyCardLabelRemoved }     from "./applyCardLabel";

// ── Phase 4 label reducers ───────────────────────────────────────────────────
import { applyLabelCreated, applyLabelUpdated, applyLabelDeleted } from "./applyLabel";

// ── Phase 4 checklist reducers ───────────────────────────────────────────────
import {
  applyChecklistCreated,
  applyChecklistItemAdded,
  applyChecklistItemUpdated,
  applyChecklistItemRemoved,
  applyChecklistDeleted,
} from "./applyChecklist";

// ── Phase 4 comment reducers ─────────────────────────────────────────────────
import {
  applyCommentCreated,
  applyCommentUpdated,
  applyCommentDeleted,
} from "./applyComment";

// ── Phase 4 attachment reducers ──────────────────────────────────────────────
import { applyAttachmentAdded, applyAttachmentRemoved } from "./applyAttachment";

// ── Phase 4 template reducers ────────────────────────────────────────────────
import {
  applyTemplateCreated,
  applyTemplateUpdated,
  applyTemplateDeleted,
  applyTemplateApplied,
} from "./applyTemplate";

// ── Activity reducer ─────────────────────────────────────────────────────────
import { applyActivityRecorded } from "./applyActivity";

// ============================================================================
// 🌟 Event Handler Contract
// ============================================================================

export type EventHandler<TEvent extends AppDomainEvent = AppDomainEvent> = (
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TEvent>,
  context: ReducerContext,
) => Partial<BoardStoreState>;

// ============================================================================
// 📚 Canonical Event Map  (type string → full Event type)
// ============================================================================

type EventMap = {
  // ── Card ──────────────────────────────────────────────────────────────────
  "card.created":          CardCreatedEvent;
  "card.updated":          CardUpdatedEvent;
  "card.deleted":          CardDeletedEvent;
  "card.moved":            CardMovedEvent;
  "card.locked":           CardLockedEvent;
  "card.unlocked":         CardUnlockedEvent;
  "card.assignee_added":   CardAssigneeAddedEvent;
  "card.assignee_removed": CardAssigneeRemovedEvent;
  "card.due_date_updated": CardDueDateUpdatedEvent;
  "card.label_added":      CardLabelAddedEvent;
  "card.label_removed":    CardLabelRemovedEvent;
  // ── List ──────────────────────────────────────────────────────────────────
  "list.created":  ListCreatedEvent;
  "list.updated":  ListUpdatedEvent;
  "list.moved":    ListMovedEvent;
  "list.deleted":  ListDeletedEvent;
  // ── Label ─────────────────────────────────────────────────────────────────
  "label.created": LabelCreatedEvent;
  "label.updated": LabelUpdatedEvent;
  "label.deleted": LabelDeletedEvent;
  // ── Checklist ─────────────────────────────────────────────────────────────
  "checklist.created":      ChecklistCreatedEvent;
  "checklist.item_added":   ChecklistItemAddedEvent;
  "checklist.item_updated": ChecklistItemUpdatedEvent;
  "checklist.item_removed": ChecklistItemRemovedEvent;
  "checklist.deleted":      ChecklistDeletedEvent;
  // ── Comment ───────────────────────────────────────────────────────────────
  "comment.created": CommentCreatedEvent;
  "comment.updated": CommentUpdatedEvent;
  "comment.deleted": CommentDeletedEvent;
  // ── Attachment ────────────────────────────────────────────────────────────
  "attachment.added":   AttachmentAddedEvent;
  "attachment.removed": AttachmentRemovedEvent;
  // ── Template ──────────────────────────────────────────────────────────────
  "template.created": TemplateCreatedEvent;
  "template.updated": TemplateUpdatedEvent;
  "template.deleted": TemplateDeletedEvent;
  "template.applied": TemplateAppliedEvent;
  // ── Activity (internal projection event) ──────────────────────────────────
  "activity.recorded": AppDomainEvent; // passthrough — handled by applyActivity
};

// ============================================================================
// 🧠 Strict Registry Type
// ============================================================================

type HandlerRegistry = {
  [K in keyof EventMap]: EventHandler<EventMap[K]>;
};

// ============================================================================
// 🚀 Reducer Registry  — O(1) lookup
// ============================================================================

const HANDLERS: HandlerRegistry = {
  // ── Card ──────────────────────────────────────────────────────────────────
  "card.created":          applyCardCreated,
  "card.updated":          applyCardUpdated,
  "card.deleted":          applyCardDeleted,
  "card.moved":            applyCardMoved,
  "card.locked":           applyCardLocked,
  "card.unlocked":         applyCardUnlocked,
  "card.assignee_added":   applyCardAssigneeAdded,
  "card.assignee_removed": applyCardAssigneeRemoved,
  "card.due_date_updated": applyCardDueDateUpdated,
  "card.label_added":      applyCardLabelAdded,
  "card.label_removed":    applyCardLabelRemoved,
  // ── List ──────────────────────────────────────────────────────────────────
  "list.created": applyListCreated,
  "list.updated": applyListUpdated,
  "list.moved":   applyListMoved,
  "list.deleted": applyListDeleted,
  // ── Label ─────────────────────────────────────────────────────────────────
  "label.created": applyLabelCreated,
  "label.updated": applyLabelUpdated,
  "label.deleted": applyLabelDeleted,
  // ── Checklist ─────────────────────────────────────────────────────────────
  "checklist.created":      applyChecklistCreated,
  "checklist.item_added":   applyChecklistItemAdded,
  "checklist.item_updated": applyChecklistItemUpdated,
  "checklist.item_removed": applyChecklistItemRemoved,
  "checklist.deleted":      applyChecklistDeleted,
  // ── Comment ───────────────────────────────────────────────────────────────
  "comment.created": applyCommentCreated,
  "comment.updated": applyCommentUpdated,
  "comment.deleted": applyCommentDeleted,
  // ── Attachment ────────────────────────────────────────────────────────────
  "attachment.added":   applyAttachmentAdded,
  "attachment.removed": applyAttachmentRemoved,
  // ── Template ──────────────────────────────────────────────────────────────
  "template.created": applyTemplateCreated,
  "template.updated": applyTemplateUpdated,
  "template.deleted": applyTemplateDeleted,
  "template.applied": applyTemplateApplied,
  // ── Activity ──────────────────────────────────────────────────────────────
  "activity.recorded": applyActivityRecorded,
};

// ============================================================================
// 👑 Main Dispatcher — single entry point for all state mutations
// ============================================================================

export function applyEvent(
  state: BoardStoreState,
  envelope: ClientEventEnvelope,
  context: ReducerContext,
): Partial<BoardStoreState> {

  const eventType     = envelope.event.type as keyof EventMap;
  const correlationId = envelope.event.correlationId;

  telemetry.log(
    "MUTATION_ENGINE",
    context.mode === "live" ? "APPLY_LIVE" : "APPLY_OPTIMISTIC",
    { eventType, mode: context.mode },
    { correlationId },
  );

  const handler = HANDLERS[eventType];

  if (!handler) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[Dispatcher] Unknown event type: "${eventType}"`);
    }
    telemetry.log(
      "MUTATION_ENGINE",
      "UNKNOWN_EVENT_DROPPED",
      { eventType },
      { correlationId },
    );
    return {};
  }

  try {
    const nextState = (handler as EventHandler)(state, envelope, context);

    if (context.mode !== "live" && correlationId) {
      telemetry.mutation(correlationId, eventType, "OPTIMISTIC_APPLIED");
    }

    return nextState;

  } catch (error: any) {
    console.error(
      `[Dispatcher] Failed applying "${eventType}" event.`,
      { error, event: envelope.event, context },
    );
    telemetry.log(
      "MUTATION_ENGINE",
      "REDUCER_CRASH",
      { eventType, error: error.message },
      { correlationId },
    );
    return {};
  }
}
