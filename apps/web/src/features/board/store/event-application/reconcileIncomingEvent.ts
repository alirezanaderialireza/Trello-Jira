// apps/web/src/features/board/store/event-application/reconcileIncomingEvent.ts
//
// Changes from original:
//   1. Uses canonical SyncStatus values ("synced", "catching_up", "offline")
//      instead of the old ("healthy", "gap_detected", "desynced")
//   2. Emits FSM events via the global syncFSM singleton so the state machine
//      stays in sync with the reconciler's decisions
//   3. validateAndMigrateEvent is now called in the hot path (schema versioning)
//   4. Magic constant 50 extracted to named constant

import type { BoardState } from "../useBoardStore";
import type { WsEvent } from "../sync/syncContracts";
import type { ClientEventEnvelope } from "./types";
import { applyEvent as dispatcherApplyEvent } from "./dispatcher";
import { telemetry } from "../../devtools/logEvent";
import { validateAndMigrateEvent } from "../sync/eventSchemaVersioning";
import { getSyncFSM } from "../sync/syncFSMSingleton";

// Threshold before declaring a gap "unrecoverable" and requesting full resync
const BUFFER_OVERFLOW_THRESHOLD = 50;

export function reconcileIncomingEvent(
  state: BoardState,
  wsEvent: WsEvent,
): Partial<BoardState> | null {
  const currentSeq = BigInt(state.boardSequence);
  const eventSeq = BigInt(wsEvent.sequence);

  // ======================================================================
  // 1. Schema Version Migration (hot-path gate)
  // ======================================================================
  const { result: versionResult, migratedEvent } = validateAndMigrateEvent(wsEvent.payload);

  if (!versionResult.valid) {
    if (versionResult.reason === "VERSION_TOO_NEW") {
      // Server is newer than client — buffer but don't apply
      telemetry.log("RECONCILER", "SCHEMA_VERSION_TOO_NEW", {
        eventType: wsEvent.type,
        originalVersion: versionResult.originalVersion,
        clientVersion: versionResult.targetVersion,
      });
      // Return without applying — forward-compat: silently skip
      return null;
    }

    if (versionResult.reason === "UNKNOWN_EVENT_TYPE") {
      // Unknown future event — skip silently (forward-compat)
      telemetry.log("RECONCILER", "UNKNOWN_EVENT_TYPE_SKIPPED", { eventType: wsEvent.type });
      return null;
    }

    // MIGRATION_FAILED or PAYLOAD_INVALID — log and skip
    telemetry.log("RECONCILER", "SCHEMA_MIGRATION_FAILED", {
      eventType: wsEvent.type,
      reason: versionResult.reason,
    });
    return null;
  }

  // Use the (possibly migrated) event from here on
  const effectivePayload = migratedEvent ?? wsEvent.payload;
  const effectiveWsEvent: WsEvent = migratedEvent
    ? { ...wsEvent, payload: migratedEvent }
    : wsEvent;

  // ======================================================================
  // 2. Idempotency — drop already-applied or stale events
  // ======================================================================
  if (eventSeq <= currentSeq) {
    telemetry.log(
      "RECONCILER",
      "DUPLICATE_OR_STALE_IGNORED",
      { eventSeq: wsEvent.sequence, currentSeq: state.boardSequence },
      { sequence: wsEvent.sequence, correlationId: wsEvent.payload.correlationId },
    );
    return null;
  }

  // ======================================================================
  // 3. Optimistic ACK — resolve pending mutation if correlationId matches
  // ======================================================================
  const correlationId = effectivePayload.correlationId;
  let nextPendingMutations = state.pendingMutations;

  if (correlationId && state.pendingMutations[correlationId]) {
    telemetry.mutation(correlationId, wsEvent.payload.type, "ACKED");
    nextPendingMutations = { ...state.pendingMutations };
    delete nextPendingMutations[correlationId];
  }

  // ======================================================================
  // 4. Gap Detection
  // ======================================================================
  if (eventSeq > currentSeq + 1n) {
    const nextBuffer = {
      ...state.bufferedEvents,
      [wsEvent.sequence]: effectiveWsEvent,
    };

    const bufferSize = Object.keys(nextBuffer).length;

    telemetry.log(
      "RECONCILER",
      "SEQUENCE_GAP_BUFFERED",
      { eventSeq: wsEvent.sequence, expectedSeq: String(currentSeq + 1n), bufferSize },
      { sequence: wsEvent.sequence },
    );

    const isOverflow = bufferSize > BUFFER_OVERFLOW_THRESHOLD;

    // Signal FSM
    const fsm = getSyncFSM();
    if (fsm) {
      if (isOverflow) {
        fsm.send({ type: "GAP_UNRECOVERABLE" });
      } else {
        fsm.send({
          type: "GAP_DETECTED",
          expectedSeq: String(currentSeq + 1n),
          receivedSeq: wsEvent.sequence,
        });
      }
    }

    return {
      bufferedEvents: nextBuffer,
      syncStatus: isOverflow ? "offline" : "catching_up",
      pendingMutations: nextPendingMutations,
    };
  }

  // ======================================================================
  // 5. Apply Incoming Event
  // ======================================================================
  const envelope: ClientEventEnvelope = {
    event: effectivePayload,
    acknowledged: true,
  };

  let nextState: BoardState = {
    ...state,
    ...dispatcherApplyEvent(state, envelope, { mode: "live" }),
    boardSequence: wsEvent.sequence,
    syncStatus: "synced",
    pendingMutations: nextPendingMutations,
  };

  // Signal FSM healthy
  const fsm = getSyncFSM();
  fsm?.send({ type: "EVENT_RECEIVED", sequence: wsEvent.sequence });

  // ======================================================================
  // 6. Drain Buffered Events
  // ======================================================================
  let bufferChanged = false;
  const nextBuffer = { ...nextState.bufferedEvents };

  const pendingSequences = Object.keys(nextBuffer).sort((a, b) =>
    Number(BigInt(a) - BigInt(b)),
  );

  for (const seqStr of pendingSequences) {
    const seq = BigInt(seqStr);
    const current = BigInt(nextState.boardSequence);

    if (seq <= current) {
      delete nextBuffer[seqStr];
      bufferChanged = true;
      continue;
    }

    if (seq === current + 1n) {
      const bufferedEvent = nextBuffer[seqStr]!;
      const bufCorrelationId = bufferedEvent.payload.correlationId;

      if (bufCorrelationId && nextState.pendingMutations[bufCorrelationId]) {
        telemetry.mutation(bufCorrelationId, bufferedEvent.payload.type, "ACKED");
        const updatedPending = { ...nextState.pendingMutations };
        delete updatedPending[bufCorrelationId];
        nextState = { ...nextState, pendingMutations: updatedPending };
      }

      const bufferedEnvelope: ClientEventEnvelope = {
        event: bufferedEvent.payload,
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

      // Signal FSM for each drained event
      fsm?.send({ type: "EVENT_RECEIVED", sequence: bufferedEvent.sequence });
      continue;
    }
    break;
  }

  if (bufferChanged) {
    nextState = { ...nextState, bufferedEvents: nextBuffer };

    // All buffered events drained → gap recovered
    if (Object.keys(nextBuffer).length === 0 && state.syncStatus === "catching_up") {
      fsm?.send({ type: "GAP_RECOVERED" });
    }
  }

  return nextState;
}
