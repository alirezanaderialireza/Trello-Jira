// apps/web/src/features/board/store/sync/syncContracts.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single canonical definition of all sync-related shared types.
//
// Problem solved:
//   - WsEvent was defined in TWO places:
//       1. api/realtime/types.ts  (payload: any)
//       2. useBoardStore.ts       (payload: AppDomainEvent)
//   - SyncStatus in store ("healthy/gap_detected/reconnecting/desynced")
//     ≠ SyncState in FSM ("idle/synced/catching_up/resyncing/reconnecting/offline")
//
// Fix:
//   - WsEvent → single definition here (payload: AppDomainEvent)
//   - SyncStatus → re-exported alias of FSM SyncState (superset)
//   - Both old usages import from here
// ─────────────────────────────────────────────────────────────────────────────

import type { AppDomainEvent } from "@repo/domain";
import type { SyncState } from "./syncStateMachine";

// ============================================================================
// Canonical WsEvent
// ============================================================================

/**
 * A single event received over the WebSocket transport.
 * This is the ONLY definition used throughout the codebase.
 * Replaces the two conflicting definitions in:
 *   - apps/web/src/features/board/api/realtime/types.ts
 *   - apps/web/src/features/board/store/useBoardStore.ts
 */
export interface WsEvent {
  /** Board-scoped monotonic sequence number (string for BigInt safety) */
  readonly sequence: string;
  /** Canonical domain event type string */
  readonly type: string;
  /** Full typed domain event payload */
  readonly payload: AppDomainEvent;
}

// ============================================================================
// SyncStatus — alias of the FSM SyncState
// ============================================================================

/**
 * SyncStatus is identical to the FSM SyncState, i.e. one of:
 *   "IDLE" | "CONNECTING" | "HEALTHY" | "GAP" | "REPLAYING" | "DESYNCED"
 *   | "RECONNECTING"
 *
 * The UI layer normalises these into UISyncStatus via useSyncStatus() and must
 * never switch on this raw type directly.
 */
export type SyncStatus = SyncState;

/**
 * Mapping from the legacy 4-value status enum to the canonical FSM SyncState.
 * Kept for any old consumer that still produces the legacy strings.
 */
export const LEGACY_SYNC_STATUS_MAP: Record<string, SyncStatus> = {
  healthy:       "HEALTHY",
  gap_detected:  "GAP",
  reconnecting:  "RECONNECTING",
  desynced:      "DESYNCED",
};

// ============================================================================
// Re-exports for convenience
// ============================================================================
export type { SyncState } from "./syncStateMachine";
