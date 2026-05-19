// apps/web/src/features/board/api/realtime/boardSocketClient.ts
//
// ============================================================================
// 🔌 BoardSocketClient — Pure WebSocket Transport (Phase 2)
// ============================================================================
//
// Phase 2 change: all FSM state has been extracted into ConnectionFSM.
// BoardSocketClient is now a thin transport layer that:
//   1. Owns the WebSocket object lifecycle (create / close)
//   2. Routes raw WS events → ConnectionFSM triggers
//   3. Reads FSM state to guard stale callbacks (epoch)
//   4. Manages heartbeat timer and batch event queue
//   5. Exposes boardSocket.subscribe() / boardSocket.metrics via the FSM
//
// What is NO longer here:
//   • _state field (→ fsm.state)
//   • epoch field (→ fsm.epoch)
//   • reconnectAttempts / backoff inline (→ fsm.reconnectAttempts / fsm.backoff)
//   • latencyMs / lastPongAt / pingInFlight (→ fsm.*)
//   • VALID_TRANSITIONS logic (→ fsm._transition)
//
// ============================================================================

import { useBoardStore } from "../../store/useBoardStore";
import { telemetry }     from "../../devtools/logEvent";
import type { RealtimeMessage, RealtimeRequest, WsEvent } from "./types";
import {
  ConnectionFSM,
  DEFAULT_BACKOFF,
  type BackoffConfig,
  type ConnectionMetrics,
  type ConnectionEvent,
} from "./connectionFsm";

// ============================================================================
// ⚙️ Constants
// ============================================================================

const PING_INTERVAL_MS    = 25_000;
const PONG_TIMEOUT_MS     =  8_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const BATCH_MAX_SIZE       = 64;

// ============================================================================
// 🔌 BoardSocketClient
// ============================================================================

class BoardSocketClient {
  // --------------------------------------------------------------------------
  // FSM — single owner of all transport state
  // --------------------------------------------------------------------------
  private readonly fsm: ConnectionFSM;

  // --------------------------------------------------------------------------
  // Session identity
  // --------------------------------------------------------------------------
  private boardId: string | null = null;
  private token:   string | null = null;

  // --------------------------------------------------------------------------
  // Raw WebSocket
  // --------------------------------------------------------------------------
  private ws: WebSocket | null = null;

  // --------------------------------------------------------------------------
  // Timers
  // --------------------------------------------------------------------------
  private reconnectTimerId:   ReturnType<typeof setTimeout>  | null = null;
  private pingTimerId:        ReturnType<typeof setInterval> | null = null;
  private pongTimerId:        ReturnType<typeof setTimeout>  | null = null;
  private handshakeTimerId:   ReturnType<typeof setTimeout>  | null = null;

  // --------------------------------------------------------------------------
  // Event batch (backpressure)
  // --------------------------------------------------------------------------
  private _eventBatch: WsEvent[] = [];
  private _rafHandle:  number | null = null;

  // --------------------------------------------------------------------------
  // URL
  // --------------------------------------------------------------------------
  private readonly url: string;

  constructor(url: string, backoff: BackoffConfig = DEFAULT_BACKOFF) {
    this.url = url;
    this.fsm = new ConnectionFSM(backoff);
  }

  // ==========================================================================
  // 🌐 Public API
  // ==========================================================================

  public connect(boardId: string, token?: string): void {
    // Idempotent for same boardId while already active
    if (
      this.boardId === boardId &&
      (this.fsm.state === "connected" ||
       this.fsm.state === "connecting" ||
       this.fsm.state === "handshaking")
    ) {
      return;
    }

    // Switching boards — tear down first
    if (this.boardId && this.boardId !== boardId) {
      this._hardDisconnect(true);
    }

    this.boardId = boardId;
    if (token !== undefined) this.token = token;

    this.fsm.onConnectRequested();
    this._openSocket();
  }

  public disconnect(): void {
    this._hardDisconnect(true);
    useBoardStore.setState({ syncStatus: "desynced" });
  }

  public get state()   { return this.fsm.state; }
  public get metrics(): ConnectionMetrics { return this.fsm.metrics; }

  public subscribe(cb: (event: ConnectionEvent) => void): () => void {
    return this.fsm.subscribe(cb);
  }

  // ==========================================================================
  // 🔧 Socket lifecycle
  // ==========================================================================

