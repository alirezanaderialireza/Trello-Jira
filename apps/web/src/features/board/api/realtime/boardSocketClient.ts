// apps/web/src/features/board/api/realtime/boardSocketClient.ts
//
// ============================================================================
// 🔌 Production-Grade WebSocket Gateway
// ============================================================================
//
// Architecture:
// ─────────────
//   Transport FSM  (ConnectionState)  — lives here, observable via metrics
//   Data-sync FSM  (SyncStatus)       — lives in Zustand store
//
// Responsibilities of this class:
//   1. Explicit FSM: idle → connecting → handshaking → connected
//                              ↕                          ↕
//                          reconnecting ←────────────────┘
//                              ↓ (maxAttempts exhausted)
//                           terminal
//
//   2. Session epoch — every new WebSocket.onopen bumps epoch.
//      All async callbacks capture epoch at creation time and bail if stale.
//      This eliminates the "ghost reconnect" bug where a callback from a
//      dead socket fires after a new one is already open.
//
//   3. Heartbeat with RTT tracking
//      • PING sent every PING_INTERVAL_MS
//      • If no PONG arrives within PONG_TIMEOUT_MS → treat as dead connection
//      • RTT sampled via performance.now() for observability
//
//   4. Full-jitter exponential backoff
//      • base 500 ms, cap 30 s, jitter ±30 %
//      • Prevents thundering-herd on mass reconnect
//
//   5. Session recovery (RESUME semantic)
//      • On reconnect, SUBSCRIBE is sent with lastSequence from the store
//      • Server replays missed events; reconcileIncomingEvent handles ordering
//
//   6. RESYNC_REQUIRED handling
//      • Server can send RESYNC_REQUIRED for unrecoverable gaps
//      • Client sets syncStatus = "desynced" and emits resync_required event
//      • UI layer decides whether to reload or prompt user
//
//   7. Backpressure guard
//      • Outbound send() silently drops if socket not OPEN
//      • Never throws; always logs via telemetry
//
//   8. Observer pattern for metrics
//      • Callers can subscribe to ConnectionEvent stream
//      • Used by useSyncStatus hook for real-time UI updates
//
// What this class does NOT do:
//   • Domain logic              (→ reducers)
//   • Optimistic state          (→ useOptimisticMutation)
//   • Sequence reconciliation   (→ reconcileIncomingEvent)
//   • Retry queue / DLQ         (→ future outbox processor)
// ============================================================================

import { useBoardStore } from "../../store/useBoardStore";
import { telemetry } from "../../devtools/logEvent";
import type { RealtimeMessage, RealtimeRequest, WsEvent } from "./types";
import {
  type ConnectionState,
  type ConnectionMetrics,
  type ConnectionEvent,
  type BackoffConfig,
  VALID_TRANSITIONS,
  DEFAULT_BACKOFF,
  computeBackoffDelay,
} from "./connectionFsm";

// ============================================================================
// ⚙️ Internal Constants
// ============================================================================

/** How often to send PING when connected (ms) */
const PING_INTERVAL_MS = 25_000;

/**
 * How long to wait for a PONG before considering the connection dead (ms).
 * Must be < PING_INTERVAL_MS.
 */
const PONG_TIMEOUT_MS = 8_000;

/**
 * How long to wait for the server SUBSCRIBED ACK after sending SUBSCRIBE (ms).
 * If no ACK arrives within this window the handshake is treated as failed.
 */
const HANDSHAKE_TIMEOUT_MS = 10_000;

// ============================================================================
// 🔌 BoardSocketClient
// ============================================================================

class BoardSocketClient {
  // --------------------------------------------------------------------------
  // Transport state
  // --------------------------------------------------------------------------
  private ws: WebSocket | null = null;
  private _state: ConnectionState = "idle";

  // --------------------------------------------------------------------------
  // Session identity
  // --------------------------------------------------------------------------
  private boardId: string | null = null;
  private token: string | null = null;

  /**
   * Monotonic counter incremented on every new WebSocket.onopen.
   * All async callbacks capture `epoch` at birth and bail early if it has
   * changed — preventing ghost callbacks from stale sockets.
   */
  private epoch = 0;

