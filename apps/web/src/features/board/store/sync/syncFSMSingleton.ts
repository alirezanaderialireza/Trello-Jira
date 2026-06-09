// apps/web/src/features/board/store/sync/syncFSMSingleton.ts
// ─────────────────────────────────────────────────────────────────────────────
// Process-level singleton for the SyncStateMachine.
//
// WHY A SINGLETON:
//   boardSocketClient, reconcileIncomingEvent, and useSyncOrchestrator all need
//   to send messages to the same FSM instance. A React context would work for
//   the component tree but not for non-React modules (socket client, reconciler).
//   A module-level singleton is the correct pattern here.
//
// EFFECT RUNNER INJECTION:
//   The refactored SyncStateMachine takes an `EffectRunner` function in its
//   constructor and emits effects (UPDATE_STORE_STATUS, START_GAP_TIMER, …) that
//   the runner must execute. The concrete runner lives inside useSyncOrchestrator
//   (it needs React refs + the injected fetchJournal), but the FSM may be created
//   earlier than the orchestrator mounts (boardSocketClient calls getSyncFSM() at
//   import time). To decouple lifetimes we construct the FSM with a stable
//   delegating runner that forwards to a mutable, settable runner reference.
//   useSyncOrchestrator registers its runner on mount and clears it on unmount.
// ─────────────────────────────────────────────────────────────────────────────

import { SyncStateMachine, type EffectRunner, type SyncEffect } from "./syncStateMachine";

let _instance: SyncStateMachine | null = null;
let _runner: EffectRunner | null = null;

/**
 * Register the concrete effect runner. Called by useSyncOrchestrator on mount.
 * Passing `null` (on unmount) detaches the runner; until a new one is set,
 * emitted effects are dropped (the FSM keeps transitioning correctly).
 */
export function setSyncEffectRunner(runner: EffectRunner | null): void {
  _runner = runner;
}

/**
 * Returns the singleton FSM, creating it on first call.
 * The FSM is constructed with a stable delegating runner so the concrete
 * effect runner can be swapped at any time via setSyncEffectRunner().
 */
export function getSyncFSM(): SyncStateMachine {
  if (!_instance) {
    _instance = new SyncStateMachine((effect: SyncEffect) => {
      _runner?.(effect);
    });
  }
  return _instance;
}

/**
 * Reset the FSM back to IDLE and detach the runner.
 * Called when the user navigates away from all boards (board unmount).
 */
export function resetSyncFSM(): void {
  _instance?.reset();
  _runner = null;
}
