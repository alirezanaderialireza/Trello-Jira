// apps/web/src/features/board/store/sync/syncStateMachine.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Deterministic Finite State Machine for the board synchronization lifecycle.
//
// States:
//   IDLE        — No board loaded yet.
//   CONNECTING  — WebSocket handshake in progress.
//   HEALTHY     — Connected, sequence monotonic, no gaps.
//   GAP         — Sequence gap detected, buffering events, waiting for fill.
//   REPLAYING   — Incremental replay in progress (catch-up after reconnect).
//   DESYNCED    — Unrecoverable gap or timeout; full resync required.
//   RECONNECTING— WS dropped, attempting reconnect with backoff.
//
// Transitions are explicit, typed, and exhaustive — no implicit state changes.
// Each transition emits a SyncEffect that the effect runner executes.
//
// ─── Actor model ─────────────────────────────────────────────────────────────
// The FSM processes messages via a synchronous mailbox (same pattern as
// PositioningEngine). This guarantees serialized transitions regardless of
// concurrent WS callbacks, tab messages, or timer firings.
//
// ─── Integration ─────────────────────────────────────────────────────────────
//   • BoardSocketClient sends messages: WS_CONNECTED, WS_CLOSED, EVENT_RECEIVED
//   • reconcileIncomingEvent's gap detection maps to: GAP_DETECTED
//   • replayEngine completion maps to: REPLAY_COMPLETE
//   • useBoardStore.syncStatus is kept in sync via effect runner
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • Pure transitions — `transition(state, message)` is a pure function.
//   • Effects are returned as data — not executed inline (testable).
//   • No React dependency — pure class.
//   • Observable — every transition logged to telemetry.
// ─────────────────────────────────────────────────────────────────────────────

import { telemetry } from "../../devtools/logEvent";

// ============================================================================
// 1.  States
// ============================================================================

export type SyncState =
  | "IDLE"
  | "CONNECTING"
  | "HEALTHY"
  | "GAP"
  | "REPLAYING"
  | "DESYNCED"
  | "RECONNECTING";

// ============================================================================
// 2.  Messages (inputs to the FSM)
// ============================================================================

export type SyncMessage =
  | { type: "CONNECT_REQUESTED"; boardId: string }
  | { type: "WS_CONNECTED" }
  | { type: "WS_CLOSED"; code: number; reason: string }
  | { type: "WS_ERROR" }
  | { type: "EVENT_RECEIVED"; sequence: string }
  | { type: "GAP_DETECTED"; expectedSeq: string; receivedSeq: string; bufferSize: number }
  | { type: "GAP_FILLED" }
  | { type: "GAP_TIMEOUT" }
  | { type: "REPLAY_STARTED" }
  | { type: "REPLAY_COMPLETE"; finalSequence: string }
  | { type: "REPLAY_FAILED"; reason: string }
  | { type: "RESYNC_REQUIRED" }
  | { type: "RECONNECT_ATTEMPT"; attempt: number }
  | { type: "RECONNECT_EXHAUSTED" }
  | { type: "DISCONNECT_REQUESTED" };

// ============================================================================
// 3.  Effects (outputs from transitions — executed by the effect runner)
// ============================================================================

export type SyncEffect =
  | { type: "UPDATE_STORE_STATUS"; status: "healthy" | "gap_detected" | "reconnecting" | "desynced" }
  | { type: "START_GAP_TIMER"; timeoutMs: number }
  | { type: "CANCEL_GAP_TIMER" }
  | { type: "REQUEST_CATCH_UP"; fromSequence: string; toSequence: string }
  | { type: "START_REPLAY"; fromSequence: string }
  | { type: "SCHEDULE_RECONNECT"; attempt: number; delayMs: number }
  | { type: "CANCEL_RECONNECT" }
  | { type: "TRIGGER_FULL_RESYNC" }
  | { type: "LOG"; action: string; data: Record<string, unknown> };

// ============================================================================
// 4.  Transition result
// ============================================================================

export interface TransitionResult {
  /** The new state after this transition. */
  readonly nextState: SyncState;
  /** Effects to execute (in order). */
  readonly effects: readonly SyncEffect[];
}

// ============================================================================
// 5.  Constants
// ============================================================================