  private _openSocket(): void {
    telemetry.log("WS_INGRESS", "CONNECTING", {
      url: this.url, boardId: this.boardId,
      attempt: this.fsm.reconnectAttempts,
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
    const myEpoch = this.fsm.onSocketOpen();   // bumps epoch, → handshaking

    const state = useBoardStore.getState();
    telemetry.log("WS_INGRESS", "CONNECTED_SENDING_SUBSCRIBE", {
      boardId: this.boardId, lastSequence: state.boardSequence, epoch: myEpoch,
    });

    this._send({
      action:       "subscribe",
      boardId:      this.boardId!,
      lastSequence: state.boardSequence,
      token:        this.token ?? undefined,
    });

    // Handshake timeout — if no SUBSCRIBED ACK arrives
    this.handshakeTimerId = setTimeout(() => {
      if (this.fsm.isEpochStale(myEpoch)) return;
      if (this.fsm.state !== "handshaking") return;
      telemetry.log("WS_INGRESS", "HANDSHAKE_TIMEOUT", { epoch: myEpoch });
      this._handleClose({ code: 4008, reason: "handshake_timeout" } as CloseEvent);
    }, HANDSHAKE_TIMEOUT_MS);
  }

  // --------------------------------------------------------------------------
  // onmessage
  // --------------------------------------------------------------------------
  private _handleMessage(raw: MessageEvent): void {
    const myEpoch = this.fsm.epoch;

    let message: RealtimeMessage;
    try {
      message = JSON.parse(raw.data as string) as RealtimeMessage;
    } catch (err: any) {
      telemetry.log("WS_INGRESS", "PARSE_ERROR", {
        rawData: typeof raw.data === "string" ? raw.data.slice(0, 200) : "<binary>",
        error: err?.message,
      });
      return;
    }

    switch (message.type) {

      // Domain event — enqueue for rAF batch flush
      case "EVENT": {
        if (!message.sequence || !message.payload) {
          telemetry.log("WS_INGRESS", "MALFORMED_EVENT", { message });
          return;
        }
        telemetry.timeline("WS_INGRESS", message.payload.type,
          { rawPayload: message.payload },
          { sequence: message.sequence, correlationId: message.payload.correlationId });

        const wsEvent: WsEvent = {
          sequence: message.sequence,
          type:     message.payload.type,
          payload:  message.payload,
        };

        this._eventBatch.push(wsEvent);

        if (this._eventBatch.length >= BATCH_MAX_SIZE) {
          this._cancelRaf();
          this._flushBatch();
          return;
        }

        if (this._rafHandle === null) {
          this._rafHandle = requestAnimationFrame(() => {
            this._rafHandle = null;
            this._flushBatch();
          });
        }
        break;
      }

      // Handshake ACK
      case "SYSTEM": {
        if (message.meta?.reason === "SUBSCRIBED") {
          if (this.fsm.isEpochStale(myEpoch)) return;
          this._clearHandshakeTimer();
          this.fsm.onHandshakeAck();          // → connected
          this._startHeartbeat();
          telemetry.log("WS_INGRESS", "SUBSCRIBED_ACK", {
            boardId: this.boardId, epoch: myEpoch,
            sessionId: message.meta?.connectionId,
          });
        }
        break;
      }

      // PONG
      case "HEARTBEAT": {
        if (this.fsm.isEpochStale(myEpoch)) return;
        this._clearPongTimer();
        this.fsm.markPongReceived(this.fsm.lastPingSentAt);
        break;
      }

      // Server-ordered resync
      case "RESYNC_REQUIRED": {
        const reason = message.meta?.reason ?? "unknown";
        this.fsm.onResyncRequired(reason);    // emits resync_required event
        break;
      }

      default:
        telemetry.log("WS_INGRESS", "UNKNOWN_MESSAGE_TYPE",
          { type: (message as any).type });
    }
  }

  // --------------------------------------------------------------------------
  // onclose
  // --------------------------------------------------------------------------
  private _handleClose(event: CloseEvent): void {
    if (this.fsm.state === "idle") return; // intentional disconnect handled elsewhere

    telemetry.log("WS_INGRESS", "CONNECTION_DROPPED", {
      code: event.code, reason: event.reason,
      epoch: this.fsm.epoch, state: this.fsm.state,
    });

    this._clearHeartbeat();
    this._clearHandshakeTimer();
    this.ws = null;
    this._scheduleReconnect();
  }

  // --------------------------------------------------------------------------
  // onerror — onclose fires after onerror; just log here
  // --------------------------------------------------------------------------
  private _handleError(event: Event): void {
    telemetry.log("WS_INGRESS", "SOCKET_ERROR", {
      epoch: this.fsm.epoch,
      type:  (event as ErrorEvent)?.type ?? "unknown",
    });
  }

  // ==========================================================================
  // 📦 Batch flush
  // ==========================================================================

  private _flushBatch(): void {
    if (this._eventBatch.length === 0) return;
    const batch = this._eventBatch;
    this._eventBatch = [];

    telemetry.log("WS_INGRESS", "BATCH_FLUSH", {
      batchSize: batch.length, epoch: this.fsm.epoch,
    });

    const store = useBoardStore.getState();
    for (const ev of batch) {
      store.applyWebsocketEvent(ev);
    }
  }

  private _cancelRaf(): void {
    if (this._rafHandle !== null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
  }

  // ==========================================================================
  // 💓 Heartbeat
  // ==========================================================================

  private _startHeartbeat(): void {
    this._clearHeartbeat();
    this.pingTimerId = setInterval(() => {
      if (this.fsm.state !== "connected") { this._clearHeartbeat(); return; }

      const myEpoch = this.fsm.epoch;

      if (this.fsm.pingInFlight) {
        telemetry.log("WS_INGRESS", "PING_TIMEOUT_DEAD_CONNECTION", { epoch: myEpoch });
        this._handleClose({ code: 4007, reason: "ping_timeout" } as CloseEvent);
        return;
      }

      const sentAt = performance.now();
      this.fsm.markPingSent(sentAt);
      this._send({ action: "ping", boardId: this.boardId! });

      telemetry.log("WS_INGRESS", "PING_SENT", { epoch: myEpoch });

      this.pongTimerId = setTimeout(() => {
        if (this.fsm.isEpochStale(myEpoch)) return;
        if (!this.fsm.pingInFlight) return;
        telemetry.log("WS_INGRESS", "PONG_TIMEOUT", { epoch: myEpoch });
        this._handleClose({ code: 4007, reason: "pong_timeout" } as CloseEvent);
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private _clearHeartbeat(): void {
    if (this.pingTimerId !== null) { clearInterval(this.pingTimerId); this.pingTimerId = null; }
    this._clearPongTimer();
    this.fsm.clearPingInFlight();
  }

  private _clearPongTimer(): void {
    if (this.pongTimerId !== null) { clearTimeout(this.pongTimerId); this.pongTimerId = null; }
  }

  // ==========================================================================
  // 🔁 Reconnect
  // ==========================================================================

  private _scheduleReconnect(): void {
    if (!this.boardId) return;
    if (this.fsm.state === "idle") return;

    const result = this.fsm.onSocketClosed();    // → reconnecting or terminal

    if (result === "terminal" || result === "idle") return;

    // result === "reconnect"
    const delay    = this.fsm.consumeReconnectAttempt();
    const myEpoch  = this.fsm.epoch;

    telemetry.log("WS_INGRESS", "RECONNECT_SCHEDULED", {
      attempt: this.fsm.reconnectAttempts, delayMs: delay,
    });

    this.reconnectTimerId = setTimeout(() => {
      if (this.fsm.isEpochStale(myEpoch) && this.fsm.state !== "reconnecting") return;
      if (this.fsm.state === "idle") return;
      if (this.boardId) this._openSocket();
    }, delay);
  }

  // ==========================================================================
  // 🧹 Hard disconnect
  // ==========================================================================

  private _hardDisconnect(intentional: boolean): void {
    this._clearHeartbeat();
    this._clearHandshakeTimer();
    this._cancelRaf();
    this._eventBatch = [];

    if (this.reconnectTimerId !== null) {
      clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }

    if (this.ws) {
      this.ws.onopen = null; this.ws.onmessage = null;
      this.ws.onclose = null; this.ws.onerror = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close(intentional ? 4000 : 1001, "client_disconnect");
      }
      this.ws = null;
    }

    if (intentional) {
      this.boardId = null;
      this.token   = null;
      this.fsm.onIntentionalDisconnect();    // → idle, resets counters
    }
  }

  // ==========================================================================
  // ⏱️ Handshake timer
  // ==========================================================================

  private _clearHandshakeTimer(): void {
    if (this.handshakeTimerId !== null) {
      clearTimeout(this.handshakeTimerId);
      this.handshakeTimerId = null;
    }
  }

  // ==========================================================================
  // 📤 Send (backpressure guard)
  // ==========================================================================

  private _send(payload: RealtimeRequest): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      telemetry.log("WS_INGRESS", "SEND_DROPPED_NOT_OPEN", {
        action: payload.action, state: this.fsm.state,
      });
      return;
    }
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err: any) {
      telemetry.log("WS_INGRESS", "SEND_ERROR", {
        action: payload.action, error: err?.message ?? String(err),
      });
    }
  }
}

// ============================================================================
// 🌍 Singleton
// ============================================================================

const WS_URL =
  (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_WS_URL : undefined)
  ?? "ws://localhost:3001";

export const boardSocket = new BoardSocketClient(WS_URL);
