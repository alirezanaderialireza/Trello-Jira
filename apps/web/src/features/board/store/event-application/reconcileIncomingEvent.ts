// apps/web/src/features/board/store/event-application/reconcileIncomingEvent.ts
//
// ============================================================================
// 🧠 Reconciliation Engine — Upgraded for Phase 2
// ============================================================================
//
// Changes from Phase 1:
// ─────────────────────
//
// 1. CATCH_UP_MAX_EVENTS threshold (was BUFFER_HARD_LIMIT only)
//    The old code only had one level: buffer > 50 → gap_detected, > 200 →
//    desynced.  Now we have a graduated scale:
//      • 0–49 buffered   → gap_detected  (catch-up in progress, no alarm)
//      • 50–199 buffered → gap_detected  (still catchable but warn)
//      • ≥ 200 buffered  → desynced      (force full resync)
//    This matches the CATCH_UP_MAX_EVENTS constant that the task list requires.
//
// 2. Aggregate-bound replay safety
//    When draining the buffer, we now check each buffered event against the
//    aggregate's current revision in the store.  If the event.version is ≤
//    the aggregate's current revision it is a stale replay — drop it.
//    This prevents double-application during reconnect catch-up.
//
// 3. Gap recovery telemetry
//    When the buffer is successfully drained to zero (gap_resolved) we emit
//    a telemetry event and set syncStatus back to "healthy".
//    Previously the store only cleared syncStatus to "healthy" on the NEXT
//    in-order event, missing the case where the last buffered event drains
//    the entire buffer.
//
// 4. Idempotency hardening
//    Duplicate event detection now also checks event.id (if available) against
//    a bounded seen-set.  This prevents double-application in the rare case
//    where the server replays an event that the client has already applied
//    but whose sequence number was not yet bumped (e.g., crash-recovery replay
//    from lastSequence = currentSeq).
//
// What has NOT changed:
//   • Reducer invocation path (still pure, via dispatcher.applyEvent)
//   • ACK logic (still removes from pendingMutations on correlationId match)
//   • BigInt sequence comparison
// ============================================================================

import type { BoardState, WsEvent } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import { applyEvent as dispatcherApplyEvent } from "./dispatcher";
import { telemetry } from "../../devtools/logEvent";

// ============================================================================
// ⚙️ Constants
// ============================================================================

/** Buffer size at which catch-up is still feasible (warn only) */
const CATCH_UP_WARN_THRESHOLD = 50;

/**
 * Buffer size beyond which incremental catch-up is not feasible.
 * Triggers a full resync (syncStatus = "desynced").
 */
const CATCH_UP_MAX_EVENTS = 200;

/**
 * Bounded dedup window: track the last N event IDs seen to prevent
 * double-application during reconnect replays that overlap with the
 * already-applied range.
 */
const DEDUP_WINDOW_SIZE = 64;

// ============================================================================
// 🔁 Bounded Event-ID Dedup Cache
// ============================================================================
// Module-level (not in state) because:
//   1. It only needs to survive the current browser session
//   2. It must not be part of the Zustand snapshot (not serializable)
//   3. A rolling array is O(1) amortised for push + bounded memory

const _seenEventIds: string[] = [];

function _markSeen(eventId: string): void {
  if (_seenEventIds.length >= DEDUP_WINDOW_SIZE) {
    _seenEventIds.shift(); // drop oldest
  }
  _seenEventIds.push(eventId);
}

function _alreadySeen(eventId: string): boolean {
  return _seenEventIds.includes(eventId);
}

// ============================================================================
// 🧠 reconcileIncomingEvent
// ============================================================================

