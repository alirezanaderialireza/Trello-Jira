// apps/web/src/features/board/api/realtime/connectionFsm.ts
//
// ============================================================================
// 🔌 ConnectionFSM — Standalone Transport State Machine
// ============================================================================
//
// Architecture:
// ─────────────
// Phase 2 requirement: a *class* that owns all transport FSM concerns,
// replacing the inline state fields that were scattered across
// BoardSocketClient.
//
// Responsibilities of ConnectionFSM:
//   1. Own the current ConnectionState (single source of truth)
//   2. Validate every transition via VALID_TRANSITIONS — invalid calls are
//      no-ops (logged in dev)
//   3. Own the session epoch counter — bumped on every new socket open to
//      invalidate stale async callbacks
//   4. Own reconnect bookkeeping (attempts, backoff config)
//   5. Own heartbeat / RTT metrics snapshot
//   6. Emit ConnectionEvent to observers on every state change and RTT update
//
// BoardSocketClient becomes a thin transport layer that:
//   • Creates the WebSocket
//   • Routes raw WS lifecycle events (onopen/onclose/onerror/onmessage) into
//     ConnectionFSM triggers
//   • Reads FSM state to guard stale callbacks (via epoch)
//
// This separation is the Phase 2 "Full ConnectionFSM class + event-driven
// state machine" requirement.
// ============================================================================

import { telemetry } from "../../devtools/logEvent";

// ============================================================================
// 🔌 Physical Connection States
// ============================================================================

export type ConnectionState =
  /** No socket exists. Initial state or after intentional disconnect. */
  | "idle"
  /** WebSocket constructor called; waiting for onopen. */
  | "connecting"
  /** onopen fired; SUBSCRIBE sent; waiting for server SUBSCRIBED ACK. */
  | "handshaking"
  /** Server sent SUBSCRIBED ACK. Heartbeat running. */
  | "connected"
  /** onclose/onerror fired; jitter delay running; will re-enter connecting. */
  | "reconnecting"
  /** Max reconnect attempts exhausted. UI must prompt user to hard-refresh. */
  | "terminal";

// ============================================================================
// 📊 Connection Metrics (observable snapshot)
// ============================================================================

export interface ConnectionMetrics {
  state:             ConnectionState;
  reconnectAttempts: number;
  /** Incremented on every successful socket open. Guards stale callbacks. */
  epoch:             number;
  latencyMs:         number | null;
  lastPongAt:        number | null;
  pingInFlight:      boolean;
}

// ============================================================================
// 📣 Connection Events
// ============================================================================

export type ConnectionEvent =
  | { type: "state_changed";   state: ConnectionState; epoch: number }
  | { type: "metrics_updated"; metrics: ConnectionMetrics }
  | { type: "resync_required"; reason: string }
  | { type: "reconnect_failed"; attempts: number };

// ============================================================================
// 🔁 Valid FSM Transitions
// ============================================================================

export const VALID_TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
  idle:         ["connecting"],
  connecting:   ["handshaking", "reconnecting", "idle"],
  handshaking:  ["connected",   "reconnecting", "idle"],
  connected:    ["reconnecting", "idle"],
  reconnecting: ["connecting",  "terminal",     "idle"],
  terminal:     ["connecting"],
};

// ============================================================================
// ⏱️ Backoff Config
// ============================================================================

export interface BackoffConfig {
  baseMs:      number;
  maxMs:       number;
  /** Jitter factor 0–1; final delay ± factor * exponential */
  jitter:      number;
  maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs:      500,
  maxMs:       30_000,
  jitter:      0.3,
  maxAttempts: 8,
};

/**
 * Full-jitter exponential backoff.
 * Spreads reconnect load evenly across the reconnect window.
 */
