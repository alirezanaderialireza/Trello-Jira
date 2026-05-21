// apps/web/src/features/board/realtime/sync-state.ts
//
// Phase-1 abstraction #1 — SyncState Machine
//
// The 6-state deterministic FSM that describes the client's relationship
// with the server at any point in time.
//
// Design principles:
//   • Every state has explicit meaning — no "unknown" or catch-all
//   • Transitions are exhaustively typed — illegal moves are compile errors
//   • Side-effect free — state changes are pure data, not imperative calls
//   • Observable — every transition carries a reason for telemetry/devtools

// ============================================================================
// States
// ============================================================================

/**
 * The six states the client sync layer can be in.
 *
 *   offline       — no network / intentional disconnect / page hidden
 *   connecting    — WebSocket handshake in progress
 *   connected     — live, heartbeat OK, sequence contiguous
 *   catching-up   — gap detected; fetching missed events from server
 *   resyncing     — gap too large or state corrupt; fetching full snapshot
 *   desynced      — resync failed or max retries exceeded; manual action required
 *
 * State flow (happy path):
 *   offline → connecting → connected
 *
 * Degraded paths:
 *   connected → catching-up → connected
 *   connected → resyncing   → connected
 *   connected → connecting  (heartbeat stale → force reconnect)
 *   any       → offline     (page hidden / explicit disconnect)
 *   resyncing → desynced    (snapshot fetch failed)
 */
export type SyncState =
  | "offline"
  | "connecting"
  | "connected"
  | "catching-up"
  | "resyncing"
  | "desynced";

// ============================================================================
// Transition events
// ============================================================================

/**
 * Every event that can trigger a state transition.
 * Typed as a discriminated union so each event carries exactly the data
 * its transition needs — no optional fields, no any.
 */
export type SyncEvent =
  // Network / intention
  | { type: "CONNECT_REQUESTED";  boardId: string; token?: string }
  | { type: "DISCONNECT_REQUESTED" }

  // WebSocket lifecycle
  | { type: "WS_OPEN" }
  | { type: "WS_CLOSED";          code: number; reason: string }
  | { type: "WS_ERROR";           message: string }

  // Server messages
  | { type: "SERVER_SUBSCRIBED" }
  | { type: "SERVER_RESYNC_REQUIRED"; reason: string }

  // Sequence management
  | { type: "GAP_DETECTED";       missing: string; expected: string }
  | { type: "GAP_RESOLVED" }
  | { type: "GAP_IRRECOVERABLE";  currentSeq: string; serverSeq: string }

  // Snapshot management
  | { type: "SNAPSHOT_STARTED" }
  | { type: "SNAPSHOT_APPLIED";   newSequence: string }
  | { type: "SNAPSHOT_FAILED";    reason: string }

  // Heartbeat
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_STALE";    missedMs: number }

  // Max retries
  | { type: "RECONNECT_EXHAUSTED" };

// ============================================================================
// Transition table
// ============================================================================

/**
 * Legal transitions — the source of truth for the FSM.
 * Key: `${fromState}:${eventType}`
 * Value: the resulting state
 *
 * Any combination not listed here is ILLEGAL and will throw in dev.
 */
