// apps/web/src/features/board/realtime/index.ts
//
// Phase-1 types barrel — single import point for all realtime abstractions.
//
// Usage:
//   import { SyncState, transition, ConnectionFSM, runPipeline } from
//     "@/features/board/realtime";

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
