// apps/web/src/features/board/store/event-application/applyActivity.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Pure reducer that appends an ActivityEntry to the windowed activityFeed
// when an "activity.recorded" synthetic event arrives — OR is called
// directly by the activityMiddleware after every successful domain event.
//
// Design rules:
//   • Pure — no side-effects, no Date.now(), no crypto calls.
//   • Idempotent — duplicate activity IDs are silently dropped.
//   • Replay-safe — applying the same event twice produces the same state.
//   • Window-bounded — evicts oldest entries beyond ACTIVITY_WINDOW_SIZE.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppDomainEvent } from "@repo/domain";
import type { BoardStoreState, ActivityEntry } from "../useBoardStore";
import { ACTIVITY_WINDOW_SIZE } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ── Public helper ─────────────────────────────────────────────────────────────

/**
 * Called by the dispatcher for "activity.recorded" synthetic events.
 * The event payload IS the ActivityEntry (the server serialises it that way).
 */
export function applyActivityRecorded(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<AppDomainEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  // The payload of an activity.recorded event is the ActivityEntry itself.
  const entry = (envelope.event.payload as unknown) as ActivityEntry;
  return appendActivityEntry(state, entry);
}

/**
 * appendActivityEntry — pure state transformation.
 *
 * Called:
 *   1. By applyActivityRecorded (server push path).
 *   2. By activityMiddleware (local optimistic path) after every reducer
 *      that changes domain state — so every mutation generates an activity
 *      entry without the server needing to push a separate event.
 */
export function appendActivityEntry(
  state: BoardStoreState,
  entry: ActivityEntry,
): Partial<BoardStoreState> {
  // Idempotency — never add a duplicate entry.
  if (state.activityFeed.some((e) => e.id === entry.id)) return {};

  const next = [...state.activityFeed, entry];

  // FIFO window eviction.
  const windowed =
    next.length > ACTIVITY_WINDOW_SIZE
      ? next.slice(next.length - ACTIVITY_WINDOW_SIZE)
      : next;

  return { activityFeed: windowed };
}

// ── Canonical activity-entry factory ─────────────────────────────────────────
//
// Used by activityMiddleware to build entries from any domain event.
// Pure — all non-determinism (UUID, timestamp) is injected by the caller.

export interface ActivityEntryFactoryDeps {
  generateId: () => string;
  nowIso: () => string;
  actorId: string;
  tenantId: string;
}

/**
 * Builds an ActivityEntry from any AppDomainEvent.
 * The payload is a shallow copy of the event payload (safe for display / audit).
 */
export function buildActivityEntry(
  event: AppDomainEvent,
  deps: ActivityEntryFactoryDeps,
): ActivityEntry {
  const boardId = _extractBoardId(event);

  return {
    id:            deps.generateId(),
    boardId,
    actorId:       event.actorId ?? deps.actorId,
    tenantId:      event.tenantId ?? deps.tenantId,
    timestamp:     event.occurredAt ?? deps.nowIso(),
    correlationId: event.correlationId,
    eventType:     event.type,
    // Shallow copy — never store deep mutable references in the feed.
    payload:       { ...(event.payload as Record<string, unknown>) },
  };
}

/**
 * Extracts boardId from any domain event payload.
 * All Phase 4 payloads carry boardId — this function handles the union safely.
 */
function _extractBoardId(event: AppDomainEvent): string {
  const p = event.payload as Record<string, unknown>;
  return typeof p["boardId"] === "string" ? p["boardId"] : event.aggregateId;
}