const TRANSITIONS: Partial<Record<`${SyncState}:${SyncEvent["type"]}`, SyncState>> = {
  // ── from offline ──────────────────────────────────────────────────────────
  "offline:CONNECT_REQUESTED":     "connecting",

  // ── from connecting ───────────────────────────────────────────────────────
  "connecting:WS_OPEN":            "connecting",   // open → wait for SUBSCRIBED
  "connecting:SERVER_SUBSCRIBED":  "connected",
  "connecting:WS_CLOSED":          "connecting",   // retry (ConnectionFSM handles backoff)
  "connecting:WS_ERROR":           "connecting",
  "connecting:RECONNECT_EXHAUSTED":"desynced",
  "connecting:DISCONNECT_REQUESTED":"offline",

  // ── from connected ────────────────────────────────────────────────────────
  "connected:GAP_DETECTED":        "catching-up",
  "connected:SERVER_RESYNC_REQUIRED":"resyncing",
  "connected:HEARTBEAT_STALE":     "connecting",   // stale → force reconnect
  "connected:WS_CLOSED":           "connecting",
  "connected:WS_ERROR":            "connecting",
  "connected:DISCONNECT_REQUESTED":"offline",
  "connected:HEARTBEAT_OK":        "connected",    // no-op transition (refresh)

  // ── from catching-up ──────────────────────────────────────────────────────
  "catching-up:GAP_RESOLVED":      "connected",
  "catching-up:GAP_IRRECOVERABLE": "resyncing",
  "catching-up:WS_CLOSED":         "connecting",
  "catching-up:DISCONNECT_REQUESTED":"offline",

  // ── from resyncing ────────────────────────────────────────────────────────
  "resyncing:SNAPSHOT_STARTED":    "resyncing",    // idempotent
  "resyncing:SNAPSHOT_APPLIED":    "connected",
  "resyncing:SNAPSHOT_FAILED":     "desynced",
  "resyncing:WS_CLOSED":           "connecting",
  "resyncing:DISCONNECT_REQUESTED":"offline",

  // ── from desynced ─────────────────────────────────────────────────────────
  "desynced:CONNECT_REQUESTED":    "connecting",   // user manually retries
  "desynced:DISCONNECT_REQUESTED": "offline",
};

// ============================================================================
// Pure transition function
// ============================================================================

export interface TransitionResult {
  /** The state after applying the event */
  nextState: SyncState;
  /** Whether the transition is a legal move (false = illegal / no-op) */
  changed: boolean;
}

/**
 * Pure state transition function.
 *
 * @param current  Current SyncState
 * @param event    Incoming SyncEvent
 * @returns        { nextState, changed } — never throws in production
 *
 * In development, an illegal transition throws so we catch bugs immediately.
 * In production, illegal transitions are logged and current state is preserved.
 */
export function transition(
  current: SyncState,
  event:   SyncEvent,
): TransitionResult {
  const key = `${current}:${event.type}` as `${SyncState}:${SyncEvent["type"]}`;
  const nextState = TRANSITIONS[key];

  if (nextState === undefined) {
    const msg = `[SyncFSM] Illegal transition: ${key}`;

    if (import.meta.env?.DEV ?? process.env.NODE_ENV === "development") {
      throw new Error(msg);
    }

    console.warn(msg);
    return { nextState: current, changed: false };
  }

  return {
    nextState,
    changed: nextState !== current,
  };
}

// ============================================================================
// Guards / predicates
// ============================================================================

/** True when the client can receive and apply live events */
export const isLive = (s: SyncState): boolean => s === "connected";

/** True when the client is in a degraded-but-recoverable state */
export const isDegraded = (s: SyncState): boolean =>
  s === "catching-up" || s === "resyncing" || s === "connecting";

/** True when the client requires explicit user action to recover */
export const isTerminal = (s: SyncState): boolean => s === "desynced";

/** True when the client has no active connection */
export const isInactive = (s: SyncState): boolean =>
  s === "offline" || s === "desynced";

// ============================================================================
// Serialisable context attached to each state
// ============================================================================

/**
 * Runtime metadata associated with the current sync state.
 * Stored alongside SyncState so UI can show meaningful feedback.
 */
export interface SyncContext {
  state:          SyncState;
  boardId:        string | null;
  lastSequence:   string;           // last confirmed board sequence ("0" = unknown)
  reconnectCount: number;           // how many reconnect attempts so far
  lastEventAt:    number | null;    // epoch ms of last successfully applied event
  catchUpFrom:    string | null;    // sequence we're catching up from (if catching-up)
  resyncReason:   string | null;    // why resync was triggered (if resyncing)
  error:          string | null;    // last error message (if desynced)
}

export const INITIAL_SYNC_CONTEXT: SyncContext = {
  state:          "offline",
  boardId:        null,
  lastSequence:   "0",
  reconnectCount: 0,
  lastEventAt:    null,
  catchUpFrom:    null,
  resyncReason:   null,
  error:          null,
};
