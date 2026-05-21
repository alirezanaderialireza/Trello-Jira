// apps/web/src/features/board/store/event-application/reconcileIncomingEvent.ts
//
// Phase-0 fixes applied:
//   #2 — Use parseSequence() / isContiguous() / isStaleOrDuplicate() instead
//        of raw BigInt() calls. BigInt("") throws; parseSequence returns 0n.
//   Kept all existing telemetry; only the BigInt call-sites changed.

import type { BoardState } from "../useBoardStore";
import type { WsEvent }    from "../../api/realtime/types";
import type { ClientEventEnvelope } from "./types";
import { applyEvent as dispatcherApplyEvent } from "./dispatcher";
import { telemetry } from "../../devtools/logEvent";
import {
  parseSequence,
  sequenceToString,
  isStaleOrDuplicate,
  isContiguous,
  compareSequences,
} from "./sequence";

// ============================================================================
// Reconciliation Engine
// ============================================================================

export function reconcileIncomingEvent(
  state: BoardState,
  wsEvent: WsEvent,
): Partial<BoardState> | null {

  // ── 1. Idempotency guard ─────────────────────────────────────────────────
  if (isStaleOrDuplicate(state.boardSequence, wsEvent.sequence)) {
    telemetry.log(
      "RECONCILER",
      "DUPLICATE_OR_STALE_IGNORED",
      { eventSeq: wsEvent.sequence, currentSeq: state.boardSequence },
      { sequence: wsEvent.sequence, correlationId: wsEvent.payload.correlationId },
    );
    return null;
  }

  // ── 2. ACK reconciliation ────────────────────────────────────────────────
  const correlationId     = wsEvent.payload.correlationId;
  let nextPendingMutations = state.pendingMutations;

  if (correlationId && state.pendingMutations[correlationId]) {
    telemetry.mutation(correlationId, wsEvent.payload.type, "ACKED");
    nextPendingMutations = { ...state.pendingMutations };
    delete nextPendingMutations[correlationId];
  }

  // ── 3. Gap detection ─────────────────────────────────────────────────────
  if (!isContiguous(state.boardSequence, wsEvent.sequence)) {
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
        expectedSeq: sequenceToString(parseSequence(state.boardSequence) + 1n),
        bufferSize,
      },
      { sequence: wsEvent.sequence },
    );

    return {
      bufferedEvents:   nextBuffer,
      syncStatus:       bufferSize > 50 ? "desynced" : "gap_detected",
      pendingMutations: nextPendingMutations,
    };
  }

  // ── 4. Apply current event ───────────────────────────────────────────────
  const envelope: ClientEventEnvelope = {
    event:        wsEvent.payload,
    acknowledged: true,
  };

  let nextState: BoardState = {
    ...state,
    ...dispatcherApplyEvent(state, envelope, { mode: "live" }),
    boardSequence:    wsEvent.sequence,
    syncStatus:       "healthy",
    pendingMutations: nextPendingMutations,
  };

  // ── 5. Drain buffer ──────────────────────────────────────────────────────
  let bufferChanged = false;
  const nextBuffer  = { ...nextState.bufferedEvents };

  // Sort buffered keys ascending using safe comparison
  const pendingSeqs = Object.keys(nextBuffer).sort(compareSequences);

  for (const seqStr of pendingSeqs) {
    if (isStaleOrDuplicate(nextState.boardSequence, seqStr)) {
      delete nextBuffer[seqStr];
      bufferChanged = true;
      continue;
    }

    if (isContiguous(nextState.boardSequence, seqStr)) {
      const bufferedEvent  = nextBuffer[seqStr]!;
      const bufCorrId      = bufferedEvent.payload.correlationId;

      if (bufCorrId && nextState.pendingMutations[bufCorrId]) {
        telemetry.mutation(bufCorrId, bufferedEvent.payload.type, "ACKED");
        const updatedPending = { ...nextState.pendingMutations };
        delete updatedPending[bufCorrId];
        nextState.pendingMutations = updatedPending;
      }

      const bufferedEnvelope: ClientEventEnvelope = {
        event:        bufferedEvent.payload,
        acknowledged: true,
      };

      telemetry.log(
        "RECONCILER",
        "BUFFER_DRAINED",
        { eventSeq: bufferedEvent.sequence },
        { sequence: bufferedEvent.sequence },
      );

      nextState = {
        ...nextState,
        ...dispatcherApplyEvent(nextState, bufferedEnvelope, { mode: "live" }),
        boardSequence: bufferedEvent.sequence,
      };

      delete nextBuffer[seqStr];
      bufferChanged = true;
      continue;
    }

    // Gap still present — stop draining
    break;
  }

  if (bufferChanged) {
    nextState.bufferedEvents = nextBuffer;
  }

  return nextState;
}