const GAP_TIMEOUT_MS            = 10_000;  // 10s before declaring gap unrecoverable
const MAX_BUFFER_BEFORE_DESYNC  = 50;      // matches reconcileIncomingEvent threshold
const MAX_RECONNECT_ATTEMPTS    = 7;

// ============================================================================
// 6.  Pure transition function
// ============================================================================

/**
 * Pure, deterministic state transition.
 * Given current state + message → next state + effects.
 *
 * This function NEVER mutates anything. It's the core of the FSM and is
 * fully testable in isolation.
 */
export function transition(
  current: SyncState,
  message: SyncMessage,
): TransitionResult {

  switch (current) {
    // ──────────────────────────────────────────────────────────────────────────
    // IDLE
    // ──────────────────────────────────────────────────────────────────────────
    case "IDLE": {
      if (message.type === "CONNECT_REQUESTED") {
        return {
          nextState: "CONNECTING",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "reconnecting" },
            { type: "LOG", action: "FSM_CONNECT_REQUESTED", data: { boardId: message.boardId } },
          ],
        };
      }
      return noTransition(current, message);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // CONNECTING
    // ──────────────────────────────────────────────────────────────────────────
    case "CONNECTING": {
      if (message.type === "WS_CONNECTED") {
        return {
          nextState: "HEALTHY",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "healthy" },
            { type: "CANCEL_RECONNECT" },
            { type: "LOG", action: "FSM_CONNECTED", data: {} },
          ],
        };
      }
      if (message.type === "WS_CLOSED" || message.type === "WS_ERROR") {
        return {
          nextState: "RECONNECTING",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "reconnecting" },
            { type: "SCHEDULE_RECONNECT", attempt: 1, delayMs: 1000 },
            { type: "LOG", action: "FSM_CONNECT_FAILED", data: { code: (message as any).code } },
          ],
        };
      }
      if (message.type === "DISCONNECT_REQUESTED") {
        return { nextState: "IDLE", effects: [{ type: "CANCEL_RECONNECT" }] };
      }
      return noTransition(current, message);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // HEALTHY
    // ──────────────────────────────────────────────────────────────────────────
    case "HEALTHY": {
      if (message.type === "EVENT_RECEIVED") {
        // Normal path — stay healthy.
        return { nextState: "HEALTHY", effects: [] };
      }
      if (message.type === "GAP_DETECTED") {
        return {
          nextState: "GAP",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "gap_detected" },
            { type: "START_GAP_TIMER", timeoutMs: GAP_TIMEOUT_MS },
            { type: "LOG", action: "FSM_GAP_DETECTED", data: {
              expectedSeq: message.expectedSeq,
              receivedSeq: message.receivedSeq,
              bufferSize:  message.bufferSize,
            }},
          ],
        };
      }
      if (message.type === "WS_CLOSED" || message.type === "WS_ERROR") {
        return {
          nextState: "RECONNECTING",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "reconnecting" },
            { type: "SCHEDULE_RECONNECT", attempt: 1, delayMs: 1000 },
            { type: "LOG", action: "FSM_WS_DROPPED", data: { code: (message as any).code } },
          ],
        };
      }
      if (message.type === "RESYNC_REQUIRED") {
        return {
          nextState: "DESYNCED",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "desynced" },
            { type: "TRIGGER_FULL_RESYNC" },
            { type: "LOG", action: "FSM_RESYNC_ORDERED", data: {} },
          ],
        };
      }
      if (message.type === "DISCONNECT_REQUESTED") {
        return { nextState: "IDLE", effects: [] };
      }
      return noTransition(current, message);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // GAP
    // ──────────────────────────────────────────────────────────────────────────
    case "GAP": {
      if (message.type === "GAP_FILLED") {
        return {
          nextState: "HEALTHY",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "healthy" },
            { type: "CANCEL_GAP_TIMER" },
            { type: "LOG", action: "FSM_GAP_FILLED", data: {} },
          ],
        };
      }
      if (message.type === "EVENT_RECEIVED") {
        // Still in gap — events are being buffered by reconcileIncomingEvent.
        return { nextState: "GAP", effects: [] };
      }
      if (message.type === "GAP_TIMEOUT") {
        return {
          nextState: "REPLAYING",
          effects: [
            { type: "CANCEL_GAP_TIMER" },
            { type: "START_REPLAY", fromSequence: "" }, // effect runner fills from store
            { type: "LOG", action: "FSM_GAP_TIMEOUT_REPLAY", data: {} },
          ],
        };
      }
      if (message.type === "GAP_DETECTED") {
        // Additional gap while already in GAP — check buffer overflow.
        if (message.bufferSize > MAX_BUFFER_BEFORE_DESYNC) {
          return {
            nextState: "DESYNCED",
            effects: [
              { type: "UPDATE_STORE_STATUS", status: "desynced" },
              { type: "CANCEL_GAP_TIMER" },
              { type: "TRIGGER_FULL_RESYNC" },
              { type: "LOG", action: "FSM_BUFFER_OVERFLOW_DESYNC", data: { bufferSize: message.bufferSize } },
            ],
          };
        }
        return { nextState: "GAP", effects: [] };
      }
      if (message.type === "WS_CLOSED" || message.type === "WS_ERROR") {
        return {
          nextState: "RECONNECTING",
          effects: [
            { type: "CANCEL_GAP_TIMER" },
            { type: "UPDATE_STORE_STATUS", status: "reconnecting" },
            { type: "SCHEDULE_RECONNECT", attempt: 1, delayMs: 1000 },
          ],
        };
      }
      if (message.type === "DISCONNECT_REQUESTED") {
        return { nextState: "IDLE", effects: [{ type: "CANCEL_GAP_TIMER" }] };
      }
      return noTransition(current, message);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // REPLAYING
    // ──────────────────────────────────────────────────────────────────────────
    case "REPLAYING": {
      if (message.type === "REPLAY_COMPLETE") {
        return {
          nextState: "HEALTHY",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "healthy" },
            { type: "LOG", action: "FSM_REPLAY_COMPLETE", data: { finalSequence: message.finalSequence } },
          ],
        };
      }
      if (message.type === "REPLAY_FAILED") {
        return {
          nextState: "DESYNCED",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "desynced" },
            { type: "TRIGGER_FULL_RESYNC" },
            { type: "LOG", action: "FSM_REPLAY_FAILED", data: { reason: message.reason } },
          ],
        };
      }
      if (message.type === "WS_CLOSED") {
        return {
          nextState: "RECONNECTING",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "reconnecting" },
            { type: "SCHEDULE_RECONNECT", attempt: 1, delayMs: 1000 },
          ],
        };
      }
      if (message.type === "EVENT_RECEIVED") {
        // Events arrive during replay — they'll be applied after replay completes.
        return { nextState: "REPLAYING", effects: [] };
      }
      if (message.type === "DISCONNECT_REQUESTED") {
        return { nextState: "IDLE", effects: [] };
      }
      return noTransition(current, message);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // DESYNCED
    // ──────────────────────────────────────────────────────────────────────────
    case "DESYNCED": {
      if (message.type === "REPLAY_COMPLETE") {
        return {
          nextState: "HEALTHY",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "healthy" },
            { type: "LOG", action: "FSM_RESYNC_RECOVERED", data: { finalSequence: message.finalSequence } },
          ],
        };
      }
      if (message.type === "CONNECT_REQUESTED") {
        return {
          nextState: "CONNECTING",
          effects: [{ type: "UPDATE_STORE_STATUS", status: "reconnecting" }],
        };
      }
      if (message.type === "DISCONNECT_REQUESTED") {
        return { nextState: "IDLE", effects: [] };
      }
      // In DESYNCED, most messages are ignored — the system waits for a manual
      // resync trigger or a REPLAY_COMPLETE from a full fetch.
      return noTransition(current, message);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // RECONNECTING
    // ──────────────────────────────────────────────────────────────────────────
    case "RECONNECTING": {
      if (message.type === "WS_CONNECTED") {
        return {
          nextState: "HEALTHY",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "healthy" },
            { type: "CANCEL_RECONNECT" },
            { type: "LOG", action: "FSM_RECONNECTED", data: {} },
          ],
        };
      }
      if (message.type === "RECONNECT_ATTEMPT") {
        if (message.attempt >= MAX_RECONNECT_ATTEMPTS) {
          return {
            nextState: "DESYNCED",
            effects: [
              { type: "UPDATE_STORE_STATUS", status: "desynced" },
              { type: "CANCEL_RECONNECT" },
              { type: "TRIGGER_FULL_RESYNC" },
              { type: "LOG", action: "FSM_RECONNECT_EXHAUSTED", data: { attempts: message.attempt } },
            ],
          };
        }
        const delayMs = Math.min(1000 * Math.pow(2, message.attempt - 1), 15000);
        return {
          nextState: "RECONNECTING",
          effects: [
            { type: "SCHEDULE_RECONNECT", attempt: message.attempt + 1, delayMs },
            { type: "LOG", action: "FSM_RECONNECT_SCHEDULED", data: { attempt: message.attempt, delayMs } },
          ],
        };
      }
      if (message.type === "RECONNECT_EXHAUSTED") {
        return {
          nextState: "DESYNCED",
          effects: [
            { type: "UPDATE_STORE_STATUS", status: "desynced" },
            { type: "CANCEL_RECONNECT" },
            { type: "TRIGGER_FULL_RESYNC" },
          ],
        };
      }
      if (message.type === "DISCONNECT_REQUESTED") {
        return { nextState: "IDLE", effects: [{ type: "CANCEL_RECONNECT" }] };
      }
      if (message.type === "WS_CLOSED" || message.type === "WS_ERROR") {
        // Already reconnecting — ignore additional close/error events.
        return { nextState: "RECONNECTING", effects: [] };
      }
      return noTransition(current, message);
    }
  }

  // TypeScript exhaustiveness — should never reach here.
  return noTransition(current, message);
}

