// apps/web/src/features/board/realtime/connection-fsm.ts
//
// Phase-1 abstraction #2 — ConnectionFSM
//
// Manages WebSocket lifecycle independently of the board store.
//
// Design principles:
//   • Zero Zustand dependency — pure class, testable without React
//   • Owns heartbeat, backoff, jitter — no ad-hoc setTimeout scattered elsewhere
//   • Emits typed ConnectionEvents upward — consumers (BoardSocketClient,
//     SyncStateMachine) subscribe and react; FSM does not call them directly
//   • Idempotent connect() — calling twice with same boardId is a no-op
//   • Clean teardown — destroy() cancels all timers and closes WS gracefully

import type { SyncEvent } from "./sync-state";

// ============================================================================
// Configuration
// ============================================================================

export interface ConnectionConfig {
  /** WebSocket server URL */
  url:                    string;

  /** Seconds between ping frames (default 15) */
  pingIntervalMs:         number;

  /** Milliseconds to wait for pong before declaring stale (default 5 000) */
  pongTimeoutMs:          number;

  /** Base delay for exponential backoff in ms (default 1 000) */
  reconnectBaseMs:        number;

  /** Maximum reconnect delay in ms (default 30 000) */
  reconnectMaxMs:         number;

  /** Maximum reconnect attempts before giving up (default 10) */
  maxReconnectAttempts:   number;

  /** Maximum random jitter added to reconnect delay in ms (default 1 000) */
  jitterMs:               number;
}

export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
  url:                  "ws://localhost:3001",
  pingIntervalMs:       15_000,
  pongTimeoutMs:        5_000,
  reconnectBaseMs:      1_000,
  reconnectMaxMs:       30_000,
  maxReconnectAttempts: 10,
  jitterMs:             1_000,
};

// ============================================================================
// Events emitted by ConnectionFSM → consumed by SyncStateMachine
// ============================================================================

export type ConnectionEvent = SyncEvent;

export type ConnectionEventHandler = (event: ConnectionEvent) => void;

// ============================================================================
// ConnectionFSM
// ============================================================================

/**
 * Manages the raw WebSocket lifecycle.
 *
 * Responsibilities:
 *   - Open / close the WebSocket socket
 *   - Send heartbeat pings; detect stale connections
 *   - Schedule reconnects with exponential backoff + jitter
 *   - Emit SyncEvents upward (WS_OPEN, WS_CLOSED, HEARTBEAT_STALE, etc.)
 *
 * Does NOT:
 *   - Touch Zustand store
 *   - Parse domain events
 *   - Apply reducers
 *   - Make HTTP requests
 */
export class ConnectionFSM {
  // ── private state ──────────────────────────────────────────────────────────
  private ws:              WebSocket | null = null;
  private boardId:         string | null    = null;
  private token:           string | null    = null;

  private reconnectAttempts = 0;
  private reconnectTimer:   ReturnType<typeof setTimeout> | null = null;
  private pingTimer:        ReturnType<typeof setInterval> | null = null;
  private pongTimer:        ReturnType<typeof setTimeout> | null = null;

  private destroyed = false;

  private readonly cfg: ConnectionConfig;
  private readonly emit: ConnectionEventHandler;

  // ── constructor ─────────────────────────────────────────────────────────────

  constructor(
    cfg:     Partial<ConnectionConfig>,
    handler: ConnectionEventHandler,
  ) {
    this.cfg  = { ...DEFAULT_CONNECTION_CONFIG, ...cfg };
    this.emit = handler;
  }

  // ── public API ───────────────────────────────────────────────────────────────

