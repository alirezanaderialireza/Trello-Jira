// apps/web/src/features/board/store/sync/connection/effectRunner.ts
// ─────────────────────────────────────────────────────────────────────────────
// EffectRunner — executes ConnectionActor side-effects outside the FSM.
//
// The actor emits ConnectionEffect objects. This runner translates each into
// concrete imperative actions (open socket, start timer, etc.) without
// coupling the FSM or actor to any browser API.
//
// Every timer / socket handle is owned by the runner → no stale references.
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionEffect =
  | { type: "OPEN_SOCKET";    url: string; boardId: string; token?: string; lastSeq: string }
  | { type: "CLOSE_SOCKET" }
  | { type: "SEND_SUBSCRIBE"; boardId: string; lastSeq: string; token?: string }
  | { type: "SEND_PING";      boardId: string }
  | { type: "START_PING_TIMER";    intervalMs: number }
  | { type: "STOP_PING_TIMER" }
  | { type: "SCHEDULE_RECONNECT";  delayMs: number; attempt: number }
  | { type: "CANCEL_RECONNECT" }
  | { type: "NOTIFY_FSM";     event: import("./connectionActor").ConnectionEvent }
  | { type: "LOG";            level: "info" | "warn" | "error"; msg: string };

export interface EffectRunnerDeps {
  openSocket(url: string, boardId: string, token?: string): WebSocket;
  onSocketOpen(ws: WebSocket, handler: () => void): void;
  onSocketMessage(ws: WebSocket, handler: (e: MessageEvent) => void): void;
  onSocketClose(ws: WebSocket, handler: (e: CloseEvent) => void): void;
  onSocketError(ws: WebSocket, handler: (e: Event) => void): void;
  dispatchToFSM(event: import("./connectionActor").ConnectionEvent): void;
  sendOverSocket(ws: WebSocket, payload: unknown): void;
}

export class EffectRunner {
  private ws:             WebSocket | null = null;
  private pingTimer:      ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout>  | null = null;

  constructor(private readonly deps: EffectRunnerDeps) {}

  run(effect: ConnectionEffect): void {
    switch (effect.type) {
      case "OPEN_SOCKET": {
        this.closeSocket();
        try {
          const ws = this.deps.openSocket(effect.url, effect.boardId, effect.token);
          this.ws  = ws;
          this.deps.onSocketOpen(ws, () => {
            this.deps.dispatchToFSM({ type: "SOCKET_OPEN" });
          });
          this.deps.onSocketMessage(ws, (e) => {
            this.deps.dispatchToFSM({ type: "SOCKET_MESSAGE", data: e.data });
          });
          this.deps.onSocketClose(ws, (e) => {
            this.deps.dispatchToFSM({ type: "SOCKET_CLOSE", code: e.code, reason: e.reason });
          });
          this.deps.onSocketError(ws, () => {
            this.deps.dispatchToFSM({ type: "SOCKET_ERROR" });
          });
        } catch {
          this.deps.dispatchToFSM({ type: "SOCKET_ERROR" });
        }
        break;
      }
      case "CLOSE_SOCKET":
        this.closeSocket();
        break;

      case "SEND_SUBSCRIBE":
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.deps.sendOverSocket(this.ws, {
            action: "subscribe", boardId: effect.boardId,
            lastSequence: effect.lastSeq, token: effect.token,
          });
        }
        break;

      case "SEND_PING":
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.deps.sendOverSocket(this.ws, { action: "ping", boardId: effect.boardId });
        }
        break;

      case "START_PING_TIMER":
        this.stopPingTimer();
        this.pingTimer = setInterval(() => {
          this.deps.dispatchToFSM({ type: "PING_TICK" });
        }, effect.intervalMs);
        break;

      case "STOP_PING_TIMER":
        this.stopPingTimer();
        break;

      case "SCHEDULE_RECONNECT":
        this.cancelReconnect();
        this.reconnectTimer = setTimeout(() => {
          this.deps.dispatchToFSM({ type: "RECONNECT_TIMER_FIRED", attempt: effect.attempt });
        }, effect.delayMs);
        break;

      case "CANCEL_RECONNECT":
        this.cancelReconnect();
        break;

      case "NOTIFY_FSM":
        this.deps.dispatchToFSM(effect.event);
        break;

      case "LOG":
        if (process.env.NODE_ENV !== "production") {
          const fn = effect.level === "error" ? console.error
                   : effect.level === "warn"  ? console.warn
                   : console.log;
          fn(`[ConnectionActor] ${effect.msg}`);
        }
        break;
    }
  }

  getSocket(): WebSocket | null { return this.ws; }

  destroy(): void {
    this.closeSocket();
    this.stopPingTimer();
    this.cancelReconnect();
  }

  private closeSocket(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }
    this.ws = null;
  }
  private stopPingTimer():  void { if (this.pingTimer)      clearInterval(this.pingTimer);      this.pingTimer      = null; }
  private cancelReconnect(): void { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
}
