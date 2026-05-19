// apps/web/src/features/board/api/realtime/connectionFsm.ts
//
// ============================================================================
// 🔌 WebSocket Connection FSM — Types & Transition Table
// ============================================================================
//
// Architecture Analysis:
// ─────────────────────
// The previous code had connection state scattered across:
//   • SyncStatus in the Zustand store        (data-sync concern)
//   • reconnectAttempts in the class          (transport concern)
//   • ws.readyState from native WebSocket     (socket concern)
//
// These are THREE SEPARATE concerns collapsed into one enum — causing:
//   • UI showing "reconnecting" when data is still healthy
//   • No way to distinguish "socket dropped" from "board desynced"
//   • No session epoch → can't detect stale reconnect vs. fresh connect
//
// Solution:
// ─────────
// ConnectionState  — physical transport state (FSM)
// SyncStatus       — logical data-sync state  (already in store)
//
// They evolve independently.  UI consumes both.
// ============================================================================

// ============================================================================
// 🔌 Physical Connection States (Transport FSM)
// ============================================================================

export type ConnectionState =
  /**
   * No socket object exists. Initial state before first connect() call,
   * or after an intentional disconnect().
   */
  | "idle"

  /**
   * WebSocket constructor called; waiting for onopen.
   * Entered from: idle, reconnecting
   */
  | "connecting"

  /**
   * WebSocket.onopen fired; subscribe message sent; waiting for server ACK.
   * Entered from: connecting
   */
  | "handshaking"

  /**
   * Server sent SUBSCRIBED ACK. Heartbeat running.
   * Entered from: handshaking
   */
  | "connected"

  /**
   * onclose or onerror fired; jitter delay running; will re-enter connecting.
   * Entered from: connecting, handshaking, connected
   */
  | "reconnecting"

  /**
   * Max reconnect attempts exhausted OR server sent RESYNC_REQUIRED with
   * terminal reason.  UI must prompt user to hard-refresh.
   * Entered from: reconnecting
   */
  | "terminal";

// ============================================================================
// 🕐 RTT Sample
// ============================================================================

export interface RttSample {
  /** Client timestamp when ping was sent (performance.now() ms) */
  sentAt: number;
  /** Round-trip latency in ms, filled on pong receipt */
  rttMs: number | null;
}

// ============================================================================
// 📊 Connection Metrics (observable snapshot)
// ============================================================================

export interface ConnectionMetrics {
  /** Current physical state */
  state: ConnectionState;
  /** How many reconnect attempts in current session */
  reconnectAttempts: number;
  /** Connection epoch — increments on every successful socket open.
   *  Used to detect stale async callbacks after reconnect. */
  epoch: number;
  /** Latest measured RTT in ms, null if never measured */
  latencyMs: number | null;
  /** Timestamp of last successful pong */
  lastPongAt: number | null;
  /** Whether a ping is currently in-flight (awaiting pong) */
  pingInFlight: boolean;
}

// ============================================================================
// 📣 Connection Events (what observers receive)
// ============================================================================

export type ConnectionEvent =
  | { type: "state_changed";  state: ConnectionState; epoch: number }
  | { type: "metrics_updated"; metrics: ConnectionMetrics }
  | { type: "resync_required"; reason: string }
  | { type: "reconnect_failed"; attempts: number };

// ============================================================================
// 🔁 Valid FSM Transitions
// ============================================================================
//
//  idle
//    └─connect()──────────────────────────► connecting
//
//  connecting
//    ├─onopen────────────────────────────► handshaking
//    ├─onerror/onclose───────────────────► reconnecting
//    └─disconnect()──────────────────────► idle
//
//  handshaking
//    ├─SUBSCRIBED ACK────────────────────► connected
//    ├─timeout/error─────────────────────► reconnecting
//    └─disconnect()──────────────────────► idle
//
//  connected
//    ├─onclose/onerror───────────────────► reconnecting
//    └─disconnect()──────────────────────► idle
//
//  reconnecting
//    ├─delay elapsed & attempts < max────► connecting
//    ├─attempts >= max───────────────────► terminal
//    └─disconnect()──────────────────────► idle
//
//  terminal
//    └─connect() (manual retry by user)──► connecting (resets counter)
//
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
// ⏱️ Reconnect Backoff Config
// ============================================================================

export interface BackoffConfig {
  /** Base delay ms (default 500) */
  baseMs: number;
  /** Maximum cap ms (default 30_000) */
  maxMs: number;
  /** Jitter factor 0–1; final delay ± factor * delay (default 0.3) */
  jitter: number;
  /** Maximum number of attempts before terminal (default 8) */
  maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs:      500,
  maxMs:       30_000,
  jitter:      0.3,
  maxAttempts: 8,
};

/**
 * Compute next reconnect delay with full jitter.
 *
 * Formula:  base * 2^attempt  capped at maxMs,
 *           then ± uniform random in [−jitter*delay, +jitter*delay]
 *
 * Full-jitter is preferred over equal-jitter for distributed systems
 * because it spreads load evenly across the reconnect window, avoiding
 * thundering-herd when many clients reconnect simultaneously.
 */
export function computeBackoffDelay(
  attempt: number,
  cfg: BackoffConfig = DEFAULT_BACKOFF,
): number {
  const exponential = Math.min(cfg.baseMs * Math.pow(2, attempt), cfg.maxMs);
  const jitterRange  = exponential * cfg.jitter;
  // Uniform random in [-jitterRange, +jitterRange]
  const jitterDelta  = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(exponential + jitterDelta));
}
