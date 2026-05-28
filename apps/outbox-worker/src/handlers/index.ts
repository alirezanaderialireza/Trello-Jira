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

import type { EventHandler } from "../types";

const HANDLERS: Record<string, EventHandler> = {
  "workspace.invitation.created": workspaceInvitationCreatedHandler,
};

/**
 * Look up the registered handler for an outbox event type.
 * Returns `null` for events that have no side-effect handler — the
 * worker's default behaviour (Redis publish only) still applies.
 */
export function getEventHandler(eventType: string): EventHandler | null {
  return HANDLERS[eventType] ?? null;
}