  /**
   * Open (or switch to) a board room.
   * Idempotent: calling with the same boardId while already connected is a no-op.
   */
  connect(boardId: string, token?: string): void {
    if (this.destroyed) return;

    // Already connected to the same board — no-op
    if (
      this.boardId === boardId &&
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // Switch board — tear down the current connection first
    if (this.ws) this._teardownSocket();

    this.boardId = boardId;
    if (token) this.token = token;

    this.emit({ type: "CONNECT_REQUESTED", boardId, token });
    this._openSocket();
  }

  /**
   * Intentional disconnect. Resets reconnect counters.
   */
  disconnect(): void {
    this.emit({ type: "DISCONNECT_REQUESTED" });
    this._teardownAll();
  }

  /**
   * Call when a PONG / SYSTEM:SUBSCRIBED frame arrives from the server.
   * Clears the pong timeout so the connection is not declared stale.
   */
  receivedPong(): void {
    this._clearPongTimer();
    this.emit({ type: "HEARTBEAT_OK" });
  }

  /**
   * Call when SERVER_RESYNC_REQUIRED arrives.
   */
  resyncRequired(reason: string): void {
    this.emit({ type: "SERVER_RESYNC_REQUIRED", reason });
  }

  /**
   * Send a raw message on the open socket.
   * Silent no-op if socket is not open.
   */
  send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * Permanently destroy this instance. All timers cancelled, socket closed.
   * After calling destroy(), connect() is a no-op.
   */
  destroy(): void {
    this.destroyed = true;
    this._teardownAll();
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private _openSocket(): void {
    try {
      this.ws = new WebSocket(this.cfg.url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "WebSocket constructor failed";
      this.emit({ type: "WS_ERROR", message: msg });
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen    = () => this._handleOpen();
    this.ws.onclose   = (e) => this._handleClose(e);
    this.ws.onerror   = () => this._handleError();
    // onmessage is wired externally by BoardSocketClient
    // so raw frames can be parsed and dispatched without FSM coupling.
  }

  private _handleOpen(): void {
    this.reconnectAttempts = 0;
    this.emit({ type: "WS_OPEN" });
    this._startHeartbeat();
  }

  private _handleClose(e: CloseEvent): void {
    this._clearHeartbeat();
    this.emit({ type: "WS_CLOSED", code: e.code, reason: e.reason });
    this._scheduleReconnect();
  }

  private _handleError(): void {
    // onclose always fires after onerror — we only need to emit WS_ERROR here.
    // The reconnect is handled in _handleClose.
    this.emit({ type: "WS_ERROR", message: "WebSocket error" });
  }

  // ── heartbeat ───────────────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    this._clearHeartbeat();

    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.send({ action: "ping", boardId: this.boardId });
      this._startPongTimer();
    }, this.cfg.pingIntervalMs);
  }

  private _startPongTimer(): void {
    this._clearPongTimer();
    this.pongTimer = setTimeout(() => {
      // Pong did not arrive in time — connection is stale
      this.emit({ type: "HEARTBEAT_STALE", missedMs: this.cfg.pongTimeoutMs });
      // Force-close so onclose fires and reconnect is scheduled
      this.ws?.close(4000, "HEARTBEAT_TIMEOUT");
    }, this.cfg.pongTimeoutMs);
  }

  private _clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private _clearHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this._clearPongTimer();
  }

  // ── reconnect ───────────────────────────────────────────────────────────────

  private _scheduleReconnect(): void {
    if (this.destroyed || !this.boardId) return;

    if (this.reconnectAttempts >= this.cfg.maxReconnectAttempts) {
      this.emit({ type: "RECONNECT_EXHAUSTED" });
      return;
    }

    const jitter = Math.random() * this.cfg.jitterMs;
    const delay  = Math.min(
      this.cfg.reconnectBaseMs * Math.pow(2, this.reconnectAttempts) + jitter,
      this.cfg.reconnectMaxMs,
    );

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed && this.boardId) this._openSocket();
    }, delay);
  }

  // ── teardown ─────────────────────────────────────────────────────────────────

  private _teardownSocket(): void {
    this._clearHeartbeat();
    if (this.ws) {
      this.ws.onopen    = null;
      this.ws.onclose   = null;
      this.ws.onerror   = null;
      this.ws.onmessage = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close(1000, "CLIENT_DISCONNECT");
      }
      this.ws = null;
    }
  }

  private _teardownAll(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.boardId           = null;
    this.token             = null;
    this._teardownSocket();
  }

  // ── inspection (for tests / devtools) ────────────────────────────────────────

  get wsReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  get currentBoardId(): string | null {
    return this.boardId;
  }

  get currentReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}
