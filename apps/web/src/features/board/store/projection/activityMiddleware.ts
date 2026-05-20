// apps/web/src/features/board/store/projection/activityMiddleware.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Wraps the dispatcher's applyEvent so that every successful domain event
// automatically produces an ActivityEntry appended to activityFeed.
//
// This keeps every reducer single-purpose (projection only) while ensuring
// every state mutation is observable in the activity feed.
//
// ─── Design ──────────────────────────────────────────────────────────────────
// • Pure composition — wraps applyEvent, not Zustand set().
// • actorId / tenantId injected at mount time from auth context.
// • Activity events generated for "live" and "replay" modes.
// • "rollback" mode skips activity generation (rollbacks are not user actions).
// • Board events that are purely structural (board.created etc.) are also
//   captured — the filter list is explicit and conservative.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppDomainEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import type { ReducerContext } from "../event-application/context";
import { applyEvent as coreApplyEvent } from "../event-application/dispatcher";
import { appendActivityEntry, buildActivityEntry } from "../event-application/applyActivity";

// ── Events that should NOT generate activity entries ─────────────────────────
// These are low-signal structural / internal events.
const ACTIVITY_SKIP_TYPES = new Set<string>([
  "activity.recorded", // avoid infinite loop
]);

export interface ActivityMiddlewareConfig {
  actorId:  string;
  tenantId: string;
}

/**
 * applyEventWithActivity
 *
 * Drop-in replacement for dispatcher.applyEvent in Zustand set() callbacks.
 * Returns the merged partial state that includes both the domain projection
 * update AND the new activity entry (if applicable).
 *
 * Usage in useBoardStore:
 *   applyEvent: (envelope, context) =>
 *     set((state) => applyEventWithActivity(state, envelope, context, config)),
 */
export function applyEventWithActivity(
  state: BoardStoreState,
  envelope: ClientEventEnvelope,
  context: ReducerContext,
  config: ActivityMiddlewareConfig,
): Partial<BoardStoreState> {

  // 1. Apply the domain projection first.
  const domainUpdate = coreApplyEvent(state, envelope, context);

  // 2. Skip activity generation for rollbacks and the skip-list.
  if (
    context.mode === "rollback" ||
    ACTIVITY_SKIP_TYPES.has(envelope.event.type)
  ) {
    return domainUpdate;
  }

  // 3. Build activity entry.
  const entry = buildActivityEntry(envelope.event as AppDomainEvent, {
    generateId: () => crypto.randomUUID(),
    nowIso:     () => new Date().toISOString(),
    actorId:    config.actorId,
    tenantId:   config.tenantId,
  });

  // 4. Merge domain update into state first so the feed is always appended
  //    to the post-update state — deterministic for replay.
  const stateAfterDomain: BoardStoreState = { ...state, ...domainUpdate };
  const activityUpdate = appendActivityEntry(stateAfterDomain, entry);

  // 5. Return the combined partial update.
  return { ...domainUpdate, ...activityUpdate };
}
