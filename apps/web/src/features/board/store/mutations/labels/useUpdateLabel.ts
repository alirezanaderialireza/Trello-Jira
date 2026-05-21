// apps/web/src/features/board/store/mutations/labels/useUpdateLabel.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateLabelVariables {
  labelId: string;
  boardId: string;
  name?: string;
  color?: string;
  correlationId: string;
}

export function useUpdateLabel() {
  return useOptimisticMutation<UpdateLabelVariables, any>({
    mutationFn: (vars) =>
      boardApi.updateLabel({ labelId: vars.labelId, name: vars.name, color: vars.color, mutationId: vars.correlationId }),

    targetSnapshot: (_vars) => ({}),

    generateEnvelope: (vars, state) => {
      const label = state.labels[vars.labelId];
      if (!label) return null;
      return createOptimisticEnvelope(
        "label.updated",
        {
          labelId: vars.labelId,
          boardId: vars.boardId,
          changes: {
            ...(vars.name  !== undefined && { name:  vars.name }),
            ...(vars.color !== undefined && { color: vars.color }),
          },
        },
        vars.labelId, "label", label.revision, vars.correlationId,
      );
    },
    errorMessage: "ویرایش لیبل با خطا مواجه شد.",
  });
}
