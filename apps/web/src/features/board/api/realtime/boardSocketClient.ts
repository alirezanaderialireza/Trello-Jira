// apps/web/src/features/board/api/realtime/boardSocketClient.ts

import { useBoardStore } from "../../store/useBoardStore";
import type { RealtimeMessage, RealtimeRequest, WsEvent } from "./types";
import { telemetry } from "../../devtools/logEvent"; // 🌟 ایمپورت لایه مانیتورینگ

class BoardSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private boardId: string | null = null;
  private token: string | null = null;
  
  // تنظیمات Reconnection
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 7;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  
  // تنظیمات Heartbeat (Ping/Pong)
  private pingIntervalId: NodeJS.Timeout | null = null;
  private readonly PING_INTERVAL_MS = 30000; // ۳۰ ثانیه

  constructor(url: string) {
    this.url = url;
  }

  // ==========================================================================
  // 🔌 Connection Management
  // ==========================================================================

  public connect(boardId: string, token?: string) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.boardId === boardId) return;
      this.disconnect(); 
    }

    this.boardId = boardId;
    if (token) this.token = token;

    useBoardStore.setState({ syncStatus: "reconnecting" });

    // 🌟 TELEMETRY: ثبت تلاش برای اتصال
    telemetry.log("WS_INGRESS", "CONNECTING", { url: this.url, boardId });

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
    } catch (error: any) {
      console.error("[WebSocket] Failed to construct WebSocket", error);
      telemetry.log("WS_INGRESS", "CONSTRUCTOR_ERROR", { error: error.message });
      this.scheduleReconnect();
    }
  }

  public disconnect() {
    this.clearTimers();
    this.boardId = null;
    this.reconnectAttempts = 0;

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN && this.boardId) {
        this.send({ action: "unsubscribe", boardId: this.boardId });
      }
      this.ws.close();
      this.ws = null;
      
      // 🌟 TELEMETRY: ثبت خروج ارادی
      telemetry.log("WS_INGRESS", "DISCONNECTED_BY_CLIENT", {});
    }

    useBoardStore.setState({ syncStatus: "desynced" });
  }

  // ==========================================================================
  // 📡 Event Handlers
  // ==========================================================================

  private handleOpen() {
    console.log(`[WebSocket] Connected. Authenticating & Subscribing to board: ${this.boardId}`);
    
    this.reconnectAttempts = 0;
    const state = useBoardStore.getState();

    // 🌟 TELEMETRY: اتصال موفق و ارسال درخواست سابسکریب
    telemetry.log("WS_INGRESS", "CONNECTED", { lastSequence: state.boardSequence });

    const subscribeReq: RealtimeRequest = {
      action: "subscribe",
      boardId: this.boardId!,
      lastSequence: state.boardSequence,
      token: this.token || undefined,
    };

    this.send(subscribeReq);
    this.startHeartbeat();
  }

  private handleMessage(event: MessageEvent) {
    try {
      const message: RealtimeMessage = JSON.parse(event.data);

      switch (message.type) {
        case "EVENT":
          if (message.sequence && message.payload) {
            
            // 🌟 TELEMETRY: مهم‌ترین سنسور! شکار ایونت خام در بدو ورود به کلاینت
            telemetry.timeline(
              "WS_INGRESS",
              message.payload.type,
              { rawPayload: message.payload },
              { sequence: message.sequence, correlationId: message.payload.correlationId }
            );

            const wsEvent: WsEvent = {
              sequence: message.sequence,
              type: message.payload.type,
              payload: message.payload,
            };
            useBoardStore.getState().applyWebsocketEvent(wsEvent);
          }
          break;

        case "SYSTEM":
          if (message.meta?.reason === "SUBSCRIBED") {
            // 🌟 TELEMETRY: تاییدیه سرور
            telemetry.log("WS_INGRESS", "SUBSCRIBED_ACK", { boardId: this.boardId });
            useBoardStore.setState({ syncStatus: "healthy" });
          }
          break;

        case "RESYNC_REQUIRED":
          console.warn("[WebSocket] Resync required by server.");
          // 🌟 TELEMETRY: هشدار مرگبار! سرور می‌گوید گپ دیتای ما غیرقابل جبران است
          telemetry.log("WS_INGRESS", "FATAL_RESYNC_ORDERED", { reason: message.meta?.reason });
          useBoardStore.setState({ syncStatus: "desynced" });
          break;
      }
    } catch (error: any) {
      console.error("[WebSocket] Message parsing error:", error);
      telemetry.log("WS_INGRESS", "PARSE_ERROR", { rawData: event.data });
    }
  }

  private handleClose(event: CloseEvent) {
    console.warn(`[WebSocket] Closed: ${event.code} - ${event.reason}`);
    
    // 🌟 TELEMETRY: مانیتورینگ قطعی‌های ناگهانی اینترنت
    telemetry.log("WS_INGRESS", "CONNECTION_DROPPED", { code: event.code, reason: event.reason });
    
    this.clearTimers();
    this.ws = null;
    this.scheduleReconnect();
  }

  private handleError(error: Event) {
    console.error("[WebSocket] Error occurred", error);
    // onclose معمولاً بعد از onError صدا زده می‌شود
  }

  // ==========================================================================
  // ⚙️ Internal Utilities
  // ==========================================================================

  private send(payload: RealtimeRequest) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect() {
    if (!this.boardId) return; 
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[WebSocket] Max reconnect attempts reached. Giving up.");
      telemetry.log("WS_INGRESS", "RECONNECT_GIVEN_UP", { attempts: this.reconnectAttempts });
      useBoardStore.setState({ syncStatus: "desynced" });
      return;
    }

    useBoardStore.setState({ syncStatus: "reconnecting" });

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;

    // 🌟 TELEMETRY: مانیتورینگ طوفانِ ریکانکت (Reconnect Storm)
    telemetry.log("WS_INGRESS", "RECONNECT_SCHEDULED", { attempt: this.reconnectAttempts, delayMs: delay });

    console.log(`[WebSocket] Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimeoutId = setTimeout(() => {
      if (this.boardId) this.connect(this.boardId, this.token || undefined);
    }, delay);
  }

  private startHeartbeat() {
    if (this.pingIntervalId) clearInterval(this.pingIntervalId);
    
    this.pingIntervalId = setInterval(() => {
      this.send({ action: "ping", boardId: this.boardId! });
    }, this.PING_INTERVAL_MS);
  }

  private clearTimers() {
    if (this.pingIntervalId) clearInterval(this.pingIntervalId);
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    this.pingIntervalId = null;
    this.reconnectTimeoutId = null;
  }
}

// ============================================================================
// 🌍 Singleton Instance
// ============================================================================
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
export const boardSocket = new BoardSocketClient(WS_URL);