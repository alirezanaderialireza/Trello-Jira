// apps/web/src/features/board/store/sync/connection/connectionActor.ts
// ─────────────────────────────────────────────────────────────────────────────
// ConnectionActor — actor-model WebSocket lifecycle.
//
// Architecture:
//   External code → mailbox.send(event) → serialized processor
//     → pure transition(state, event) → [nextState, effects[]]
//     → effectRunner.run(effect) for each
//
// This eliminates all races:
//   • SOCKET_OPEN arriving while RECONNECT is pending? Handled serially.
//   • PING_TICK during reconnection? Ignored by FSM, no stale timer action.
//   • Multiple CLOSE events? Only first transitions out of "connected".
//
// Pure transition function is fully testable with zero browser APIs.
// ─────────────────────────────────────────────────────────────────────────────

import { ActorMailbox }  from "./actorMailbox";
import { EffectRunner }  from "./effectRunner";
import type { ConnectionEffect } from "./effectRunner";
import type { EffectRunnerDeps } from "./effectRunner";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "subscribing"
  | "subscribed"
  | "reconnecting"
  | "closed";

export type ConnectionEvent =
  | { type: "CONNECT";              url: string; boardId: string; token?: string; lastSeq: string }
  | { type: "DISCONNECT" }
  | { type: "SOCKET_OPEN" }
  | { type: "SOCKET_MESSAGE";       data: string }
  | { type: "SOCKET_CLOSE";         code: number; reason: string }
  | { type: "SOCKET_ERROR" }
  | { type: "PING_TICK" }
  | { type: "PING_TIMEOUT" }
  | { type: "RECONNECT_TIMER_FIRED";attempt: number }
  | { type: "AUTH_EXPIRED" }
  | { type: "SUBSCRIBED_ACK" };

interface ConnectionContext {
  url:             string;
  boardId:         string;
  token?:          string;
  lastSeq:         string;
  reconnectAttempt: number;
  maxAttempts:     number;
  pingIntervalMs:  number;
}

type TransitionResult = { state: ConnectionState; ctx: ConnectionContext; effects: ConnectionEffect[] };

const DEFAULT_CTX: ConnectionContext = {
  url: "", boardId: "", lastSeq: "0", reconnectAttempt: 0,
  maxAttempts: 7, pingIntervalMs: 30_000,
};

// ── Pure Transition ───────────────────────────────────────────────────────────

export function transition(
  state: ConnectionState,
  ctx:   ConnectionContext,
  event: ConnectionEvent,
): TransitionResult {
  switch (state) {
    case "idle":
      if (event.type === "CONNECT") {
        const newCtx = { ...ctx, url: event.url, boardId: event.boardId,
                          token: event.token, lastSeq: event.lastSeq,
                          reconnectAttempt: 0 };
        return { state: "connecting", ctx: newCtx, effects: [
          { type: "OPEN_SOCKET", url: event.url, boardId: event.boardId,
            token: event.token, lastSeq: event.lastSeq },
        ]};
      }
      break;

    case "connecting":
      if (event.type === "SOCKET_OPEN") {
        return { state: "subscribing", ctx, effects: [
          { type: "SEND_SUBSCRIBE", boardId: ctx.boardId, lastSeq: ctx.lastSeq, token: ctx.token },
        ]};
      }
      if (event.type === "SOCKET_CLOSE" || event.type === "SOCKET_ERROR") {
        return scheduleReconnect(ctx);
      }
      if (event.type === "DISCONNECT") return closeAll(ctx);
      break;

    case "subscribing":
      if (event.type === "SUBSCRIBED_ACK") {
        return { state: "subscribed", ctx: { ...ctx, reconnectAttempt: 0 }, effects: [
          { type: "START_PING_TIMER", intervalMs: ctx.pingIntervalMs },
        ]};
      }
      if (event.type === "SOCKET_CLOSE" || event.type === "SOCKET_ERROR") {
        return scheduleReconnect(ctx);
      }
      if (event.type === "DISCONNECT") return closeAll(ctx);
      break;

    case "subscribed":
      if (event.type === "PING_TICK") {
        return { state: "subscribed", ctx, effects: [
          { type: "SEND_PING", boardId: ctx.boardId },
        ]};
      }
      if (event.type === "SOCKET_CLOSE" || event.type === "SOCKET_ERROR") {
        return scheduleReconnect({ ...ctx });
      }
      if (event.type === "DISCONNECT") return closeAll(ctx);
      if (event.type === "AUTH_EXPIRED") return closeAll(ctx);
      break;

    case "reconnecting":
      if (event.type === "RECONNECT_TIMER_FIRED") {
        if (ctx.reconnectAttempt >= ctx.maxAttempts) {
          return { state: "closed", ctx, effects: [
            { type: "LOG", level: "error", msg: "Max reconnect attempts reached" },
          ]};
        }
        return { state: "connecting", ctx, effects: [
          { type: "OPEN_SOCKET", url: ctx.url, boardId: ctx.boardId,
            token: ctx.token, lastSeq: ctx.lastSeq },
        ]};
      }
      if (event.type === "DISCONNECT") return closeAll(ctx);
      // ignore stale SOCKET_CLOSE/ERROR while already reconnecting
      break;

    case "closed":
      if (event.type === "CONNECT") {
        return transition("idle", { ...ctx, reconnectAttempt: 0 }, event);
      }
      break;
  }

  // Unknown / ignored event — no transition
  return { state, ctx, effects: [] };
}