// ============================================================================
// 7.  No-transition helper (for unhandled messages in a given state)
// ============================================================================

function noTransition(current: SyncState, message: SyncMessage): TransitionResult {
  // Log at debug level — not an error, just an unhandled message for this state.
  return {
    nextState: current,
    effects: [
      {
        type: "LOG",
        action: "FSM_UNHANDLED_MESSAGE",
        data: { state: current, messageType: message.type },
      },
    ],
  };
}

// ============================================================================
// 8.  SyncStateMachine class — wraps the pure transition + effect execution
// ============================================================================

/**
 * Stateful wrapper that:
 *   1. Holds current SyncState.
 *   2. Processes messages via a FIFO mailbox (serialized).
 *   3. Executes effects via an injectable EffectRunner.
 *   4. Logs every transition to telemetry.
 *
 * Usage:
 *   const fsm = new SyncStateMachine(effectRunner);
 *   fsm.send({ type: "CONNECT_REQUESTED", boardId: "..." });
 */
export type EffectRunner = (effect: SyncEffect) => void;

export class SyncStateMachine {
  private _state: SyncState = "IDLE";
  private readonly _runner: EffectRunner;
  private readonly _history: Array<{ from: SyncState; to: SyncState; message: SyncMessage["type"]; at: number }> = [];

