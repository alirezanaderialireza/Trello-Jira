"use client";

// apps/web/src/features/board/engine/useBoardState.ts
//
// Phase 1.3 (F1.3.1) — centralised, atomic board-state selectors.
//
// This is the first of the four internal engines that make up the
// useBoardEngine facade (see board-engine-conventions.md). It owns every
// granular read from the Zustand board store so components no longer carry
// inline `makeSelect*` factories.
//
// Design rules (matching the established CardItem pattern):
//   • Each id-scoped selector is produced by a *factory* (`selectX(id)`,
//     defined in boardSelectors.ts) and wrapped in `useMemo([id])` here, so
//     the subscription path is referentially stable across renders and a
//     hot-reload doesn't tear down the Zustand subscription.
//   • Collection selectors return a module-level frozen EMPTY constant when a
//     slice is missing, so an absent list/card never yields a fresh `[]` that
//     would defeat Zustand's `Object.is` bail-out and cause render loops.
//   • Derived data (sorted lists) subscribes only to the two slices it needs
//     (`listOrder` + `lists`) and memoises the projection — it never
//     subscribes to the whole board object (guard: "no component subscribes
//     to the whole board").

import { useMemo } from "react";

import {
  useBoardStore,
  type BoardState,
  type BoardStoreState,
  type CardDto,
  type ListDto,
} from "../store/useBoardStore";
import {
  selectListOrder,
  selectCardIds,
  selectCard,
  selectList,
  selectCardTitle,
  deriveOrderedLists,
} from "./boardSelectors";

// Re-export the pure factories so callers that already have a selector pattern
// (or tests) can reach them from the engine entrypoint.
export {
  selectListOrder,
  selectCardIds,
  selectCard,
  selectList,
  selectCardTitle,
  deriveOrderedLists,
} from "./boardSelectors";

// ─────────────────────────────────────────────────────────────────────────────
// Board-level hook — list order + the init action
// ─────────────────────────────────────────────────────────────────────────────

export function useBoardState() {
  const listOrder = useBoardStore(selectListOrder);
  const initBoard = useBoardStore((s: BoardState) => s.initBoard);
  return { listOrder, initBoard };
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic id-scoped selectors
// ─────────────────────────────────────────────────────────────────────────────

/** Card ids in a list, in display order. Stable empty when the list is unknown. */
export function useListCardIds(listId: string): string[] {
  const selector = useMemo(() => selectCardIds(listId), [listId]);
  return useBoardStore(selector);
}

/** The full card DTO, or undefined while it is not yet hydrated. */
export function useCard(cardId: string): CardDto | undefined {
  const selector = useMemo(() => selectCard(cardId), [cardId]);
  return useBoardStore(selector);
}

/** The full list DTO, or undefined while it is not yet hydrated. */
export function useList(listId: string): ListDto | undefined {
  const selector = useMemo(() => selectList(listId), [listId]);
  return useBoardStore(selector);
}

/** Just the card title — the hottest field, isolated to minimise re-renders. */
export function useCardTitle(cardId: string): string | undefined {
  const selector = useMemo(() => selectCardTitle(cardId), [cardId]);
  return useBoardStore(selector);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived: lists in board order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ordered list DTOs for the board, derived from `listOrder` + the `lists`
 * map. Subscribes to exactly those two slices and memoises the projection —
 * it does NOT subscribe to the whole board object, and returns a stable array
 * reference until `listOrder` or `lists` actually changes.
 */
export function useDerivedLists(): ListDto[] {
  const listOrder = useBoardStore(selectListOrder);
  const lists = useBoardStore((s: BoardStoreState) => s.lists);

  return useMemo(() => deriveOrderedLists(listOrder, lists), [listOrder, lists]);
}
