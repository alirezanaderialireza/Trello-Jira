// apps/web/src/features/board/store/sync/syncFSMSingleton.ts
// ─────────────────────────────────────────────────────────────────────────────
// Process-level singleton for the SyncStateMachine.
//
// WHY A SINGLETON:
//   boardSocketClient, reconcileIncomingEvent, and useSyncOrchestrator all need
//   to send events to the same FSM instance. A React context would work for the
//   component tree but not for non-React modules (socket client, reconciler).
//   A module-level singleton is the correct pattern here.
//
// MULTI-TAB:
//   Each tab has its own FSM instance. Coordination between tabs happens via
//   BroadcastChannel inside the SyncStateMachine class itself.
// ─────────────────────────────────────────────────────────────────────────────

import { SyncStateMachine } from "./syncStateMachine";

let _instance: SyncStateMachine | null = null;

/**
 * Returns the singleton FSM, creating it on first call.
 * The FSM is created with multi-tab coordination enabled.
 */
export function getSyncFSM(): SyncStateMachine {
  if (!_instance) {
    _instance = new SyncStateMachine({ enableMultiTab: true });
  }
  return _instance;
}

/**
 * Destroy and recreate the FSM.
 * Called when the user navigates away from all boards.
 */
export function resetSyncFSM(): void {
  _instance?.destroy();
  _instance = null;
}
