// apps/web/src/features/board/store/mutations/cards/useMoveCard.ts
//
// ─── Phase 5 rewrite ─────────────────────────────────────────────────────────
// This hook now delegates position calculation to the PositioningEngine
// (actor-serialized, multi-tab safe, rebalance-aware) instead of expecting
// the caller to supply an `optimisticPosition` directly.
//
// Public API change:
//   Before: caller passes `optimisticPosition` string.
//   After:  caller passes `targetIndex` (0-based drop position in destination list).
//           The hook computes the rank via positioningEngine.moveCard().
//
// The hook still uses useOptimisticMutation for snapshot/rollback/ack lifecycle.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";
import { positioningEngine } from "../../sync/positioning/positioningEngine";
import { useBoardStore } from "../../useBoardStore";

// ============================================================================
// 🛡️ Types
// ============================================================================

interface MoveCardVariables {
  cardId: string;
  boardId: string;
  fromListId: string;
  toListId: string;

  /** 0-based index in the destination list where the card should land. */
  targetIndex: number;

  // ── Computed by the hook (not by the caller) ─────────────────────────────
  /** Resolved by positioningEngine before mutate is called. */
  optimisticPosition: string;
  mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
  prevId?: string;
  nextId?: string;

  correlationId: string;
}

/**
 * The shape the consumer calls — excludes computed fields.
 * positioningEngine fills in optimisticPosition, mode, prevId, nextId.
 */
export interface MoveCardInput {
  cardId: string;
  boardId: string;
  fromListId: string;
  toListId: string;
  targetIndex: number;
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================

export function useMoveCard() {
  const mutation = useOptimisticMutation<MoveCardVariables, any>({

    // ── 1. Server request ────────────────────────────────────────────────────
    mutationFn: async (vars) => {
      const store = useBoardStore.getState();
      const expectedListRevisions: Record<string, number> = {};

      const fromList = store.lists[vars.fromListId];
      const toList   = store.lists[vars.toListId];

      if (fromList) expectedListRevisions[fromList.id] = fromList.revision;
      if (toList && toList.id !== fromList?.id) {
        expectedListRevisions[toList.id] = toList.revision;
      }

      return boardApi.moveCard({
        cardId:                vars.cardId,
        targetListId:          vars.toListId,
        mode:                  vars.mode,
        prevId:                vars.prevId,
        nextId:                vars.nextId,
        expectedListRevisions,
        mutationId:            vars.correlationId,
      });
    },

    // ── 2. Snapshot for rollback ─────────────────────────────────────────────
    targetSnapshot: (vars) => ({
      cards: [vars.cardId],
      lists:
        vars.fromListId === vars.toListId
          ? [vars.fromListId]
          : [vars.fromListId, vars.toListId],
    }),

    // ── 3. Optimistic event envelope ─────────────────────────────────────────
    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;

      return createOptimisticEnvelope(
        "card.moved",
        {
          cardId:      vars.cardId,
          boardId:     vars.boardId,
          fromListId:  vars.fromListId,
          toListId:    vars.toListId,
          oldPosition: card.position,
          newPosition: vars.optimisticPosition,
        },
        vars.cardId,
        "card",
        card.revision,
        vars.correlationId,
      );
    },

    // ── 4. Error UX ──────────────────────────────────────────────────────────
    errorMessage: "جابجایی کارت با خطا مواجه شد. کارت به جای قبلی بازگشت.",
  });

  // ==========================================================================
  // Wrapper that computes position via PositioningEngine before calling mutate.
  // ==========================================================================

  const moveCard = useCallback(
    async (input: MoveCardInput) => {
      // Ask the engine for the correct position (serialized, collision-safe).
      const result = await positioningEngine.moveCard(
        input.cardId,
        input.fromListId,
        input.toListId,
        input.targetIndex,
      );

      // Build the full variables set with computed position + mode.
      const vars: MoveCardVariables = {
        cardId:             input.cardId,
        boardId:            input.boardId,
        fromListId:         input.fromListId,
        toListId:           input.toListId,
        targetIndex:        input.targetIndex,
        optimisticPosition: result.position,
        mode:               result.mode,
        prevId:             result.prevId,
        nextId:             result.nextId,
        correlationId:      input.correlationId,
      };

      // Fire the optimistic mutation (snapshot → apply → send → ack/rollback).
      mutation.mutate(vars);

      // Return the engine result so the caller can act on rebalancePlan if needed.
      return result;
    },
    [mutation],
  );

  return {
    moveCard,
    /** Expose underlying mutation state for loading/error indicators. */
    isLoading: mutation.isPending,
    isError:   mutation.isError,
    error:     mutation.error,
  };
}
