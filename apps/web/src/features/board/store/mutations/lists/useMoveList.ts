// apps/web/src/features/board/store/mutations/lists/useMoveList.ts
//
// ─── Phase 5 rewrite ─────────────────────────────────────────────────────────
// This hook now delegates position calculation to the PositioningEngine
// (actor-serialized, multi-tab safe, rebalance-aware) instead of expecting
// the caller to supply an `optimisticPosition` directly.
//
// Public API change:
//   Before: caller passes `optimisticPosition` string.
//   After:  caller passes `targetIndex` (0-based drop position in board list order).
//           The hook computes the rank via positioningEngine.moveList().
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";
import { positioningEngine } from "../../sync/positioning/positioningEngine";

// ============================================================================
// 🛡️ Types
// ============================================================================

interface MoveListVariables {
  listId: string;
  boardId: string;
  targetIndex: number;

  /** Resolved by positioningEngine — not supplied by caller. */
  optimisticPosition: string;

  correlationId: string;
}

/**
 * The shape the consumer calls — excludes computed fields.
 */
export interface MoveListInput {
  listId: string;
  boardId: string;
  targetIndex: number;
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================

export function useMoveList() {
  const mutation = useOptimisticMutation<MoveListVariables, any>({

    // ── 1. Server request ────────────────────────────────────────────────────
    mutationFn: async (vars) => {
      return boardApi.moveList({
        boardId:     vars.boardId,
        listId:      vars.listId,
        newPosition: vars.optimisticPosition,
        mutationId:  vars.correlationId,
      });
    },

    // ── 2. Snapshot for rollback ─────────────────────────────────────────────
    targetSnapshot: (vars) => ({
      includeListOrder: true,
      lists: [vars.listId],
    }),

    // ── 3. Optimistic event envelope ─────────────────────────────────────────
    generateEnvelope: (vars, state) => {
      const list = state.lists[vars.listId];
      if (!list) return null;

      return createOptimisticEnvelope(
        "list.moved",
        {
          listId:      vars.listId,
          boardId:     vars.boardId,
          oldPosition: list.position,
          newPosition: vars.optimisticPosition,
        },
        vars.listId,
        "list",
        list.revision,
        vars.correlationId,
      );
    },

    // ── 4. Error UX ──────────────────────────────────────────────────────────
    errorMessage: "جابجایی لیست انجام نشد. بورد به حالت قبل بازگشت.",
  });

  // ==========================================================================
  // Wrapper that computes position via PositioningEngine before calling mutate.
  // ==========================================================================

  const moveList = useCallback(
    async (input: MoveListInput) => {
      // Ask the engine for the correct position (serialized, collision-safe).
      const result = await positioningEngine.moveList(
        input.listId,
        input.targetIndex,
      );

      // Build full variables with computed position.
      const vars: MoveListVariables = {
        listId:             input.listId,
        boardId:            input.boardId,
        targetIndex:        input.targetIndex,
        optimisticPosition: result.position,
        correlationId:      input.correlationId,
      };

      // Fire the optimistic mutation.
      mutation.mutate(vars);

      // Return engine result for optional rebalance handling by the caller.
      return result;
    },
    [mutation],
  );

  return {
    moveList,
    isLoading: mutation.isPending,
    isError:   mutation.isError,
    error:     mutation.error,
  };
}
