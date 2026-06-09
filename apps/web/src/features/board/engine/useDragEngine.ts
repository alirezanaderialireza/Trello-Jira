"use client";

// apps/web/src/features/board/engine/useDragEngine.ts
//
// Phase 1.3 (F1.3.2) — drag engine.
//
// Owns the whole dnd-kit lifecycle for the board so BoardView no longer
// carries ~300 lines of inline drag logic. Authored in F1.3.2; it is wired
// into BoardView in F1.3.3 (this file is additive until then).
//
// Behaviour (faithful to the previous BoardView, with the F1.3 upgrades):
//   • onDragStart — capture activeId/type, the source container, and the
//     dragged element's rect (width/height) for a layout-shift-free overlay (D6).
//   • onDragOver  — intent-debounced (D4, 120ms) VISUAL-only move via the
//     store's moveCard. A fast sweep keeps rescheduling and never opens a gap.
//   • onDragEnd   — routes persistence through the UNIFIED hooks useMoveCard /
//     useMoveList (D3). Those own positioning + optimistic apply + rollback,
//     so there is no manual setState / structuredClone here (D10).
//   • Sensors     — Pointer (distance 8 → click vs drag, D8), Touch
//     (delay 150 / tolerance 8 for mobile, D7), Keyboard (a11y).
//
// The core engines (positioningEngine, MutationLifecycleManager,
// useOptimisticMutation) are untouched (D9).

import { useCallback, useMemo, useRef, useState } from "react";
import {
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type CollisionDetection,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCorners,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { useBoardStore } from "../store/useBoardStore";
import { useMoveCard } from "../store/mutations/cards/useMoveCard";
import { useMoveList } from "../store/mutations/lists/useMoveList";
import { createIntentScheduler } from "./intentScheduler";
import {
  resolveOverListId,
  indexOfCard,
  computeOverIndex,
  needsVisualMove,
  computeListMoveIndices,
} from "./dragResolution";

// 120ms dwell before a visual gap opens (D4).
const INTENT_DELAY_MS = 120;

export type DragType = "List" | "Card";

export interface DragMeta {
  width: number;
  height: number;
}

// Pointer-then-corners collision: precise while hovering, forgiving at edges.
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

export interface DragEngine {
  dndProps: {
    sensors: ReturnType<typeof useSensors>;
    collisionDetection: CollisionDetection;
    onDragStart: (e: DragStartEvent) => void;
    onDragOver: (e: DragOverEvent) => void;
    onDragEnd: (e: DragEndEvent) => void;
  };
  activeId: string | null;
  activeType: DragType | null;
  dragMeta: DragMeta | null;
  isDragging: boolean;
}

export function useDragEngine(boardId: string): DragEngine {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<DragType | null>(null);
  const [dragMeta, setDragMeta] = useState<DragMeta | null>(null);

  const { moveCard: moveCardUnified } = useMoveCard();
  const { moveList: moveListUnified } = useMoveList();

  // Visual-only store reorder (live feedback while dragging across lists).
  const storeMoveCard = useBoardStore((s) => s.moveCard);

  // Per-drag mutable state. activeType is also mirrored in a ref so the
  // event handlers (which are stable callbacks) read the latest value.
  const activeTypeRef = useRef<DragType | null>(null);
  const sourceListRef = useRef<string | null>(null);
  const currentContainerRef = useRef<string | null>(null);

  // One scheduler instance per hook lifetime.
  const intentRef = useRef(createIntentScheduler(INTENT_DELAY_MS));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── onDragStart ───────────────────────────────────────────────────────────
  const onDragStart = useCallback((event: DragStartEvent) => {
    const type = (event.active.data.current?.type as DragType | undefined) ?? null;
    activeTypeRef.current = type;

    const container = (event.active.data.current?.sortable?.containerId as string | undefined) ?? null;
    sourceListRef.current = container;
    currentContainerRef.current = container;

    // Capture the dragged element's box so the overlay matches it exactly (D6).
    const rect = event.active.rect.current.initial;
    setDragMeta(rect ? { width: rect.width, height: rect.height } : null);

    setActiveType(type);
    setActiveId(event.active.id as string);
  }, []);

  // ── onDragOver (intent-debounced visual move) ──────────────────────────────
  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      if (activeTypeRef.current !== "Card") return;
      const { active, over } = event;
      if (!over) return;

      const activeIdStr = active.id as string;
      const overId = over.id as string;
      const overContainer = (over.data.current?.sortable?.containerId as string | undefined) ?? null;

      intentRef.current.schedule(() => {
        const state = useBoardStore.getState();
        const activeListId =
          currentContainerRef.current ||
          ((active.data.current?.sortable?.containerId as string | undefined) ?? null);
        const overListId = resolveOverListId(overContainer, overId);
        if (!activeListId || !overListId) return;

        const activeIndex = indexOfCard(state.cardsByList, activeListId, activeIdStr);
        const overIndex = computeOverIndex(state.cardsByList, overListId, overId);

        if (needsVisualMove(activeListId, overListId, activeIndex, overIndex)) {
          storeMoveCard(activeIdStr, activeListId, overListId, activeIndex, overIndex);
          currentContainerRef.current = overListId;
        }
      });
    },
    [storeMoveCard],
  );

  // ── onDragEnd (unified persistence path) ───────────────────────────────────
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      intentRef.current.cancel();

      const type = activeTypeRef.current;
      const { active, over } = event;

      // Reset visual drag state immediately.
      setActiveId(null);
      setActiveType(null);
      setDragMeta(null);
      activeTypeRef.current = null;

      if (!over || !type) {
        sourceListRef.current = null;
        currentContainerRef.current = null;
        return;
      }

      const activeIdStr = active.id as string;
      const state = useBoardStore.getState();

      if (type === "List") {
        const { changed, toIndex } = computeListMoveIndices(
          state.listOrder,
          activeIdStr,
          over.id as string,
        );
        if (changed) {
          void moveListUnified({
            listId: activeIdStr,
            boardId,
            targetIndex: toIndex,
            correlationId: crypto.randomUUID(),
          });
        }
        sourceListRef.current = null;
        currentContainerRef.current = null;
        return;
      }

      // type === "Card"
      const overContainer = (over.data.current?.sortable?.containerId as string | undefined) ?? null;
      const toListId = resolveOverListId(overContainer, over.id as string);
      const fromListId = sourceListRef.current ?? currentContainerRef.current;

      if (toListId && fromListId) {
        // After onDragOver feedback the card already sits in the destination;
        // its current index there is the final drop index. Fall back to the
        // hovered index for a same-list move with no prior over event.
        let targetIndex = indexOfCard(state.cardsByList, toListId, activeIdStr);
        if (targetIndex === -1) {
          targetIndex = computeOverIndex(state.cardsByList, toListId, over.id as string);
        }

        void moveCardUnified({
          cardId: activeIdStr,
          boardId,
          fromListId,
          toListId,
          targetIndex,
          correlationId: crypto.randomUUID(),
        });
      }

      sourceListRef.current = null;
      currentContainerRef.current = null;
    },
    [boardId, moveCardUnified, moveListUnified],
  );

  const dndProps = useMemo(
    () => ({
      sensors,
      collisionDetection: boardCollisionDetection,
      onDragStart,
      onDragOver,
      onDragEnd,
    }),
    [sensors, onDragStart, onDragOver, onDragEnd],
  );

  return {
    dndProps,
    activeId,
    activeType,
    dragMeta,
    isDragging: activeId !== null,
  };
}
