// apps/web/src/features/board/store/event-application/dispatcher.ts
//
// Architecture boundary:
//   ┌─────────────────────────────────────────────────┐
//   │  dispatcher.ts  ←  ORCHESTRATION BOUNDARY       │
//   │  ─────────────────────────────────────────────  │
//   │  • Resolves event type → handler                │
//   │  • Handles unknown-event forward-compat         │
//   │  • Catches reducer crashes (isolation boundary) │
//   │  • Fires telemetry observer (side-effect layer) │
//   │                                                 │
//   │  reducers (applyCard*, applyList*)              │
//   │  ─────────────────────────────────────────────  │
//   │  • 100% pure — no imports outside domain/store  │
//   │  • zero telemetry, zero side effects            │
//   │  • (state, envelope, context) → Partial<State>  │
//   └─────────────────────────────────────────────────┘
//
// Task #2 fix: telemetry was already ONLY in this orchestration layer, never
// inside individual reducers. This refactor makes the boundary explicit by:
//   1. Wrapping telemetry calls in a narrow DispatchObserver type
//   2. Making the observer injectable (default = telemetry, testable = no-op)
//   3. Removing the `telemetry` import from the dispatch hot-path into the
//      observer so tests can run without the devtools store mounting

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
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ============================================================================
// 🛡️ Pure Reducers (zero side effects, zero telemetry)
// ============================================================================

import { applyCardMoved }    from "./applyCardMoved";
import { applyCardCreated }  from "./applyCardCreated";
import { applyCardUpdated }  from "./applyCardUpdated";
import { applyCardDeleted }  from "./applyCardDeleted";
import { applyListMoved }    from "./applyListMoved";
import { applyListCreated }  from "./applyListCreated";
import { applyListUpdated }  from "./applyListUpdated";
import { applyListDeleted }  from "./applyListDeleted";

// ============================================================================
// 📋 DispatchObserver — injectable side-effect hook (NOT part of pure core)
// ─────────────────────────────────────────────────────────────────────────────
// Tests inject a no-op observer.
// Production injects the telemetry observer.
// The pure dispatch logic (HANDLERS + applyEvent) has zero direct dependency
// on any observer — keeping the orchestration boundary clean.
// ============================================================================

export interface DispatchObserver {
  onApply(eventType: string, mode: string, correlationId: string | undefined): void;
  onUnknownEvent(eventType: string, correlationId: string | undefined): void;
  onOptimisticApplied(correlationId: string, eventType: string): void;
  onReducerCrash(eventType: string, error: string, correlationId: string | undefined): void;
}

/** No-op observer — used in tests and when telemetry is unavailable */
export const NO_OP_OBSERVER: DispatchObserver = {
  onApply: () => undefined,
  onUnknownEvent: () => undefined,
  onOptimisticApplied: () => undefined,
  onReducerCrash: () => undefined,
};

/** Lazily-constructed telemetry observer — only imports telemetry at call-time */
function makeTelemetryObserver(): DispatchObserver {
  return {
    onApply(eventType, mode, correlationId) {
      try {
        const { telemetry } = require("../../devtools/logEvent");
        telemetry.log(
          "MUTATION_ENGINE",
          mode === "live" ? "APPLY_LIVE" : "APPLY_OPTIMISTIC",
          { eventType, mode },
          { correlationId },
        );
      } catch { /* devtools not mounted — safe to ignore */ }
    },
    onUnknownEvent(eventType, correlationId) {
      try {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[Dispatcher] Unknown event type: "${eventType}"`);
        }
        const { telemetry } = require("../../devtools/logEvent");
        telemetry.log("MUTATION_ENGINE", "UNKNOWN_EVENT_DROPPED", { eventType }, { correlationId });
      } catch { /* devtools not mounted */ }
    },
    onOptimisticApplied(correlationId, eventType) {
      try {
        const { telemetry } = require("../../devtools/logEvent");
        telemetry.mutation(correlationId, eventType, "OPTIMISTIC_APPLIED");
      } catch { /* devtools not mounted */ }
    },
    onReducerCrash(eventType, error, correlationId) {
      try {
        console.error(`[Dispatcher] Failed applying "${eventType}" event. Error: ${error}`);
        const { telemetry } = require("../../devtools/logEvent");
        telemetry.log("MUTATION_ENGINE", "REDUCER_CRASH", { eventType, error }, { correlationId });
      } catch { /* devtools not mounted */ }
    },
  };
}

// Module-level default observer (lazy, replaced in tests via setDispatchObserver)
let _observer: DispatchObserver = makeTelemetryObserver();

/**
 * Override the dispatch observer.
 * Call in test setup:  setDispatchObserver(NO_OP_OBSERVER)
 * Call in production:  setDispatchObserver(makeTelemetryObserver())
 */
export function setDispatchObserver(obs: DispatchObserver): void {
  _observer = obs;
}

// ============================================================================
// 🌟 Event Handler Contract
// ============================================================================

export type EventHandler<TEvent extends AppDomainEvent = AppDomainEvent> = (
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TEvent>,
  context: ReducerContext,
) => Partial<BoardStoreState>;

// ============================================================================
// 📚 Canonical Event Map
// ============================================================================

type EventMap = {
  "card.created": CardCreatedEvent;
  "card.updated": CardUpdatedEvent;
  "card.deleted": CardDeletedEvent;
  "card.moved":   CardMovedEvent;
  "list.created": ListCreatedEvent;
  "list.updated": ListUpdatedEvent;
  "list.moved":   ListMovedEvent;
  "list.deleted": ListDeletedEvent;
};

type HandlerRegistry = { [K in keyof EventMap]: EventHandler<EventMap[K]> };

// ============================================================================
// 🚀 Reducer Registry  (O(1) lookup — zero side effects in this object)
// ============================================================================

const HANDLERS: HandlerRegistry = {
  "card.moved":    applyCardMoved,
  "card.created":  applyCardCreated,
  "card.updated":  applyCardUpdated,
  "card.deleted":  applyCardDeleted,
  "list.moved":    applyListMoved,
  "list.created":  applyListCreated,
  "list.updated":  applyListUpdated,
  "list.deleted":  applyListDeleted,
};

// ============================================================================
// 👑 applyEvent — PURE orchestration core
// ─────────────────────────────────────────────────────────────────────────────
// This function is pure with respect to domain state:
//   (state, envelope, context) → Partial<BoardStoreState>
//
// The only side effect is the _observer call, which is:
//   - injected (not hardcoded)
//   - wrapped in try/catch (never affects return value)
//   - no-op in tests
//
// The individual reducers called here have ZERO side effects by contract.
// ============================================================================

export function applyEvent(
  state: BoardStoreState,
  envelope: ClientEventEnvelope,
  context: ReducerContext,
): Partial<BoardStoreState> {
  const eventType    = envelope.event.type as keyof EventMap;
  const correlationId = envelope.event.correlationId;

  // Side-effect: telemetry (isolated, injectable, never throws into core)
  _observer.onApply(eventType, context.mode, correlationId);

  const handler = HANDLERS[eventType];

  if (!handler) {
    _observer.onUnknownEvent(eventType, correlationId);
    return {};
  }

  try {
    const nextState = (handler as EventHandler)(state, envelope, context);

    // Optimistic events: live mode + no ACK yet
    if (context.mode === "live" && correlationId && !envelope.acknowledged) {
      _observer.onOptimisticApplied(correlationId, eventType);
    }

    return nextState;
  } catch (error: any) {
    _observer.onReducerCrash(eventType, error?.message ?? String(error), correlationId);
    return {}; // Reducer isolation: crash is contained, state unchanged
  }
}