export function computeBackoffDelay(
  attempt: number,
  cfg: BackoffConfig = DEFAULT_BACKOFF,
): number {
  const exp   = Math.min(cfg.baseMs * Math.pow(2, attempt), cfg.maxMs);
  const range = exp * cfg.jitter;
  const delta = (Math.random() * 2 - 1) * range;
  return Math.max(0, Math.round(exp + delta));
}

// ============================================================================
// 🔌 ConnectionFSM — Standalone Class
// ============================================================================
//
// Usage (inside BoardSocketClient):
//
//   const fsm = new ConnectionFSM(DEFAULT_BACKOFF, myObserver);
//
//   // When socket opens:
//   fsm.onSocketOpen();      → transitions connecting → handshaking, bumps epoch
//
//   // When server ACK arrives:
//   fsm.onHandshakeAck();    → transitions handshaking → connected
//
//   // When socket closes:
//   fsm.onSocketClosed();    → transitions → reconnecting (or terminal)
//
//   // Guard stale callbacks:
//   if (fsm.isEpochStale(capturedEpoch)) return;
//
// ============================================================================

export class ConnectionFSM {
  // --------------------------------------------------------------------------
  // Core state
  // --------------------------------------------------------------------------
  private _state: ConnectionState = "idle";
  private _epoch  = 0;

  // --------------------------------------------------------------------------
  // Reconnect
  // --------------------------------------------------------------------------
  private _reconnectAttempts = 0;
  readonly backoff: BackoffConfig;

  // --------------------------------------------------------------------------
  // RTT / heartbeat metrics
  // --------------------------------------------------------------------------
  private _latencyMs:    number | null = null;
  private _lastPongAt:   number | null = null;
  private _pingInFlight  = false;
  private _lastPingSentAt = 0;

  // --------------------------------------------------------------------------
  // Observers
  // --------------------------------------------------------------------------
  private readonly _observers = new Set<(e: ConnectionEvent) => void>();

  constructor(backoff: BackoffConfig = DEFAULT_BACKOFF) {
    this.backoff = backoff;
  }

  // ==========================================================================
  // 🌐 Public reads
  // ==========================================================================

  get state(): ConnectionState             { return this._state; }
  get epoch(): number                      { return this._epoch; }
  get reconnectAttempts(): number          { return this._reconnectAttempts; }
  get latencyMs(): number | null           { return this._latencyMs; }
  get lastPongAt(): number | null          { return this._lastPongAt; }
  get pingInFlight(): boolean              { return this._pingInFlight; }
  get lastPingSentAt(): number             { return this._lastPingSentAt; }

  get metrics(): ConnectionMetrics {
    return {
      state:             this._state,
      reconnectAttempts: this._reconnectAttempts,
      epoch:             this._epoch,
      latencyMs:         this._latencyMs,
      lastPongAt:        this._lastPongAt,
      pingInFlight:      this._pingInFlight,
    };
  }

  // ==========================================================================
  // 📣 Observer
  // ==========================================================================

  subscribe(cb: (e: ConnectionEvent) => void): () => void {
    this._observers.add(cb);
    return () => this._observers.delete(cb);
  }

  // ==========================================================================
  // 🔒 Transition (private — all mutations go through here)
  // ==========================================================================

  private _transition(next: ConnectionState): boolean {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed.includes(next)) {
      telemetry.log("CONNECTION_FSM", "INVALID_TRANSITION", {
        from: this._state,
        to:   next,
        epoch: this._epoch,
      });
      return false;
    }

    const prev = this._state;
    this._state = next;

    telemetry.log("CONNECTION_FSM", "TRANSITION", {
      from:  prev,
      to:    next,
      epoch: this._epoch,
    });