  // --------------------------------------------------------------------------
  // Reconnect bookkeeping
  // --------------------------------------------------------------------------
  private reconnectAttempts = 0;
  private readonly backoff: BackoffConfig;
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;

  // --------------------------------------------------------------------------
  // Heartbeat / RTT
  // --------------------------------------------------------------------------
  private pingTimerId: ReturnType<typeof setInterval> | null = null;
  private pongTimerId: ReturnType<typeof setTimeout> | null = null;
  private pingInFlight = false;
  private lastPingSentAt = 0;
  private latencyMs: number | null = null;
  private lastPongAt: number | null = null;

  // --------------------------------------------------------------------------
  // Handshake timeout
  // --------------------------------------------------------------------------
  private handshakeTimerId: ReturnType<typeof setTimeout> | null = null;

  // --------------------------------------------------------------------------
  // Observer registry
  // --------------------------------------------------------------------------
  private readonly observers = new Set<(event: ConnectionEvent) => void>();

  // --------------------------------------------------------------------------
  // Server URL
  // --------------------------------------------------------------------------
  private readonly url: string;

  constructor(url: string, backoff: BackoffConfig = DEFAULT_BACKOFF) {
    this.url = url;
    this.backoff = backoff;
  }

  // ==========================================================================
  // 🌐 Public API
  // ==========================================================================

  /**
   * Connect (or reconnect) to the board room.
   *
   * Idempotent: calling connect() while already connected to the same board
   * is a no-op.  Calling with a different boardId tears down the old socket
   * first.
   */
  public connect(boardId: string, token?: string): void {
    // ── already connected to this board ──────────────────────────────────────
    if (
      this.boardId === boardId &&
      (this._state === "connected" ||
        this._state === "connecting" ||
        this._state === "handshaking")
    ) {
      return;
    }

    // ── switching boards ──────────────────────────────────────────────────────
    if (this.boardId && this.boardId !== boardId) {
      this._hardDisconnect(/* intentional */ true);
    }

    // ── reset from terminal for manual retry ─────────────────────────────────
    if (this._state === "terminal") {
      this.reconnectAttempts = 0;
    }

    this.boardId = boardId;
    if (token !== undefined) this.token = token;

    this._openSocket();
  }

  /**
   * Graceful disconnect.  Sets state → idle, clears all timers, closes socket.
   * Does NOT schedule reconnect.
   */
  public disconnect(): void {
    this._hardDisconnect(/* intentional */ true);
    useBoardStore.setState({ syncStatus: "desynced" });
  }

  /**
   * Current physical connection state.
   */
  public get state(): ConnectionState {
    return this._state;
  }

  /**
   * Current observable metrics snapshot.
   */
  public get metrics(): ConnectionMetrics {
    return {
      state:             this._state,
      reconnectAttempts: this.reconnectAttempts,
      epoch:             this.epoch,
      latencyMs:         this.latencyMs,
      lastPongAt:        this.lastPongAt,
      pingInFlight:      this.pingInFlight,
    };
  }

  /**
   * Subscribe to connection lifecycle events.
   * Returns an unsubscribe function.
   */
  public subscribe(cb: (event: ConnectionEvent) => void): () => void {
    this.observers.add(cb);
    return () => this.observers.delete(cb);
  }

  // ==========================================================================
  // 🔒 FSM Transition
  // ==========================================================================

  private _transition(next: ConnectionState): void {
    const valid = VALID_TRANSITIONS[this._state];
    if (!valid.includes(next)) {
      // Invalid transition — log and ignore; never corrupt state.
      telemetry.log("WS_INGRESS", "INVALID_FSM_TRANSITION", {
        from: this._state,
        to:   next,
      });
      return;
    }

    const prev = this._state;
    this._state = next;

    telemetry.log("WS_INGRESS", "FSM_TRANSITION", {
      from:  prev,
      to:    next,
      epoch: this.epoch,
    });

    this._emit({ type: "state_changed", state: next, epoch: this.epoch });
    this._emitMetrics();
  }

  // ==========================================================================
  // 🔧 Socket Lifecycle
  // ==========================================================================