function scheduleReconnect(ctx: ConnectionContext): TransitionResult {
  const attempt = ctx.reconnectAttempt + 1;
  const delay   = Math.min(1_000 * 2 ** (attempt - 1), 15_000);
  return {
    state:   "reconnecting",
    ctx:     { ...ctx, reconnectAttempt: attempt },
    effects: [
      { type: "STOP_PING_TIMER" },
      { type: "SCHEDULE_RECONNECT", delayMs: delay, attempt },
    ],
  };
}

function closeAll(ctx: ConnectionContext): TransitionResult {
  return {
    state:   "closed",
    ctx:     { ...ctx, reconnectAttempt: 0 },
    effects: [
      { type: "CLOSE_SOCKET" },
      { type: "STOP_PING_TIMER" },
      { type: "CANCEL_RECONNECT" },
    ],
  };
}

// ── ConnectionActor ───────────────────────────────────────────────────────────

export type MessageObserver = (event: ConnectionEvent, state: ConnectionState) => void;

export class ConnectionActor {
  private state:    ConnectionState = "idle";
  private ctx:      ConnectionContext = { ...DEFAULT_CTX };
  private readonly mailbox:  ActorMailbox<ConnectionEvent>;
  private readonly runner:   EffectRunner;
  private observers = new Set<MessageObserver>();

  constructor(
    deps: EffectRunnerDeps,
    overrides?: Partial<ConnectionContext>,
  ) {
    if (overrides) this.ctx = { ...DEFAULT_CTX, ...overrides };

    // Inject dispatchToFSM so socket callbacks re-enter the mailbox
    const self = this;
    this.runner = new EffectRunner({
      ...deps,
      dispatchToFSM: (ev) => self.send(ev),
    });

    this.mailbox = new ActorMailbox<ConnectionEvent>((event) => {
      const result = transition(this.state, this.ctx, event);
      this.state   = result.state;
      this.ctx     = result.ctx;
      for (const eff of result.effects) this.runner.run(eff);
      for (const obs of this.observers) { try { obs(event, this.state); } catch { /**/ } }
    });
  }

  /** The ONLY way to interact with the actor from the outside */
  send(event: ConnectionEvent): void { this.mailbox.send(event); }

  getState(): ConnectionState { return this.state; }

  subscribe(obs: MessageObserver): () => void {
    this.observers.add(obs);
    return () => this.observers.delete(obs);
  }

  destroy(): void {
    this.mailbox.clear();
    this.runner.destroy();
    this.observers.clear();
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _actor: ConnectionActor | null = null;

export function getConnectionActor(): ConnectionActor | null { return _actor; }

export function createConnectionActor(
  deps: EffectRunnerDeps,
  overrides?: Partial<ConnectionContext>,
): ConnectionActor {
  _actor?.destroy();
  _actor = new ConnectionActor(deps, overrides);
  return _actor;
}

export function destroyConnectionActor(): void {
  _actor?.destroy();
  _actor = null;
}
