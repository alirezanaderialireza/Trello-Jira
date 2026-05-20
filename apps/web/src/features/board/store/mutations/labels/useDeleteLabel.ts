// apps/web/src/features/board/store/mutations/labels/useDeleteLabel.ts
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
      boardApi.deleteLabel({ labelId: vars.labelId, mutationId: vars.correlationId }),

    targetSnapshot: (_vars) => ({}),

    generateEnvelope: (vars, state) => {
      const label = state.labels[vars.labelId];
      if (!label) return null;
      return createOptimisticEnvelope(
        "label.deleted",
        { labelId: vars.labelId, boardId: vars.boardId },
        vars.labelId, "label", label.revision, vars.correlationId,
      );
    },
    errorMessage: "حذف لیبل با خطا مواجه شد.",
  });
}
