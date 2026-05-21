// apps/web/src/features/board/realtime/index.ts
//
// Phase-1 types barrel — single import point for all realtime abstractions.

// ── Protocol contracts ────────────────────────────────────────────────────────
export type {
  ProtocolVersion,
  ServerCapabilities,
  ClientMessage,
  ClientConnect,
  ClientResume,
  ClientMutation,
  ClientPing,
  ClientAck,
  ServerMessage,
  ServerSubscribed,
  ServerEvent,
  ServerEventBatch,
  ServerAck,
  ServerNack,
  ServerResyncRequired,
  ServerPong,
  ServerAuthRequired,
} from "./protocol";

export {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  DEDUP_WINDOW_MS,
  BASELINE_CAPABILITIES,
  MAX_BATCH_SIZE,
  CATCH_UP_MAX_EVENTS,
  serializeClientMessage,
  parseServerMessage,
} from "./protocol";

// ── SyncState FSM ─────────────────────────────────────────────────────────────
export type {
  SyncState,
  SyncEvent,
  SyncContext,
  TransitionResult,
} from "./sync-state";

export {
  transition,
  isLive,
  isDegraded,
  isTerminal,
  isInactive,
  INITIAL_SYNC_CONTEXT,
} from "./sync-state";

// ── ConnectionFSM ─────────────────────────────────────────────────────────────
export type {
  ConnectionConfig,
  ConnectionEvent,
  ConnectionEventHandler,
} from "./connection-fsm";

export {
  ConnectionFSM,
  DEFAULT_CONNECTION_CONFIG,
} from "./connection-fsm";

// ── SessionManager ────────────────────────────────────────────────────────────
export type { SessionState } from "./session-manager";
export { SessionManager } from "./session-manager";

// ── OutboxProcessor ───────────────────────────────────────────────────────────
export type {
  OutboxItemStatus,
  OutboxItem,
  DLQItem,
  OutboxConfig,
  OutboxCallbacks,
} from "./outbox";

export {
  OutboxProcessor,
  DEFAULT_OUTBOX_CONFIG,
} from "./outbox";

// ── Event Pipeline ────────────────────────────────────────────────────────────
export type {
  PipelineOk,
  PipelineErr,
  PipelineResult,
  PipelineStage,
  ValidatedFrame,
  SequenceDecision,
  DispatchResult,
  InvariantCheckResult,
  PipelineOutput,
} from "./event-pipeline";

export {
  validateFrame,
  checkSequence,
  ReplayBuffer,
  dispatchFrame,
  checkInvariants,
  runPipeline,
} from "./event-pipeline";

// ── BoardRealtimeClient ───────────────────────────────────────────────────────
export type {
  ReducerFn,
  BoardRealtimeConfig,
  CatchUpSource,
  CatchUpFrame,
  RealtimeLogger,
} from "./board-realtime-client";

export { BoardRealtimeClient } from "./board-realtime-client";
