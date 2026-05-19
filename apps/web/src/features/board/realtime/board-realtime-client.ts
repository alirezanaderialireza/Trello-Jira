// apps/web/src/features/board/realtime/board-realtime-client.ts
//
// Phase-1.1 — BoardRealtimeClient (Integration Orchestrator)
//
// Wires together all Phase-1 abstractions into a single, coherent client:
//
//   ConnectionFSM       — WebSocket lifecycle, heartbeat, reconnect
//   SyncStateMachine    — 6-state FSM (offline → connected → ...)
//   SessionManager      — sessionId, connectionEpoch, resume cursor
//   OutboxProcessor     — mutation queue, retry, DLQ
//   EventPipeline       — 5-stage in-order event processing
//   Protocol            — serialise / parse WS messages
//
// ┌─────────────────────────────────────────────────────────────┐
// │  BoardRealtimeClient                                        │
// │                                                             │
// │  ConnectionFSM ──emit──▶ SyncFSM ──observe──▶ UI           │
// │       │                                                     │
// │  WebSocket.onmessage                                        │
// │       │                                                     │
// │  parseServerMessage                                         │
// │       │                                                     │
// │       ├── EVENT → runPipeline → BoardStore                  │
// │       ├── ACK   → OutboxProcessor.ack                      │
// │       ├── NACK  → OutboxProcessor.nack                     │
// │       ├── PONG  → ConnectionFSM.receivedPong               │
// │       └── RESYNC→ SyncFSM + trigger snapshot               │
// └─────────────────────────────────────────────────────────────┘

import { ConnectionFSM, type ConnectionConfig } from "./connection-fsm";
import {
  transition,
  INITIAL_SYNC_CONTEXT,
  type SyncState,
  type SyncEvent,
  type SyncContext,
} from "./sync-state";
import { SessionManager } from "./session-manager";
import { OutboxProcessor, type OutboxCallbacks } from "./outbox";
import {
  ReplayBuffer,
  runPipeline,
  type PipelineResult,
  type PipelineOutput,
} from "./event-pipeline";
import {
  parseServerMessage,
  serializeClientMessage,
  PROTOCOL_VERSION,
  CATCH_UP_MAX_EVENTS,
  type ClientMessage,
  type ServerMessage,
} from "./protocol";
import { parseSequence } from "../store/event-application/sequence";
import type { BoardStoreState, BoardSnapshot } from "../store/useBoardStore";

// ============================================================================
// Types
// ============================================================================

/**
 * Reducer function signature — same as dispatcher.applyEvent.
 * Injected so this class has zero direct store dependency.
 */
export type ReducerFn = (
  state:    BoardStoreState,
  envelope: { event: unknown; acknowledged?: boolean },
  ctx:      { mode: "live" },
) => Partial<BoardStoreState>;

export interface BoardRealtimeConfig {
  connection: Partial<ConnectionConfig>;
  replayBufferMaxSize?: number;
  /** Callback fired when SyncContext changes — connect to Zustand setter here */
  onSyncContextChange:  (ctx: SyncContext) => void;
  /** Callback to apply a state patch to the board store */
  onStatePatch:         (patch: Partial<BoardStoreState>) => void;
  /** Callback to get current board store state */
  getState:             () => BoardStoreState;
  /** Callback to roll back optimistic state */
  onRollback:           (snapshot: BoardSnapshot, correlationId: string) => void;
  /** Reducer — injected from dispatcher.ts */
  reducer:              ReducerFn;
  /** Called when invariant violations detected after dispatch (trigger resync) */
  onViolations?:        (violations: unknown[]) => void;
  /** Called when DLQ item added */
  onPoisonMutation?:    (item: unknown) => void;
}

// ============================================================================
// BoardRealtimeClient
// ============================================================================

export class BoardRealtimeClient {
  // ── sub-systems ────────────────────────────────────────────────────────────
  private readonly connectionFsm: ConnectionFSM;
  private readonly session:       SessionManager;
  private readonly outbox:        OutboxProcessor;
  private readonly buffer:        ReplayBuffer;

  // ── sync state ────────────────────────────────────────────────────────────
  private syncCtx: SyncContext = { ...INITIAL_SYNC_CONTEXT };

  // ── current board ─────────────────────────────────────────────────────────
  private boardId: string | null = null;

  private readonly cfg: BoardRealtimeConfig;

  // ── construction ─────────────────────────────────────────────────────────

