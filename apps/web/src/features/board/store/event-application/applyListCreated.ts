// apps/web/src/features/board/store/event-application/applyListCreated.ts

import type { ListCreatedEvent } from "@repo/domain";
import type { BoardStoreState, ListDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyListCreated
 * ------------------------------------------------------------------
 * Responsibilities:
 * - Atomic list creation from canonical domain payload
 * - Deterministic ordering via LexoRank position
 * - Idempotency & Stale Guard (>= version check)
 * - Cards-By-List bucket initialization
 * - Full payload field extraction (boardId must propagate)
 * ------------------------------------------------------------------
 */
export function applyListCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  // 🌟 Full canonical payload destructure
  const { listId, boardId, title, position } = event.payload;

  const existingList = state.lists[listId];

  /**
   * 🛡️ Stale & Idempotency Guard
   * If list already exists with revision >= event.version, this event
   * has either been applied or superseded — skip.
   */
  if (existingList && existingList.revision >= event.version) {
    return {};
  }

  // Build canonical ListDto. boardId MUST come from payload (with fallback).
  const newList: ListDto = {
    ...(existingList ?? {}),
    id: listId,
    boardId: boardId ?? existingList?.boardId ?? "",
    title,
    position,
    revision: event.version,
    confirmedRevision: envelope.acknowledged
      ? event.version
      : existingList?.confirmedRevision ?? 0,
    isOptimistic: envelope.acknowledged
      ? false
      : envelope.optimistic ?? existingList?.isOptimistic ?? false,
  };

  /**
   * 🛡️ Idempotent Order Update
   * Prevent duplicate listId in listOrder during replay.
   */
  const isAlreadyInOrder = state.listOrder.includes(listId);
  const nextListOrder = isAlreadyInOrder
    ? [...state.listOrder]
    : [...state.listOrder, listId];

  /**
   * 🚀 Deterministic Stable Sort
   * Total ordering identical on all clients via LexoRank + ID tie-break.
   */
  nextListOrder.sort((a, b) => {
    const posA = a === listId ? newList.position : state.lists[a]?.position ?? "";
    const posB = b === listId ? newList.position : state.lists[b]?.position ?? "";

    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    lists: {
      ...state.lists,
      [listId]: newList,
    },
    listOrder: nextListOrder,
    /**
     * 📦 Bucket Initialization
     * Initialize empty cardsByList bucket if absent (replay-safe).
     */
    cardsByList: {
      ...state.cardsByList,
      [listId]: state.cardsByList[listId] ?? [],
    },
  };
}
