// apps/web/src/features/board/store/test-utils/createBoardState.ts
//
// Fix: syncStatus was "healthy" (dead vocabulary from old 4-value enum).
// Correct value is "synced" (FSM SyncState vocabulary from Phase 2.5 wiring).
//
// All tests and generators must use this factory so they stay aligned
// with the canonical SyncStatus type from syncContracts.ts.

import type { BoardStoreState } from "../useBoardStore";

export function createBoardState(
  overrides?: Partial<BoardStoreState>
): BoardStoreState {
  return {
    lists: {},
    cards: {},
    cardsByList: {},
    listOrder: [],
    boardSequence: "0",
    bufferedEvents: {},
    syncStatus: "synced", // ✅ FIX: was "healthy" (dead vocab) → "synced" (FSM SyncState)
    pendingMutations: {},
    ...overrides,
  };
}