  // ── Mailbox ────────────────────────────────────────────────────────────────
  private _queue: SyncMessage[] = [];
  private _processing = false;

  constructor(runner: EffectRunner) {
    this._runner = runner;
  }

  /** Current FSM state (read-only). */
  get state(): SyncState {
    return this._state;
  }

  /** Transition history (last 50 entries) — for debugging. */
  get history() {
    return this._history;
  }

  /** Send a message to the FSM. Serialized via mailbox. */
  send(message: SyncMessage): void {
    this._queue.push(message);
    if (!this._processing) {
      this._drain();
    }
  }

  /** Reset FSM to IDLE (e.g. on board unmount). */
  reset(): void {
    this._state = "IDLE";
    this._queue = [];
    this._history.length = 0;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _drain(): void {
    this._processing = true;

    while (this._queue.length > 0) {
      const message = this._queue.shift()!;
      const { nextState, effects } = transition(this._state, message);

      // Record transition.
      const from = this._state;
      this._state = nextState;

      if (from !== nextState) {
        this._history.push({
          from,
          to:      nextState,
          message: message.type,
          at:      Date.now(),
        });
        // Keep history bounded.
        if (this._history.length > 50) this._history.shift();

        telemetry.log("STORE", "SYNC_FSM_TRANSITION", {
          from,
          to:      nextState,
          trigger: message.type,
        });
      }

      // Execute effects.
      for (const effect of effects) {
        try {
          this._runner(effect);
        } catch (err: any) {
          telemetry.log("STORE", "SYNC_FSM_EFFECT_ERROR", {
            effectType: effect.type,
            error:      err.message,
          });
        }
      }
    }

    this._processing = false;
  }
}
