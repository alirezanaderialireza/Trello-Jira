// apps/web/src/features/board/realtime/board-realtime-client.ts
//
// Phase-1.2 — BoardRealtimeClient (Integration Orchestrator)
//
// Changes from Phase-1.1:
//
//   #4  _handleSubscribed() gap logic completed:
//         - CatchUpSource interface defined (transport-agnostic)
//         - when gap <= CATCH_UP_MAX_EVENTS and catchUpSource is provided:
//             trigger async catch-up fetch → inject frames into pipeline
//         - when catchUpSource is absent: log warning (server-replay path)
//
//   #5  Silent FSM failure fixed:
//         - bare `catch {}` replaced with structured error logging
//         - _transitionSync() now accepts optional context for telemetry
//
//   #1  Reconciliation: _processFrame() now reads originMutationId/originSessionId
//         from server events and skips double-apply for own-echo events.
//
//   #6  AUTH_REQUIRED handling added: triggers disconnect + onAuthRequired callback.

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
  type ServerSubscribed,
} from "./protocol";
import { parseSequence } from "../store/event-application/sequence";
import type { BoardStoreState, BoardSnapshot } from "../store/useBoardStore";

// ============================================================================
// CatchUpSource — transport-agnostic catch-up contract (#4)
// ============================================================================

export interface CatchUpFrame {
  sequence:           string;
  payload:            unknown;
  originMutationId?:  string;
  originSessionId?:   string;
}

/**
 * CatchUpSource is injected into BoardRealtimeClient.
 * It abstracts the transport used to fetch missed events.
 *
 * Option A (recommended): server sends EVENT_BATCH after SUBSCRIBED.
 *   → inject a no-op source; events arrive over the existing WS connection.
 *
 * Option B: HTTP endpoint.
 *   → implement with fetch() pointing to /boards/:id/events?after=seq
 *
 * The client does not care which transport is used — it only calls fetch().
 */
export interface CatchUpSource {
  /**
   * Fetch events after `afterSequence` (exclusive).
   * Returns frames in ascending sequence order.
   * Called once per gap detection; if it throws, the client falls back to resync.
   */
  fetch(boardId: string, afterSequence: string): Promise<ReadonlyArray<CatchUpFrame>>;
}

// ============================================================================
// Types
// ============================================================================

/** Reducer function signature — injected to keep this class store-agnostic. */
export type ReducerFn = (
  state:    BoardStoreState,
  envelope: { event: unknown; acknowledged?: boolean },
  ctx:      { mode: "live" },
) => Partial<BoardStoreState>;

/** Structured logger injected by the consumer. Defaults to console.*. */
export interface RealtimeLogger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

const defaultLogger: RealtimeLogger = {
  info:  (event, data) => console.log(`[Realtime:INFO] ${event}`, data ?? ""),
  warn:  (event, data) => console.warn(`[Realtime:WARN] ${event}`, data ?? ""),
  error: (event, data) => console.error(`[Realtime:ERROR] ${event}`, data ?? ""),
};

export interface BoardRealtimeConfig {
  connection: Partial<ConnectionConfig>;
  replayBufferMaxSize?: number;

  /** (#4) Source for incremental catch-up. If absent, relies on server-side EVENT_BATCH replay. */
  catchUpSource?: CatchUpSource;

  /** (#5) Structured logger — defaults to console.* */
  logger?: RealtimeLogger;

  /** Callback fired when SyncContext changes */
  onSyncContextChange:  (ctx: SyncContext) => void;
  /** Callback to apply a state patch to the board store */
  onStatePatch:         (patch: Partial<BoardStoreState>) => void;
  /** Callback to get current board store state */
  getState:             () => BoardStoreState;
  /** Callback to roll back optimistic state */
  onRollback:           (snapshot: BoardSnapshot, correlationId: string) => void;
  /** Reducer — injected from dispatcher.ts */
  reducer:              ReducerFn;
  /** Called when invariant violations detected after dispatch */
  onViolations?:        (violations: unknown[]) => void;
  /** Called when DLQ item added */
  onPoisonMutation?:    (item: unknown) => void;
  /** (#6) Called when server returns AUTH_REQUIRED — must re-authenticate */
  onAuthRequired?:      (code: string, reason: string) => void;
}

// ============================================================================
// BoardRealtimeClient
// ============================================================================

export class BoardRealtimeClient {
  // ── sub-systems ─────────────────────────────────────────────────────────────
  private readonly connectionFsm: ConnectionFSM;
  private readonly session:       SessionManager;
  private readonly outbox:        OutboxProcessor;
  private readonly buffer:        ReplayBuffer;
  private readonly log:           RealtimeLogger;