export function reconcileIncomingEvent(
  state: BoardState,
  wsEvent: WsEvent
): Partial<BoardState> | null {
  const currentSeq = BigInt(state.boardSequence);
  const eventSeq   = BigInt(wsEvent.sequence);

  // ==========================================================================
  // 1. Sequence-level Idempotency
  // ==========================================================================
  if (eventSeq <= currentSeq) {
    telemetry.log(
      "RECONCILER",
      "DUPLICATE_OR_STALE_IGNORED",
      { eventSeq: wsEvent.sequence, currentSeq: state.boardSequence },
      { sequence: wsEvent.sequence, correlationId: wsEvent.payload.correlationId },
    );
    return null;
  }

  // ==========================================================================
  // 2. Event-ID Idempotency (dedup window)
  //
  // Guards against reconnect replays where the server re-sends events that the
  // client has already applied (sequence already advanced past them) but whose
  // sequence numbers overlap with the catch-up window.
  // ==========================================================================
  const eventId = wsEvent.payload.id;
  if (eventId && _alreadySeen(eventId)) {
    telemetry.log(
      "RECONCILER",
      "EVENT_ID_DEDUP_DROPPED",
      { eventId, eventSeq: wsEvent.sequence },
      { sequence: wsEvent.sequence, correlationId: wsEvent.payload.correlationId },
    );
    return null;
  }

  // ==========================================================================
  // 3. Optimistic ACK — remove matched pending mutation
  // ==========================================================================
  const correlationId = wsEvent.payload.correlationId;
  let nextPendingMutations = state.pendingMutations;

  if (correlationId && state.pendingMutations[correlationId]) {
    telemetry.mutation(correlationId, wsEvent.payload.type, "ACKED");

    nextPendingMutations = { ...state.pendingMutations };
    delete nextPendingMutations[correlationId];
  }

  // ==========================================================================
  // 4. Gap Detection
  // ==========================================================================
  if (eventSeq > currentSeq + 1n) {
    const nextBuffer = {
      ...state.bufferedEvents,
      [wsEvent.sequence]: wsEvent,
    };

    const bufferSize = Object.keys(nextBuffer).length;

    telemetry.log(
      "RECONCILER",
      "SEQUENCE_GAP_BUFFERED",
      {
        eventSeq:    wsEvent.sequence,
        expectedSeq: String(currentSeq + 1n),
        bufferSize,
      },
      { sequence: wsEvent.sequence },
    );

    // Graduated scale
    const syncStatus =
      bufferSize >= CATCH_UP_MAX_EVENTS
        ? "desynced"     // full resync required
        : "gap_detected"; // catch-up in progress

    if (bufferSize >= CATCH_UP_MAX_EVENTS) {
      telemetry.log("RECONCILER", "CATCH_UP_MAX_EXCEEDED", {
        bufferSize,
        threshold: CATCH_UP_MAX_EVENTS,
      });
    } else if (bufferSize >= CATCH_UP_WARN_THRESHOLD) {
      telemetry.log("RECONCILER", "CATCH_UP_WARN_THRESHOLD_REACHED", {
        bufferSize,
        threshold: CATCH_UP_WARN_THRESHOLD,
      });
    }

    return {
      bufferedEvents:    nextBuffer,
      syncStatus,
      pendingMutations:  nextPendingMutations,
    };
  }

  // ==========================================================================
  // 5. Apply In-Order Event
  // ==========================================================================
  if (eventId) _markSeen(eventId);

  const envelope: ClientEventEnvelope = {
    event:        wsEvent.payload,
    acknowledged: true,
  };

  let nextState: BoardState = {
    ...state,
    ...dispatcherApplyEvent(state, envelope, { mode: "live" }),
    boardSequence:     wsEvent.sequence,
    syncStatus:        "healthy",
    pendingMutations:  nextPendingMutations,
  };

  // ==========================================================================
  // 6. Buffer Drain (Catch-Up)
  //
  // After applying the current event, attempt to drain consecutive buffered
  // events in sequence order.
  //
  // Aggregate-bound replay safety:
  //   Before applying each buffered event, we check whether the aggregate it
  //   targets has already been advanced past this event's version in the
  //   current nextState.  If so, the event is a stale replay — skip it but
  //   still advance boardSequence so the gap is closed.
  // ==========================================================================
  let bufferChanged = false;
  const nextBuffer  = { ...nextState.bufferedEvents };

  const pendingSequences = Object.keys(nextBuffer)
    .sort((a, b) => Number(BigInt(a) - BigInt(b)));

  for (const seqStr of pendingSequences) {
    const seq     = BigInt(seqStr);
    const current = BigInt(nextState.boardSequence);

    // Stale buffered event (already applied or passed by a direct event)
    if (seq <= current) {
      delete nextBuffer[seqStr];
      bufferChanged = true;
      continue;
    }

    // Not yet ready
    if (seq !== current + 1n) break;

    const bufferedEvent    = nextBuffer[seqStr];
    const bufEventId       = bufferedEvent.payload.id;
    const bufCorrelationId = bufferedEvent.payload.correlationId;

    // ── Event-ID dedup for buffered events ──────────────────────────────
    if (bufEventId && _alreadySeen(bufEventId)) {
      telemetry.log(
        "RECONCILER",
        "BUFFERED_EVENT_ID_DEDUP_DROPPED",
        { eventId: bufEventId, eventSeq: seqStr },
      );
      // Still advance sequence so the gap closes
      nextState = { ...nextState, boardSequence: seqStr };
      delete nextBuffer[seqStr];
      bufferChanged = true;
      continue;
    }

    // ── Aggregate-bound stale check ──────────────────────────────────────
    //
    // For card and list events, the reducer itself guards stale versions
    // (applyCardUpdated uses revision >).  This check is a belt-and-suspenders
    // guard at the reconciler level to prevent redundant dispatcher calls.
    //
    // We only skip at the reconciler level if we can determine the aggregate
    // is ahead WITHOUT calling the reducer.  Reducer-internal guards remain.
    const aggregateId = bufferedEvent.payload.aggregateId;
    const eventVersion = bufferedEvent.payload.version;

    if (aggregateId && typeof eventVersion === "number") {
      const card = nextState.cards[aggregateId];
      const list = nextState.lists[aggregateId];
      const aggregate = card ?? list;

      if (aggregate && aggregate.revision >= eventVersion) {
        telemetry.log(
          "RECONCILER",
          "BUFFERED_STALE_AGGREGATE_SKIPPED",
          {
            aggregateId,
            eventVersion,
            currentRevision: aggregate.revision,
            eventSeq: seqStr,
          },
        );
        nextState = { ...nextState, boardSequence: seqStr };
        delete nextBuffer[seqStr];
        bufferChanged = true;
        continue;
      }
    }

    // ── ACK for buffered event ───────────────────────────────────────────
    if (bufCorrelationId && nextState.pendingMutations[bufCorrelationId]) {
      telemetry.mutation(bufCorrelationId, bufferedEvent.payload.type, "ACKED");
      const updatedPending = { ...nextState.pendingMutations };
      delete updatedPending[bufCorrelationId];
      nextState = { ...nextState, pendingMutations: updatedPending };
    }

    // ── Apply buffered event ─────────────────────────────────────────────
    if (bufEventId) _markSeen(bufEventId);

    const bufferedEnvelope: ClientEventEnvelope = {
      event:        bufferedEvent.payload,
      acknowledged: true,
    };

    telemetry.log(
      "RECONCILER",
      "BUFFER_DRAINED",
      { eventSeq: seqStr },
      { sequence: seqStr },
    );

    nextState = {
      ...nextState,
      ...dispatcherApplyEvent(nextState, bufferedEnvelope, { mode: "live" }),
      boardSequence: seqStr,
    };

    delete nextBuffer[seqStr];
    bufferChanged = true;
  }

  if (bufferChanged) {
    nextState = { ...nextState, bufferedEvents: nextBuffer };
  }

  // ==========================================================================
  // 7. Gap-Resolved Detection
  //
  // If the buffer is now empty AND syncStatus was gap_detected, we've fully
  // caught up.  Emit a telemetry event and ensure syncStatus = "healthy".
  // ==========================================================================
  const prevSyncStatus = state.syncStatus;
  const bufferNowEmpty = Object.keys(nextState.bufferedEvents).length === 0;

  if (prevSyncStatus === "gap_detected" && bufferNowEmpty) {
    telemetry.log("RECONCILER", "GAP_RESOLVED", {
      resolvedAtSeq: nextState.boardSequence,
    });
    nextState = { ...nextState, syncStatus: "healthy" };
  }

  return nextState;
}
