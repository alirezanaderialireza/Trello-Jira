// apps/outbox-worker/src/handlers/index.ts
//
// Per-event-type handler registry for the outbox worker.
//
// Why a static map (not dynamic registration):
//   • Keeps event-handler wiring declarative and grep-able.
//   • The worker is single-process and starts with all handlers
//     known at boot — there is no plugin model.
//   • New handlers register by adding one line below; the type of
//     the map enforces the EventHandler contract at compile time.
//
// Registered handlers run AFTER the existing Redis publish in
// `processClaimed` (see ../index.ts). Both side effects must
// succeed for the row to be marked `processed_at = NOW()`. A
// handler that throws causes a normal retry (retry_count++); a
// handler that succeeds without throwing is treated as delivered.

import { workspaceInvitationCreatedHandler } from "./workspaceInvitationCreated.handler";
import { cardNotificationHandler } from "./cardNotification.handler";
import { boardNotificationHandler } from "./boardNotification.handler";

import type { EventHandler } from "../types";

const HANDLERS: Record<string, EventHandler> = {
  "workspace.invitation.created": workspaceInvitationCreatedHandler,
  // Card notifications (F1.2.9) — fan-out to card watchers.
  "card.updated":             cardNotificationHandler,
  "card.assignee_added":      cardNotificationHandler,
  "card.due_date_updated":    cardNotificationHandler,
  "comment.created":          cardNotificationHandler,
  "checklist.item_updated":   cardNotificationHandler,
  // Board notifications (F1.2.9) — single affected member.
  "board.member.added":       boardNotificationHandler,
  "board.member.removed":     boardNotificationHandler,
};

/**
 * Look up the registered handler for an outbox event type.
 * Returns `null` for events that have no side-effect handler — the
 * worker's default behaviour (Redis publish only) still applies.
 */
export function getEventHandler(eventType: string): EventHandler | null {
  return HANDLERS[eventType] ?? null;
}
