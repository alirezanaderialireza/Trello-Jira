// apps/web/src/features/board/api/realtime/boardSocketClient.ts

import { useBoardStore } from "../../store/useBoardStore";
import type { RealtimeMessage, RealtimeRequest, WsEvent } from "./types";
import { telemetry } from "../../devtools/logEvent";

class BoardSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private boardId: string | null = null;
  private token: string | null = null;

  // Reconnection
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 7;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat
  private pingIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly PING_INTERVAL_MS = 30_000;

  constructor(url: string) {
    this.url = url;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  public connect(boardId: string, token?: string): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      if (this.boardId === boardId) return; // already connected to this board
      this.disconnect();
    }

    this.boardId = boardId;
    if (token) this.token = token;

    useBoardStore.setState({ syncStatus: "reconnecting" });
    telemetry.log("WS_INGRESS", "CONNECTING", { url: this.url, boardId });

    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen    = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose   = this.handleClose.bind(this);
      this.ws.onerror   = this.handleError.bind(this);
    } catch (error: any) {
      console.error("[WebSocket] Failed to construct WebSocket", error);
      telemetry.log("WS_INGRESS", "CONSTRUCTOR_ERROR", { error: error.message });
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    // ✅ Fix #9: capture boardId BEFORE nulling it so unsubscribe can be sent.
    // Previous code set `this.boardId = null` first, then checked `if (this.boardId)`
    // inside the send block — the condition was always false → unsubscribe never sent.
    const boardIdToUnsubscribe = this.boardId;

    this.clearTimers();
    this.boardId = null;          // null AFTER we capture it
    this.reconnectAttempts = 0;

    if (this.ws) {
      if (
        this.ws.readyState === WebSocket.OPEN &&
        boardIdToUnsubscribe          // ✅ uses the captured value
      ) {
        this.send({ action: "unsubscribe", boardId: boardIdToUnsubscribe });
      }
      this.ws.close();
      this.ws = null;
      telemetry.log("WS_INGRESS", "DISCONNECTED_BY_CLIENT", {});
    }

    useBoardStore.setState({ syncStatus: "desynced" });
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    const state = useBoardStore.getState();

    telemetry.log("WS_INGRESS", "CONNECTED", { lastSequence: state.boardSequence });

    const subscribeReq: RealtimeRequest = {
      action: "subscribe",
      boardId: this.boardId!,
      lastSequence: state.boardSequence,
      token: this.token ?? undefined,
    };

    this.send(subscribeReq);
    this.startHeartbeat();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message: RealtimeMessage = JSON.parse(event.data as string);

      switch (message.type) {
        case "EVENT": {
          if (message.sequence && message.payload) {
            telemetry.timeline(
              "WS_INGRESS",
              message.payload.type,
              { rawPayload: message.payload },
              { sequence: message.sequence, correlationId: message.payload.correlationId },
            );

            const wsEvent: WsEvent = {
              sequence: message.sequence,
              type: message.payload.type,
              payload: message.payload,
            };
            useBoardStore.getState().applyWebsocketEvent(wsEvent);
          }
          break;
        }

        case "SYSTEM": {
          if (message.meta?.reason === "SUBSCRIBED") {
            telemetry.log("WS_INGRESS", "SUBSCRIBED_ACK", { boardId: this.boardId });
            useBoardStore.setState({ syncStatus: "healthy" });
          }
          break;
        }

        case "RESYNC_REQUIRED": {
          console.warn("[WebSocket] Resync required by server.");
          telemetry.log("WS_INGRESS", "FATAL_RESYNC_ORDERED", { reason: message.meta?.reason });
          useBoardStore.setState({ syncStatus: "desynced" });
          break;
        }
      }
    } catch (error: any) {
      console.error("[WebSocket] Message parsing error:", error);
      telemetry.log("WS_INGRESS", "PARSE_ERROR", { rawData: event.data });
    }
  }

  private handleClose(event: CloseEvent): void {
    console.warn(`[WebSocket] Closed: ${event.code} - ${event.reason}`);
    telemetry.log("WS_INGRESS", "CONNECTION_DROPPED", { code: event.code, reason: event.reason });
    this.clearTimers();
    this.ws = null;
    this.scheduleReconnect();
  }

  private handleError(error: Event): void {
    console.error("[WebSocket] Error occurred", error);
    // onclose fires after onerror — reconnect is handled there
  }

  // ==========================================================================
  // Internal Utilities
  // ==========================================================================

  private send(payload: RealtimeRequest): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    // Only reconnect if there's a board to reconnect to
    if (!this.boardId) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[WebSocket] Max reconnect attempts reached. Giving up.");
      telemetry.log("WS_INGRESS", "RECONNECT_GIVEN_UP", { attempts: this.reconnectAttempts });
      useBoardStore.setState({ syncStatus: "desynced" });
      return;
    }

    useBoardStore.setState({ syncStatus: "reconnecting" });

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15_000);
    this.reconnectAttempts++;

    telemetry.log("WS_INGRESS", "RECONNECT_SCHEDULED", {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    console.log(`[WebSocket] Reconnecting in ${delay}ms… (Attempt ${this.reconnectAttempts})`);

    this.reconnectTimeoutId = setTimeout(() => {
      if (this.boardId) this.connect(this.boardId, this.token ?? undefined);
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.pingIntervalId) clearInterval(this.pingIntervalId);

    this.pingIntervalId = setInterval(() => {
      if (this.boardId) {
        this.send({ action: "ping", boardId: this.boardId });
      }
    }, this.PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.pingIntervalId)    clearInterval(this.pingIntervalId);
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    this.pingIntervalId     = null;
    this.reconnectTimeoutId = null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
export const boardSocket = new BoardSocketClient(WS_URL);
