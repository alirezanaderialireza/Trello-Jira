// apps/web/src/features/board/store/test-utils/replayEvents.ts
//
// Phase-0 replay engine — prerequisite for Phase 1.
//
// Verifies the core determinism guarantee:
//
//   same snapshot + same events (in same order) = same final state
//   ∀ n ≥ 1: replayEvents(snapshot, events, n).finalState is identical
//
// NOTE: This module intentionally avoids importing zustand / devtools
//       so it can run in a pure unit test environment (vitest without
//       zustand installed as a test dependency).

import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import {
  validateStoreInvariants,
} from "../invariants";

// Pure reducer imports (no zustand dependency)
import { applyCardMoved }   from "../event-application/applyCardMoved";
import { applyCardCreated } from "../event-application/applyCardCreated";
import { applyCardUpdated } from "../event-application/applyCardUpdated";
import { applyCardDeleted } from "../event-application/applyCardDeleted";
import { applyListCreated } from "../event-application/applyListCreated";
import { applyListMoved }   from "../event-application/applyListMoved";
import { applyListUpdated } from "../event-application/applyListUpdated";
import { applyListDeleted } from "../event-application/applyListDeleted";
import type { ReducerContext } from "../event-application/context";
import type { AppDomainEvent } from "@repo/domain";

// ============================================================================
// Types
// ============================================================================

export type AnyEnvelope = ClientEventEnvelope;

export interface ReplayResult {
  /** State after all events have been applied */
  finalState:  BoardStoreState;
  /** Per-event intermediate states (for debugging) */
  snapshots:   BoardStoreState[];
  /** All invariant violations encountered during replay */
  violations:  string[];
}

// ============================================================================
// Inline dispatcher (no zustand / telemetry deps)
// ============================================================================

type Reducer = (
  state: BoardStoreState,
  envelope: ClientEventEnvelope,
  ctx: ReducerContext,
) => Partial<BoardStoreState>;

const HANDLERS: Record<string, Reducer> = {
  "card.moved":    applyCardMoved   as Reducer,
  "card.created":  applyCardCreated as Reducer,
  "card.updated":  applyCardUpdated as Reducer,
  "card.deleted":  applyCardDeleted as Reducer,
  "list.created":  applyListCreated as Reducer,
  "list.moved":    applyListMoved   as Reducer,
  "list.updated":  applyListUpdated as Reducer,
  "list.deleted":  applyListDeleted as Reducer,
};

function applyEnvelope(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope,
  ctx:      ReducerContext,
): Partial<BoardStoreState> {
  const handler = HANDLERS[envelope.event.type as keyof typeof HANDLERS];
  if (!handler) return {};
  try {
    return handler(state, envelope, ctx);
  } catch {
    return {};
  }
}

// ============================================================================
// Core replay function
// ============================================================================

/**
 * Apply `events` to `snapshot` in order and return the final state.
 *
 * Validates store invariants after every event application.
 * Throws if the final state differs across multiple runs (non-determinism).
 *
 * @param snapshot  Starting state
 * @param events    Ordered list of events to apply
 * @param times     Number of times to run the replay (all must produce identical state)
 * @param expected  Optional expected final state for explicit assertion
 */
export function replayEvents(
  snapshot:  BoardStoreState,
  events:    AnyEnvelope[],
  times = 1,
  expected?: BoardStoreState,
): ReplayResult {
  const ctx: ReducerContext = { mode: "live" };

  let firstResult: ReplayResult | null = null;

  for (let run = 0; run < times; run++) {
    const result = runOnce(snapshot, events, ctx);

    if (firstResult === null) {
      firstResult = result;
    } else {
      // Determinism check: every run must produce identical state
      const a = JSON.stringify(firstResult.finalState);
      const b = JSON.stringify(result.finalState);

      if (a !== b) {
        throw new Error(
          `[replayEvents] Non-determinism detected on run ${run + 1}:\n` +
          `  Run 1:      ${a.slice(0, 200)}\n` +
          `  Run ${run + 1}: ${b.slice(0, 200)}`,
        );
      }
    }
  }

  const result = firstResult!;

  // Explicit assertion against expected state
  if (expected !== undefined) {
    const actual    = JSON.stringify(result.finalState);
    const expected_ = JSON.stringify(expected);
    if (actual !== expected_) {
      throw new Error(
        `[replayEvents] Final state does not match expected:\n` +
        `  Expected: ${expected_.slice(0, 300)}\n` +
        `  Actual:   ${actual.slice(0, 300)}`,
      );
    }
  }

  return result;
}

// ============================================================================
// Internal single-run engine
// ============================================================================

function runOnce(
  snapshot: BoardStoreState,
  events:   AnyEnvelope[],
  ctx:      ReducerContext,
): ReplayResult {
  let state: BoardStoreState = structuredClone(snapshot);
  const snapshots: BoardStoreState[] = [structuredClone(state)];
  const violations: string[] = [];

  for (const envelope of events) {
    const partial = applyEnvelope(state, envelope, ctx);
    state = { ...state, ...partial };

    // Validate invariants after each event
    const result = validateStoreInvariants(state);
    if (!result.valid) {
      violations.push(
        ...result.violations.map((v) =>
          `[${v.invariant}] after ${envelope.event.type}: ${v.message}`,
        ),
      );
    }

    snapshots.push(structuredClone(state));
  }

  return { finalState: state, snapshots, violations };
}
