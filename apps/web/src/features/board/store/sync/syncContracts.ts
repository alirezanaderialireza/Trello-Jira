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
// SyncStatus — union of FSM SyncState (superset of old enum)
// ============================================================================

/**
 * SyncStatus is now identical to FSM SyncState.
 *
 * Backward-compat mapping for old consumers:
 *   "healthy"      → "synced"
 *   "gap_detected" → "catching_up"
 *   "reconnecting" → "reconnecting"
 *   "desynced"     → "offline"
 *
 * Old consumers that used the 4-value enum will now see 6 states.
 * The UI layer handles all 6 states explicitly.
 */
export type SyncStatus = SyncState;

// Convenience mapping from old values to new FSM states
export const LEGACY_SYNC_STATUS_MAP: Record<string, SyncStatus> = {
  healthy:       "synced",
  gap_detected:  "catching_up",
  reconnecting:  "reconnecting",
  desynced:      "offline",
};

// ============================================================================
// Re-exports for convenience
// ============================================================================
export type { SyncState } from "./syncStateMachine";