  constructor(cfg: BoardRealtimeConfig) {
    this.cfg = cfg;

    this.session = new SessionManager();

    this.buffer = new ReplayBuffer(cfg.replayBufferMaxSize ?? 500);

    // Outbox callbacks delegate to cfg — keeps this class decoupled
    const outboxCallbacks: OutboxCallbacks = {
      send:     (payload) => this.connectionFsm.send(payload),
      rollback: (snapshot, corrId) => cfg.onRollback(snapshot, corrId),
      onPoison: (item) => cfg.onPoisonMutation?.(item),
    };

    this.outbox = new OutboxProcessor(outboxCallbacks);

    // ConnectionFSM emits SyncEvents which drive our SyncFSM
    this.connectionFsm = new ConnectionFSM(
      { ...cfg.connection },
      (event: SyncEvent) => this._handleConnectionEvent(event),
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Open a realtime connection to a board.
   * Idempotent — safe to call again after disconnect.
   */
  connect(boardId: string, token?: string): void {
    this.boardId = boardId;
    this.outbox.start();

    const session = this.session.start(boardId);
    this._transitionSync({ type: "CONNECT_REQUESTED", boardId, token });

    this.connectionFsm.connect(boardId, token);
  }

  /**
   * Gracefully disconnect from the current board.
   */
  disconnect(): void {
    this._transitionSync({ type: "DISCONNECT_REQUESTED" });
    this.connectionFsm.disconnect();
    this.outbox.setConnected(false);
    this.buffer.clear();
  }

  /**
   * Enqueue an optimistic mutation for reliable delivery.
   * Returns false if the outbox is at backpressure capacity.
   */
  sendMutation(payload: {
    mutationId:        string;
    correlationId:     string;
    payload:           unknown;
    rollbackSnapshot?: BoardSnapshot;
  }): boolean {
    if (!this.boardId) return false;

    const session = this.session.current;
    if (!session) return false;

    const wsMsg: ClientMessage = {
      type:            "MUTATION",
      messageId:       globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
      correlationId:   payload.correlationId,
      mutationId:      payload.mutationId,
      boardId:         this.boardId,
      payload:         payload.payload as never,  // AppDomainEvent
      sessionId:       session.sessionId,
      connectionEpoch: session.connectionEpoch,
    };

    return this.outbox.enqueue({
      mutationId:       payload.mutationId,
      correlationId:    payload.correlationId,
      payload:          wsMsg,
      boardId:          this.boardId,
      rollbackSnapshot: payload.rollbackSnapshot,
    });
  }

  /**
   * Register a raw WebSocket message handler.
   * Call this immediately after the WS `onmessage` fires.
   * The underlying WS is owned by ConnectionFSM but messages are parsed here.
   */
  handleRawMessage(raw: string): void {
    const msg = parseServerMessage(raw);
    if (!msg) return;
    this._handleServerMessage(msg);
  }

  get syncContext(): SyncContext { return { ...this.syncCtx }; }

  get syncState(): SyncState { return this.syncCtx.state; }

  destroy(): void {
    this.disconnect();
    this.outbox.destroy();
    this.connectionFsm.destroy();
    this.session.clear();
  }

  // ── ConnectionFSM event handler ───────────────────────────────────────────

  private _handleConnectionEvent(event: SyncEvent): void {
    switch (event.type) {
      case "WS_OPEN": {
        // Socket is open — send CONNECT or RESUME
        this._sendHandshake();
        break;
      }

      case "WS_CLOSED":
      case "WS_ERROR": {
        this.outbox.setConnected(false);
        this.session.incrementEpoch();
        break;
      }

      case "RECONNECT_EXHAUSTED": {
        this.session.clear();
        break;
      }

      default: break;
    }

    this._transitionSync(event);
  }

  // ── Server message handler ────────────────────────────────────────────────

  private _handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "SUBSCRIBED": {
        this._handleSubscribed(msg);
        break;
      }

      case "EVENT": {
        this._processFrame({ sequence: msg.sequence, payload: msg.payload });
        break;
      }

      case "EVENT_BATCH": {
        for (const ev of msg.events) {
          this._processFrame(ev);
        }
        break;
      }

      case "SERVER_ACK": {
        this.outbox.ack(msg.mutationId);
        this.session.ackSequence(msg.sequence);
        break;
      }

      case "SERVER_NACK": {
        this.outbox.nack(msg.mutationId, msg.reason, msg.retryable);
        break;
      }

      case "RESYNC_REQUIRED": {
        this._handleResyncRequired(msg.serverSequence, msg.reason);
        break;
      }

      case "PONG": {
        this.connectionFsm.receivedPong();
        this._transitionSync({ type: "HEARTBEAT_OK" });
        break;
      }
    }
  }

  // ── SUBSCRIBED ─────────────────────────────────────────────────────────────

