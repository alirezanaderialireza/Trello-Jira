// apps/web/src/features/board/store/mutations/labels/useDeleteLabel.ts
//
// Soft-deletes a label and (server-side) hard-deletes every junction
// row pointing at it. The mutation response carries
// `affectedCardCount` for the confirmation toast (D3).

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface DeleteLabelVariables {
  labelId: string;
  boardId: string;
  correlationId: string;
}

export function useDeleteLabel() {
  return useOptimisticMutation<DeleteLabelVariables, any>({
    mutationFn: (vars) =>
      boardApi.deleteLabel({
        labelId:        vars.labelId,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (_vars) => ({}),

    generateEnvelope: (vars, state) => {
      const label = state.labels[vars.labelId];
      if (!label) return null;
      return createOptimisticEnvelope(
        "label.deleted",
        {
          labelId:           vars.labelId,
          boardId:           vars.boardId,
          // Optimistic placeholder — the live event from the server
          // carries the real count (used by the success toast).
          affectedCardCount: 0,
        },
        vars.labelId,
        "board",
        label.revision,
        vars.correlationId,
      );
    },
    errorMessage: "حذف برچسب با خطا مواجه شد.",
  });
}