  private _openSocket(): void {
    this._transition("connecting");
    useBoardStore.setState({ syncStatus: "reconnecting" });

    telemetry.log("WS_INGRESS", "CONNECTING", {
      url:     this.url,
      boardId: this.boardId,
      attempt: this.reconnectAttempts,
    });

    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen    = this._handleOpen.bind(this);
      this.ws.onmessage = this._handleMessage.bind(this);
      this.ws.onclose   = this._handleClose.bind(this);
      this.ws.onerror   = this._handleError.bind(this);
    } catch (err: any) {
      telemetry.log("WS_INGRESS", "CONSTRUCTOR_ERROR", {
        error: err?.message ?? String(err),
      });
      this._scheduleReconnect();
    }
  }

  // --------------------------------------------------------------------------
  // onopen
  // --------------------------------------------------------------------------
  private _handleOpen(): void {
    // Bump epoch — any callbacks born before this point are now stale.
    this.epoch += 1;
    const myEpoch = this.epoch;

    this.reconnectAttempts = 0;
    this._transition("handshaking");

    const state = useBoardStore.getState();

    telemetry.log("WS_INGRESS", "CONNECTED_SENDING_SUBSCRIBE", {
      boardId:      this.boardId,
      lastSequence: state.boardSequence,
      epoch:        myEpoch,
    });

    // Send SUBSCRIBE with lastSequence for session recovery / catch-up.
    this._send({
      action:       "subscribe",
      boardId:      this.boardId!,
      lastSequence: state.boardSequence,
      token:        this.token ?? undefined,
    });

    // Start handshake timeout — if no SUBSCRIBED ACK arrives, treat as dead.
    this.handshakeTimerId = setTimeout(() => {
      if (this.epoch !== myEpoch) return; // stale callback — different epoch
      if (this._state !== "handshaking") return;

      telemetry.log("WS_INGRESS", "HANDSHAKE_TIMEOUT", {
        epoch: myEpoch,
        boardId: this.boardId,
      });

      this._handleClose({ code: 4008, reason: "handshake_timeout" } as CloseEvent);
    }, HANDSHAKE_TIMEOUT_MS);
  }

  // --------------------------------------------------------------------------
  // onmessage
  // --------------------------------------------------------------------------
  private _handleMessage(raw: MessageEvent): void {
    const myEpoch = this.epoch;

    let message: RealtimeMessage;
    try {
      message = JSON.parse(raw.data as string) as RealtimeMessage;
    } catch (err: any) {
      telemetry.log("WS_INGRESS", "PARSE_ERROR", {
        rawData: typeof raw.data === "string" ? raw.data.slice(0, 200) : "<binary>",
        error:   err?.message,
      });
      return;
    }

    switch (message.type) {

      // ── Domain event ───────────────────────────────────────────────────────
      case "EVENT": {
        if (!message.sequence || !message.payload) {
          telemetry.log("WS_INGRESS", "MALFORMED_EVENT", { message });
          return;
        }

        telemetry.timeline(
          "WS_INGRESS",
          message.payload.type,
          { rawPayload: message.payload },
          {
            sequence:      message.sequence,
            correlationId: message.payload.correlationId,
          },
        );

        const wsEvent: WsEvent = {
          sequence: message.sequence,
          type:     message.payload.type,
          payload:  message.payload,
        };

        useBoardStore.getState().applyWebsocketEvent(wsEvent);
        break;
      }

      // ── System / handshake ACK ─────────────────────────────────────────────
      case "SYSTEM": {
        if (message.meta?.reason === "SUBSCRIBED") {
          if (this.epoch !== myEpoch) return; // stale

          this._clearHandshakeTimer();
          this._transition("connected");
          useBoardStore.setState({ syncStatus: "healthy" });
          this._startHeartbeat();

          telemetry.log("WS_INGRESS", "SUBSCRIBED_ACK", {
            boardId:   this.boardId,
            epoch:     myEpoch,
            sessionId: message.meta?.connectionId,
          });
        }
        break;
      }

      // ── Heartbeat PONG ────────────────────────────────────────────────────
      case "HEARTBEAT": {
        if (this.epoch !== myEpoch) return;

        this._clearPongTimer();
        this.pingInFlight = false;

        const rttMs = Math.round(performance.now() - this.lastPingSentAt);
        this.latencyMs  = rttMs;
        this.lastPongAt = Date.now();

        telemetry.log("WS_INGRESS", "PONG_RECEIVED", {
          rttMs,
          epoch: myEpoch,
        });

        this._emitMetrics();
        break;
      }

      // ── Server-ordered full resync ─────────────────────────────────────────
      case "RESYNC_REQUIRED": {
        const reason = message.meta?.reason ?? "unknown";

        telemetry.log("WS_INGRESS", "RESYNC_REQUIRED", {
          reason,
          epoch: myEpoch,
        });

        useBoardStore.setState({ syncStatus: "desynced" });
        this._emit({ type: "resync_required", reason });

        // Keep the transport alive — the UI layer decides whether to reload.
        // We do NOT close the socket here because the server may still
        // deliver events that the UI can queue until a reload occurs.
        break;
      }

      default: {
        telemetry.log("WS_INGRESS", "UNKNOWN_MESSAGE_TYPE", {
          type: (message as any).type,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // onclose
  // --------------------------------------------------------------------------
  private _handleClose(event: CloseEvent): void {
    const myEpoch = this.epoch;

    // Code 4000 = intentional disconnect from our own disconnect() call.
    // In that case _hardDisconnect already transitioned to "idle".
    if (this._state === "idle") return;

    telemetry.log("WS_INGRESS", "CONNECTION_DROPPED", {
      code:   event.code,
      reason: event.reason,
      epoch:  myEpoch,
      state:  this._state,
    });

    this._clearHeartbeat();
    this._clearHandshakeTimer();
    this.ws = null;

    this._scheduleReconnect();
  }

  // --------------------------------------------------------------------------
  // onerror — browser always fires onclose after onerror, so we only log here.
  // --------------------------------------------------------------------------
  private _handleError(event: Event): void {
    telemetry.log("WS_INGRESS", "SOCKET_ERROR", {
      epoch: this.epoch,
      type:  (event as ErrorEvent)?.type ?? "unknown",
    });
    // onclose will fire next and handle reconnect scheduling.
  }

  // ==========================================================================
  // 💓 Heartbeat
  // ==========================================================================

  private _startHeartbeat(): void {
    this._clearHeartbeat();

    this.pingTimerId = setInterval(() => {
      if (this._state !== "connected") {
        this._clearHeartbeat();
        return;
      }

      const myEpoch = this.epoch;

      if (this.pingInFlight) {
        // Previous ping never got a pong — connection is dead.
        telemetry.log("WS_INGRESS", "PING_TIMEOUT_DEAD_CONNECTION", {
          epoch: myEpoch,
        });
        this._handleClose({ code: 4007, reason: "ping_timeout" } as CloseEvent);
        return;
      }

      this.pingInFlight    = true;
      this.lastPingSentAt  = performance.now();

      this._send({ action: "ping", boardId: this.boardId! });

      telemetry.log("WS_INGRESS", "PING_SENT", { epoch: myEpoch });

      // Arm pong timeout.
      this.pongTimerId = setTimeout(() => {
        if (this.epoch !== myEpoch) return; // stale
        if (!this.pingInFlight) return;     // pong already received

        telemetry.log("WS_INGRESS", "PONG_TIMEOUT", { epoch: myEpoch });
        this._handleClose({ code: 4007, reason: "pong_timeout" } as CloseEvent);
      }, PONG_TIMEOUT_MS);

    }, PING_INTERVAL_MS);
  }

  private _clearHeartbeat(): void {
    if (this.pingTimerId !== null) {
      clearInterval(this.pingTimerId);
      this.pingTimerId = null;
    }
    this._clearPongTimer();
    this.pingInFlight = false;
  }

  private _clearPongTimer(): void {
    if (this.pongTimerId !== null) {
      clearTimeout(this.pongTimerId);
      this.pongTimerId = null;
    }
  }

  // ==========================================================================
  // 🔁 Reconnect
  // ==========================================================================

  private _scheduleReconnect(): void {
    if (!this.boardId) return;           // board was intentionally cleared
    if (this._state === "idle") return;  // already cleaned up

    this._transition("reconnecting");

    if (this.reconnectAttempts >= this.backoff.maxAttempts) {
      telemetry.log("WS_INGRESS", "RECONNECT_EXHAUSTED", {
        attempts: this.reconnectAttempts,
      });
      this._transition("terminal");
      useBoardStore.setState({ syncStatus: "desynced" });
      this._emit({ type: "reconnect_failed", attempts: this.reconnectAttempts });
      return;
    }

    const delay     = computeBackoffDelay(this.reconnectAttempts, this.backoff);
    const attempt   = this.reconnectAttempts + 1;
    this.reconnectAttempts = attempt;

    telemetry.log("WS_INGRESS", "RECONNECT_SCHEDULED", {
      attempt,
      delayMs: delay,
    });

    const myEpoch = this.epoch;

    this.reconnectTimerId = setTimeout(() => {
      // Epoch guard: if a connect() was called externally during the wait,
      // epoch will have changed — don't double-open.
      if (this.epoch !== myEpoch && this._state !== "reconnecting") return;
      if (this._state === "idle") return; // intentional disconnect during wait

      if (this.boardId) {
        this._openSocket();
      }
    }, delay);
  }

  // ==========================================================================
  // 🧹 Hard Disconnect (internal — does not schedule reconnect)
  // ==========================================================================

  private _hardDisconnect(intentional: boolean): void {
    this._clearHeartbeat();
    this._clearHandshakeTimer();

    if (this.reconnectTimerId !== null) {
      clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }

    if (this.ws) {
      // Remove handlers so we don't react to onclose from our own close().
      this.ws.onopen    = null;
      this.ws.onmessage = null;
      this.ws.onclose   = null;
      this.ws.onerror   = null;

      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        // 4000 = intentional client-side close
        this.ws.close(intentional ? 4000 : 1001, "client_disconnect");
      }
      this.ws = null;
    }

    if (intentional) {
      this.boardId           = null;
      this.token             = null;
      this.reconnectAttempts = 0;
      this._transition("idle");

      telemetry.log("WS_INGRESS", "DISCONNECTED_INTENTIONAL", {
        epoch: this.epoch,
      });
    }
  }

  // ==========================================================================
  // ⏱️ Handshake timeout helpers
  // ==========================================================================

  private _clearHandshakeTimer(): void {
    if (this.handshakeTimerId !== null) {
      clearTimeout(this.handshakeTimerId);
      this.handshakeTimerId = null;
    }
  }

  // ==========================================================================
  // 📤 Outbound Send (backpressure guard)
  // ==========================================================================

  /**
   * Send a message to the server.
   *
   * Backpressure policy:
   *   If the socket is not in OPEN state the message is silently dropped
   *   and logged via telemetry.  We intentionally do NOT queue messages
   *   here — the reconciliation layer handles catch-up via lastSequence on
   *   reconnect.  Queuing outbound mutations would create a DLQ concern
   *   that belongs in the Outbox Processor, not the transport layer.
   */
  private _send(payload: RealtimeRequest): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      telemetry.log("WS_INGRESS", "SEND_DROPPED_NOT_OPEN", {
        action: payload.action,
        state:  this._state,
      });
      return;
    }

    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err: any) {
      telemetry.log("WS_INGRESS", "SEND_ERROR", {
        action: payload.action,
        error:  err?.message ?? String(err),
      });
    }
  }

  // ==========================================================================
  // 📣 Observer helpers
  // ==========================================================================

  private _emit(event: ConnectionEvent): void {
    this.observers.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        // Never let an observer crash the transport.
        console.error("[BoardSocketClient] Observer threw:", err);
      }
    });
  }

  private _emitMetrics(): void {
    this._emit({ type: "metrics_updated", metrics: this.metrics });
  }
}

// ============================================================================
// 🌍 Singleton Instance
// ============================================================================

const WS_URL =
  (typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_WS_URL
    : undefined) ?? "ws://localhost:3001";

export const boardSocket = new BoardSocketClient(WS_URL);
