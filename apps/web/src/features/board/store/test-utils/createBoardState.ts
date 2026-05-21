// apps/web/src/features/board/store/test-utils/createBoardState.ts
import type { BoardStoreState } from "../useBoardStore";

/**
 * Creates a minimal but complete BoardStoreState for use in unit tests.
 * All Phase 1-2 and Phase 4 slices are initialised to empty so tests
 * never get TS errors from missing fields when the state shape is extended.
 */
export function createBoardState(
  overrides?: Partial<BoardStoreState>,
): BoardStoreState {
  return {
    // ── Phase 1-2 ──────────────────────────────────────────────────────────
    lists:            {},
    cards:            {},
    cardsByList:      {},
    listOrder:        [],
    boardSequence:    "0",
    bufferedEvents:   {},
    syncStatus:       "healthy",
    pendingMutations: {},
    // ── Phase 4 ────────────────────────────────────────────────────────────
    labels:              {},
    labelsByBoard:       {},
    checklists:          {},
    checklistsByCard:    {},
    comments:            {},
    commentsByCard:      {},
    attachments:         {},
    attachmentsByCard:   {},
    templates:           {},
    templatesByBoard:    {},
    activityFeed:        [],
    // ── Overrides ──────────────────────────────────────────────────────────
    ...overrides,
  };
}