    this._emit({ type: "state_changed", state: next, epoch: this._epoch });
    this._emitMetrics();
    return true;
  }

  // ==========================================================================
  // ⚡ Event-driven triggers — called by BoardSocketClient
  // ==========================================================================

  /**
   * Called when connect() is invoked by the consumer.
   * Resets reconnect counter when coming from terminal (manual retry).
   */
  onConnectRequested(): void {
    if (this._state === "terminal") {
      this._reconnectAttempts = 0;
    }
    this._transition("connecting");
  }

  /**
   * Called on WebSocket.onopen.
   * Bumps epoch — all pre-open callbacks become stale.
   * Returns the new epoch so callers can capture it.
   */
  onSocketOpen(): number {
    this._epoch += 1;
    this._reconnectAttempts = 0;
    this._transition("handshaking");
    return this._epoch;
  }

  /**
   * Called when the server SUBSCRIBED ACK arrives.
   */
  onHandshakeAck(): void {
    this._transition("connected");
  }

  /**
   * Called on WebSocket.onclose / onerror / handshake timeout.
   * Returns whether a reconnect should be attempted (true) or we hit terminal.
   */
  onSocketClosed(): "reconnect" | "terminal" | "idle" {
    // If already idle (intentional disconnect) — no-op.
    if (this._state === "idle") return "idle";

    this._transition("reconnecting");

    if (this._reconnectAttempts >= this.backoff.maxAttempts) {
      telemetry.log("CONNECTION_FSM", "RECONNECT_EXHAUSTED", {
        attempts: this._reconnectAttempts,
      });
      this._transition("terminal");
      this._emit({ type: "reconnect_failed", attempts: this._reconnectAttempts });
      return "terminal";
    }

    return "reconnect";
  }

  /**
   * Increments the reconnect attempt counter and returns the backoff delay.
   * Call this right before scheduling the reconnect timer.
   */
  consumeReconnectAttempt(): number {
    const attempt = this._reconnectAttempts;
    this._reconnectAttempts += 1;
    return computeBackoffDelay(attempt, this.backoff);
  }

  /**
   * Called on intentional disconnect().
   * Resets all counters.
   */
  onIntentionalDisconnect(): void {
    this._reconnectAttempts = 0;
    this._pingInFlight      = false;
    this._transition("idle");
    telemetry.log("CONNECTION_FSM", "INTENTIONAL_DISCONNECT", { epoch: this._epoch });
  }

  /**
   * Emits resync_required without touching connection state.
   * (Server can order a full resync while the socket stays alive.)
   */
  onResyncRequired(reason: string): void {
    telemetry.log("CONNECTION_FSM", "RESYNC_REQUIRED", { reason, epoch: this._epoch });
    this._emit({ type: "resync_required", reason });
  }

  // ==========================================================================
  // 💓 Heartbeat / RTT mutations
  // ==========================================================================

  markPingSent(sentAt: number): void {
    this._pingInFlight  = true;
    this._lastPingSentAt = sentAt;
  }

  markPongReceived(sentAt: number): void {
    this._pingInFlight = false;
    this._latencyMs    = Math.round(performance.now() - sentAt);
    this._lastPongAt   = Date.now();

    telemetry.log("CONNECTION_FSM", "PONG_RECEIVED", {
      rttMs: this._latencyMs,
      epoch: this._epoch,
    });

    this._emitMetrics();
  }

  clearPingInFlight(): void {
    this._pingInFlight = false;
  }

  // ==========================================================================
  // 🛡️ Epoch guard helpers
  // ==========================================================================

  /**
   * Returns true if the captured epoch is no longer current.
   * Use inside async callbacks to bail early when the socket has been
   * replaced (reconnect) since the callback was created.
   */
  isEpochStale(capturedEpoch: number): boolean {
    return capturedEpoch !== this._epoch;
  }

  // ==========================================================================
  // 📣 Emit helpers
  // ==========================================================================

  private _emit(e: ConnectionEvent): void {
    this._observers.forEach((cb) => {
      try {
        cb(e);
      } catch (err) {
        console.error("[ConnectionFSM] Observer threw:", err);
      }
    });
  }

  _emitMetrics(): void {
    this._emit({ type: "metrics_updated", metrics: this.metrics });
  }
}