  // ── state ────────────────────────────────────────────────────────────────────
  private syncCtx: SyncContext = { ...INITIAL_SYNC_CONTEXT };
  private boardId: string | null = null;

  // ── server capabilities (populated on SUBSCRIBED) ───────────────────────────
  private serverCapabilities = {
    batching:    true,
    replay:      true,
    presence:    false,
    awareness:   false,
    compression: false,
  };

  private readonly cfg: BoardRealtimeConfig;

  // ── construction ─────────────────────────────────────────────────────────────

  constructor(cfg: BoardRealtimeConfig) {
    this.cfg = cfg;
    this.log = cfg.logger ?? defaultLogger;

    this.session = new SessionManager();
    this.buffer  = new ReplayBuffer(cfg.replayBufferMaxSize ?? 500);

    const outboxCallbacks: OutboxCallbacks = {
      send:     (payload) => this.connectionFsm.send(payload),
      rollback: (snapshot, corrId) => cfg.onRollback(snapshot, corrId),
      onPoison: (item) => cfg.onPoisonMutation?.(item),
    };

    this.outbox = new OutboxProcessor(outboxCallbacks);

    this.connectionFsm = new ConnectionFSM(
      { ...cfg.connection },
      (event: SyncEvent) => this._handleConnectionEvent(event),
    );
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  connect(boardId: string, token?: string): void {
    this.boardId = boardId;
    this.outbox.start();
    this.session.start(boardId);
    this._transitionSync({ type: "CONNECT_REQUESTED", boardId, token }, { boardId });
    this.connectionFsm.connect(boardId, token);
  }

  disconnect(): void {
    this._transitionSync({ type: "DISCONNECT_REQUESTED" });
    this.connectionFsm.disconnect();
    this.outbox.setConnected(false);
    this.buffer.clear();
    this.log.info("disconnected", { boardId: this.boardId ?? "" });
  }

  sendMutation(payload: {
    mutationId:        string;
    correlationId:     string;
    payload:           unknown;
    rollbackSnapshot?: BoardSnapshot;
  }): boolean {
    if (!this.boardId) {
      this.log.warn("sendMutation_no_board");
      return false;
    }

    const session = this.session.current;
    if (!session) {
      this.log.warn("sendMutation_no_session");
      return false;
    }

    const wsMsg: ClientMessage = {
      type:            "MUTATION",
      messageId:       globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
      correlationId:   payload.correlationId,
      mutationId:      payload.mutationId,
      boardId:         this.boardId,
      payload:         payload.payload as never,
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

  handleRawMessage(raw: string): void {
    const msg = parseServerMessage(raw);
    if (!msg) {
      this.log.warn("parse_failed", { raw: raw.slice(0, 200) });
      return;
    }
    this._handleServerMessage(msg);
  }

  get syncContext(): SyncContext { return { ...this.syncCtx }; }
  get syncState():  SyncState   { return this.syncCtx.state; }

  destroy(): void {
    this.disconnect();
    this.outbox.destroy();
    this.connectionFsm.destroy();
    this.session.clear();
  }

  // ── ConnectionFSM event handler ──────────────────────────────────────────────

  private _handleConnectionEvent(event: SyncEvent): void {
    switch (event.type) {
      case "WS_OPEN": {
        this._sendHandshake();
        break;
      }
      case "WS_CLOSED":
      case "WS_ERROR": {
        this.outbox.setConnected(false);
        this.session.incrementEpoch();
        this.log.warn("ws_connection_lost", {
          type:  event.type,
          board: this.boardId ?? "",
          epoch: this.session.connectionEpoch,
        });
        break;
      }
      case "RECONNECT_EXHAUSTED": {
        this.session.clear();
        this.log.error("reconnect_exhausted", { board: this.boardId ?? "" });
        break;
      }
      case "HEARTBEAT_STALE": {
        this.log.warn("heartbeat_stale", { missedMs: (event as { missedMs?: number }).missedMs });
        break;
      }
      default: break;
    }

    this._transitionSync(event);
  }

  // ── Server message handler ───────────────────────────────────────────────────

  private _handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "SUBSCRIBED":      this._handleSubscribed(msg); break;
      case "EVENT":           this._processFrame(msg); break;
      case "EVENT_BATCH":     msg.events.forEach((ev) => this._processFrame(ev)); break;
      case "SERVER_ACK":      this._handleAck(msg); break;
      case "SERVER_NACK":     this.outbox.nack(msg.mutationId, msg.reason, msg.retryable); break;
      case "RESYNC_REQUIRED": this._handleResyncRequired(msg.serverSequence, msg.reason); break;
      case "PONG": {
        this.connectionFsm.receivedPong();
        this._transitionSync({ type: "HEARTBEAT_OK" });
        break;
      }
      case "AUTH_REQUIRED": {  // (#6)
        this.log.error("auth_required", { code: msg.code, reason: msg.reason });
        this.cfg.onAuthRequired?.(msg.code, msg.reason);
        // Auth failure is not retryable — disconnect cleanly
        this.disconnect();
        break;
      }
    }
  }

  // ── ACK ──────────────────────────────────────────────────────────────────────

  private _handleAck(msg: { mutationId: string; sequence: string }): void {
    this.outbox.ack(msg.mutationId);
    this.session.ackSequence(msg.sequence);
    this.log.info("mutation_acked", { mutationId: msg.mutationId, seq: msg.sequence });
  }

  // ── SUBSCRIBED with gap detection + catch-up (#4) ───────────────────────────

  private _handleSubscribed(msg: ServerSubscribed): void {
    // Persist server capabilities for feature-flag checks
    this.serverCapabilities = { ...this.serverCapabilities, ...msg.capabilities };

    this.outbox.setConnected(true);
    this._transitionSync({ type: "SERVER_SUBSCRIBED" });

    this.log.info("subscribed", {
      session:          msg.sessionId,
      serverSeq:        msg.currentSequence,
      capabilities:     msg.capabilities,
    });

    const state     = this.cfg.getState();
    const clientSeq = parseSequence(state.boardSequence);
    const serverSeq = parseSequence(msg.currentSequence);

    if (serverSeq <= clientSeq) {
      // Already up-to-date
      return;
    }

    const gap = serverSeq - clientSeq;

    if (gap > BigInt(CATCH_UP_MAX_EVENTS)) {
      this.log.warn("gap_too_large_resync", { gap: String(gap), clientSeq: String(clientSeq), serverSeq: String(serverSeq) });
      this._handleResyncRequired(msg.currentSequence, `gap_too_large:${gap}`);
      return;
    }

    // Manageable gap
    this._transitionSync({
      type:     "GAP_DETECTED",
      missing:  String(clientSeq + 1n),
      expected: msg.currentSequence,
    });

    this.log.info("gap_detected_catchup", { missing: String(clientSeq + 1n), expected: msg.currentSequence });

    // (#4) If a CatchUpSource is injected, fetch incrementally.
    // If not, the server is expected to send EVENT_BATCH over the WS connection.
    if (this.cfg.catchUpSource && this.boardId) {
      this._runCatchUp(this.boardId, state.boardSequence, msg.currentSequence);
    } else {
      this.log.info("catchup_via_server_batch", {
        note: "No CatchUpSource injected — expecting server to replay via EVENT_BATCH",
      });
    }
  }

  // ── Catch-up fetch (#4) ──────────────────────────────────────────────────────

  private async _runCatchUp(
    boardId:     string,
    afterSeq:    string,
    targetSeq:   string,
  ): Promise<void> {
    const source = this.cfg.catchUpSource!;

    try {
      const frames = await source.fetch(boardId, afterSeq);

      this.log.info("catchup_frames_received", { count: frames.length, afterSeq, targetSeq });

      for (const frame of frames) {
        this._processFrame(frame);
      }

      // Check if gap is resolved
      const state     = this.cfg.getState();
      const clientSeq = parseSequence(state.boardSequence);
      const target    = parseSequence(targetSeq);

      if (clientSeq >= target && this.syncCtx.state === "catching-up") {
        this._transitionSync({ type: "GAP_RESOLVED" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error("catchup_fetch_failed", { reason: msg, afterSeq, targetSeq });
      // Fall back to full resync
      this._handleResyncRequired(targetSeq, `catchup_failed:${msg}`);
    }
  }

  // ── Event processing with reconciliation (#1) ────────────────────────────────

  private _processFrame(frame: {
    sequence:            string;
    payload:             unknown;
    originMutationId?:   string;
    originSessionId?:    string;
  }): void {
    const state      = this.cfg.getState();
    const mySession  = this.session.current;

    // (#1) Reconciliation: is this our own event echoed back?
    const isOwnEcho =
      mySession &&
      frame.originSessionId === mySession.sessionId &&
      frame.originMutationId !== undefined;

    if (isOwnEcho) {
      // This is the authoritative confirmation of our optimistic write.
      // The reducer already applied an optimistic version — do NOT re-apply.
      // Just advance the sequence and let outbox.ack() clean up.
      this.session.ackSequence(frame.sequence);
      this.cfg.onStatePatch({
        boardSequence: frame.sequence,
        syncStatus:    "healthy",
      });
      this.log.info("own_echo_reconciled", {
        mutationId: frame.originMutationId,
        seq:        frame.sequence,
      });
      // Resolve gap if buffer empty
      if (this.syncCtx.state === "catching-up" && this.buffer.size === 0) {
        this._transitionSync({ type: "GAP_RESOLVED" });
      }
      return;
    }

    // Normal (remote) event — run through the full pipeline
    const result: PipelineResult<PipelineOutput> = runPipeline(
      {
        sequence: frame.sequence,
        type:     (frame.payload as Record<string, unknown>)?.type as string,
        payload:  frame.payload,
      },
      state,
      this.buffer,
      this.cfg.reducer as never,
    );

    if (!result.ok) {
      this.log.error("pipeline_error", {
        stage:  result.stage,
        reason: result.reason,
        seq:    frame.sequence,
      });
      if (result.stage === "buffer") {
        this._handleResyncRequired(state.boardSequence, "buffer_full");
      }
      return;
    }

    const out = result.value;

    if (out.violations.length > 0) {
      this.log.error("invariant_violations", {
        count:      out.violations.length,
        violations: out.violations.map((v: unknown) =>
          typeof v === "object" && v !== null && "message" in v
            ? (v as { message: string }).message
            : String(v),
        ),
        seq: out.newSequence,
      });
      this.cfg.onViolations?.(out.violations);
      this._handleResyncRequired(out.newSequence, "invariant_violation");
      return;
    }

    if (out.newSequence !== state.boardSequence) {
      this.cfg.onStatePatch({ ...out.nextState, syncStatus: "healthy" });
      this.session.ackSequence(out.newSequence);

      if (this.syncCtx.state === "catching-up" && this.buffer.size === 0) {
        this._transitionSync({ type: "GAP_RESOLVED" });
      }
    }
  }

  // ── Resync ───────────────────────────────────────────────────────────────────

  private _handleResyncRequired(serverSequence: string, reason: string): void {
    const state     = this.cfg.getState();
    const gap       = parseSequence(serverSequence) - parseSequence(state.boardSequence);

    this.log.warn("resync_required", {
      reason,
      serverSeq: serverSequence,
      clientSeq: state.boardSequence,
      gap:       String(gap),
    });

    if (gap > BigInt(CATCH_UP_MAX_EVENTS)) {
      this._transitionSync({
        type:       "GAP_IRRECOVERABLE",
        currentSeq: state.boardSequence,
        serverSeq:  serverSequence,
      });
    }

    this._transitionSync({ type: "SERVER_RESYNC_REQUIRED", reason });
    this.buffer.clear();
    this._transitionSync({ type: "SNAPSHOT_STARTED" });
    // Consumer observes "resyncing" state and triggers snapshot fetch
  }

  // ── Handshake ────────────────────────────────────────────────────────────────

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
      this.log.info("handshake_resume", { sessionId: session.sessionId, seq: session.lastAckedSequence });
    } else {
      msg = {
        type:            "CONNECT",
        protocolVersion: PROTOCOL_VERSION,
        messageId:       globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
        boardId:         this.boardId,
      };
      this.log.info("handshake_connect", { boardId: this.boardId });
    }

    this.connectionFsm.send(serializeClientMessage(msg));
  }

  // ── SyncFSM transition with structured error logging (#5) ────────────────────

  private _transitionSync(
    event:   SyncEvent,
    context?: Record<string, unknown>,
  ): void {
    const fromState = this.syncCtx.state;

    try {
      const result = transition(fromState, event);
      if (!result.changed) return;

      this.syncCtx = {
        ...this.syncCtx,
        state:          result.nextState,
        boardId:        this.boardId,
        lastSequence:   this.session.lastAckedSequence,
        reconnectCount: this.connectionFsm.currentReconnectAttempts,
      };

      this.log.info("sync_transition", {
        from:  fromState,
        event: event.type,
        to:    result.nextState,
        ...context,
      });

      this.cfg.onSyncContextChange({ ...this.syncCtx });

    } catch (err: unknown) {
      // (#5) Illegal transition — was a silent `catch {}`, now structured log
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error("illegal_fsm_transition", {
        from:   fromState,
        event:  event.type,
        reason: msg,
        board:  this.boardId ?? "",
      });
      // State is NOT changed — FSM stays in `fromState` (safe fallback)
    }
  }
}