  private _handleSubscribed(msg: { sessionId: string; currentSequence: string; connectionEpoch: number }): void {
    this.outbox.setConnected(true);
    this._transitionSync({ type: "SERVER_SUBSCRIBED" });

    const state = this.cfg.getState();
    const clientSeq = parseSequence(state.boardSequence);
    const serverSeq = parseSequence(msg.currentSequence);

    if (serverSeq <= clientSeq) {
      // Already up-to-date — nothing to do
      return;
    }

    const gap = serverSeq - clientSeq;
    if (gap > BigInt(CATCH_UP_MAX_EVENTS)) {
      // Gap too large — trigger resync
      this._handleResyncRequired(msg.currentSequence, `gap_too_large:${gap}`);
    } else {
      // Manageable gap — let replay buffer handle it
      this._transitionSync({
        type:     "GAP_DETECTED",
        missing:  String(clientSeq + 1n),
        expected: msg.currentSequence,
      });
    }
  }

  // ── Event processing ───────────────────────────────────────────────────────

  private _processFrame(frame: { sequence: string; payload: unknown }): void {
    const state = this.cfg.getState();

    const result: PipelineResult<PipelineOutput> = runPipeline(
      { sequence: frame.sequence, type: (frame.payload as any)?.type, payload: frame.payload },
      state,
      this.buffer,
      this.cfg.reducer as never,
    );

    if (!result.ok) {
      // Pipeline error — log and potentially trigger resync
      console.error("[BoardRealtimeClient] Pipeline error", result.stage, result.reason);
      if (result.stage === "buffer") {
        // Buffer full — must resync
        this._handleResyncRequired(state.boardSequence, "buffer_full");
      }
      return;
    }

    const out = result.value;

    if (out.violations.length > 0) {
      console.error("[BoardRealtimeClient] Invariant violations", out.violations);
      this.cfg.onViolations?.(out.violations);
      // Trigger resync to recover from corrupt state
      this._handleResyncRequired(out.newSequence, "invariant_violation");
      return;
    }

    // Apply the new state
    if (out.newSequence !== state.boardSequence) {
      this.cfg.onStatePatch({
        ...out.nextState,
        syncStatus: "healthy",
      });
      this.session.ackSequence(out.newSequence);

      // If we were catching-up and buffer is now empty → resolved
      if (
        this.syncCtx.state === "catching-up" &&
        this.buffer.size === 0
      ) {
        this._transitionSync({ type: "GAP_RESOLVED" });
      }
    }
  }

  // ── Resync ─────────────────────────────────────────────────────────────────

  private _handleResyncRequired(serverSequence: string, reason: string): void {
    const state = this.cfg.getState();

    const gap = parseSequence(serverSequence) - parseSequence(state.boardSequence);

    if (gap > BigInt(CATCH_UP_MAX_EVENTS)) {
      this._transitionSync({ type: "GAP_IRRECOVERABLE", currentSeq: state.boardSequence, serverSeq: serverSequence });
    }

    this._transitionSync({ type: "SERVER_RESYNC_REQUIRED", reason });
    this.buffer.clear();
    // Snapshot fetch is triggered by the consumer observing the "resyncing" state
    this._transitionSync({ type: "SNAPSHOT_STARTED" });
  }

  // ── Handshake ─────────────────────────────────────────────────────────────

  private _sendHandshake(): void {
    const session = this.session.current;
    if (!session || !this.boardId) return;

    let msg: ClientMessage;

    if (this.session.canResume) {
      msg = {
        type:               "RESUME",
        protocolVersion:    PROTOCOL_VERSION,
        messageId:          globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
        boardId:            this.boardId,
        sessionId:          session.sessionId,
        lastAckedSequence:  session.lastAckedSequence,
        connectionEpoch:    session.connectionEpoch,
      };
    } else {
      msg = {
        type:            "CONNECT",
        protocolVersion: PROTOCOL_VERSION,
        messageId:       globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
        boardId:         this.boardId,
      };
    }

    this.connectionFsm.send(serializeClientMessage(msg));
  }

  // ── SyncFSM transition ────────────────────────────────────────────────────

  private _transitionSync(event: SyncEvent): void {
    try {
      const result = transition(this.syncCtx.state, event);
      if (!result.changed) return;

      this.syncCtx = {
        ...this.syncCtx,
        state:         result.nextState,
        boardId:       this.boardId,
        lastSequence:  this.session.lastAckedSequence,
        reconnectCount: this.connectionFsm.currentReconnectAttempts,
      };

      this.cfg.onSyncContextChange({ ...this.syncCtx });
    } catch {
      // Illegal transition in dev — already throws from sync-state.ts
      // In production this is a no-op (state unchanged)
    }
  }
}
