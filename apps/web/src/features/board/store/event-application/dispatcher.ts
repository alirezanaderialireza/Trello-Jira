// apps/web/src/features/board/store/event-application/dispatcher.ts

import type {
  AppDomainEvent,
  CardCreatedEvent,
  CardUpdatedEvent,
  CardDeletedEvent,
  CardMovedEvent,
  ListCreatedEvent,
  ListUpdatedEvent,
  ListMovedEvent,
  ListDeletedEvent,
} from "@repo/domain";

import type { BoardStoreState } from "../useBoardStore";
import { telemetry } from "../../devtools/logEvent";

import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// Pure reducers
import { applyCardMoved } from "./applyCardMoved";
import { applyCardCreated } from "./applyCardCreated";
import { applyCardUpdated } from "./applyCardUpdated";
import { applyCardDeleted } from "./applyCardDeleted";
import { applyListMoved } from "./applyListMoved";
import { applyListCreated } from "./applyListCreated";
import { applyListUpdated } from "./applyListUpdated";
// ✅ Fix #8: applyListDeleted added — list.deleted events were silently dropped
import { applyListDeleted } from "./applyListDeleted";

// ============================================================================
// Event Handler Contract
// ============================================================================

export type EventHandler<TEvent extends AppDomainEvent = AppDomainEvent> = (
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TEvent>,
  context: ReducerContext,
) => Partial<BoardStoreState>;

// ============================================================================
// Canonical Event Map
// ============================================================================

type EventMap = {
  "card.created": CardCreatedEvent;
  "card.updated": CardUpdatedEvent;
  "card.deleted": CardDeletedEvent;
  "card.moved":   CardMovedEvent;
  "list.created": ListCreatedEvent;
  "list.updated": ListUpdatedEvent;
  "list.moved":   ListMovedEvent;
  // ✅ Fix #8: list.deleted was missing from the registry
  "list.deleted": ListDeletedEvent;
};

// ============================================================================
// Strict Registry Type (compile-time exhaustiveness)
// ============================================================================

type HandlerRegistry = {
  [K in keyof EventMap]: EventHandler<EventMap[K]>;
};

// ============================================================================
// Reducer Registry — O(1) lookup
// ============================================================================

const HANDLERS: HandlerRegistry = {
  "card.moved":    applyCardMoved,
  "card.created":  applyCardCreated,
  "card.updated":  applyCardUpdated,
  "card.deleted":  applyCardDeleted,
  "list.moved":    applyListMoved,
  "list.created":  applyListCreated,
  "list.updated":  applyListUpdated,
  // ✅ Fix #8
  "list.deleted":  applyListDeleted,
};

// ============================================================================
// Main Dispatcher — sole mutation entry point
// ============================================================================

export function applyEvent(
  state: BoardStoreState,
  envelope: ClientEventEnvelope,
  context: ReducerContext,
): Partial<BoardStoreState> {
  const eventType = envelope.event.type as keyof EventMap;
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
    console.error(`[Dispatcher] Failed applying "${eventType}" event.`, {
      error,
      event: envelope.event,
      context,
    });

    telemetry.log(
      "MUTATION_ENGINE",
      "REDUCER_CRASH",
      { eventType, error: error.message },
      { correlationId },
    );

    return {};
  }
}
