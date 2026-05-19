import type { BoardState, WsEvent } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import { applyEvent as dispatcherApplyEvent } from "./dispatcher";
import { telemetry } from "../../devtools/logEvent";

// R9 — imported from the store module so the constant is defined in one place.
// If the store constant is not exported we use the same value inline.
const BUFFER_HARD_LIMIT = 200;

/**
 * 🧠 The Reconciliation Engine (موتور تطبیق رویدادها)
 */
export function reconcileIncomingEvent(
  state: BoardState,
  wsEvent: WsEvent
): Partial<BoardState> | null {
  const currentSeq = BigInt(state.boardSequence);
  const eventSeq = BigInt(wsEvent.sequence);

  // ======================================================================
  // ۱. Idempotency (جلوگیری از پردازش تکراری / ایونت‌های قدیمی)
  // ======================================================================
  if (eventSeq <= currentSeq) {
    // 🌟 سنسور ۱: شکار ایونت‌های تکراری یا جا مانده
    telemetry.log(
      "RECONCILER",
      "DUPLICATE_OR_STALE_IGNORED",
      { eventSeq: wsEvent.sequence, currentSeq: state.boardSequence },
      { sequence: wsEvent.sequence, correlationId: wsEvent.payload.correlationId }
    );
    return null; 
  }

  // ======================================================================
  // ۲. Reconciliation (تطبیق با تراکنش‌های خوش‌بینانه‌ی کلاینت)
  // ======================================================================
  const correlationId = wsEvent.payload.correlationId;
  let nextPendingMutations = state.pendingMutations;
  
  if (correlationId && state.pendingMutations[correlationId]) {
    // 🌟 سنسور ۲: سرور تغییر خوش‌بینانه‌ی ما را تایید کرد (ACK)
    telemetry.mutation(correlationId, wsEvent.payload.type, "ACKED");
    
    nextPendingMutations = { ...state.pendingMutations };
    delete nextPendingMutations[correlationId];
  }

  // ======================================================================
  // ۳. Gap Detection (تشخیص قطعی اینترنت یا جا ماندن پیام‌ها)
  // ======================================================================
  if (eventSeq > currentSeq + 1n) {
    const nextBuffer = {
      ...state.bufferedEvents,
      [wsEvent.sequence]: wsEvent,
    };

    const bufferSize = Object.keys(nextBuffer).length;

    // 🌟 سنسور ۳: شکار قطعی شبکه و Out-of-Order Delivery
    telemetry.log(
      "RECONCILER",
      "SEQUENCE_GAP_BUFFERED",
      { eventSeq: wsEvent.sequence, expectedSeq: String(currentSeq + 1n), bufferSize },
      { sequence: wsEvent.sequence }
    );

    // R9 — Hard limit: if the buffer grows beyond BUFFER_HARD_LIMIT the client
    // is too far behind for incremental catch-up.  Force a full resync.
    const syncStatus =
      bufferSize >= BUFFER_HARD_LIMIT
        ? "desynced"
        : bufferSize > 50
        ? "gap_detected"
        : "gap_detected";

    return {
      bufferedEvents: nextBuffer,
      syncStatus,
      pendingMutations: nextPendingMutations,
    };
  }

  // ======================================================================
  // ۴. Apply Incoming Event (اعمال رویداد فعلی)
  // ======================================================================
  const envelope: ClientEventEnvelope = {
    event: wsEvent.payload,
    acknowledged: true,
  };

  let nextState: BoardState = {
    ...state,
    ...dispatcherApplyEvent(state, envelope, { mode: "live" }),
    boardSequence: wsEvent.sequence,
    syncStatus: "healthy",
    pendingMutations: nextPendingMutations,
  };

  // ======================================================================
  // ۵. Drain Buffered Events (تخلیه بافر)
  // ======================================================================
  let bufferChanged = false;
  const nextBuffer = { ...nextState.bufferedEvents };

  const pendingSequences = Object.keys(nextBuffer).sort((a, b) =>
    Number(BigInt(a) - BigInt(b))
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
      const bufferedEvent = nextBuffer[seqStr];
      const bufCorrelationId = bufferedEvent.payload.correlationId;
      
      if (bufCorrelationId && nextState.pendingMutations[bufCorrelationId]) {
        // 🌟 سنسور برای تخلیه بافر (ACK)
        telemetry.mutation(bufCorrelationId, bufferedEvent.payload.type, "ACKED");
        const updatedPending = { ...nextState.pendingMutations };
        delete updatedPending[bufCorrelationId];
        nextState.pendingMutations = updatedPending;
      }

      const bufferedEnvelope: ClientEventEnvelope = {
        event: bufferedEvent.payload,
        acknowledged: true,
      };

      // 🌟 سنسور ۴: مانیتور کردن اجرای ایونت‌های معلق از بافر
      telemetry.log(
        "RECONCILER",
        "BUFFER_DRAINED",
        { eventSeq: bufferedEvent.sequence },
        { sequence: bufferedEvent.sequence }
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
    break;
  }

  if (bufferChanged) {
    nextState.bufferedEvents = nextBuffer;
  }

  return nextState;
}