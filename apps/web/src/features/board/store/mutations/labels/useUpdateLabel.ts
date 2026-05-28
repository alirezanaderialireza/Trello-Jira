// apps/web/src/features/board/store/mutations/labels/useUpdateLabel.ts
//
// Optimistic update-label. Variables now carry the v2 shape:
// colorToken (was: color) and the new optional `position` for
// drag-and-drop reorder.

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateLabelVariables {
  labelId: string;
  boardId: string;
  name?: string;
  colorToken?: string;
  position?: string;
  correlationId: string;
}

export function useUpdateLabel() {
  return useOptimisticMutation<UpdateLabelVariables, any>({
    mutationFn: (vars) =>
      boardApi.updateLabel({
        labelId:        vars.labelId,
        name:           vars.name,
        colorToken:     vars.colorToken,
        position:       vars.position,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

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
            ...(vars.name       !== undefined && { name:       vars.name }),
            ...(vars.colorToken !== undefined && { colorToken: vars.colorToken }),
            ...(vars.position   !== undefined && { position:   vars.position }),
          },
        },
        vars.labelId,
        "board",
        label.revision,
        vars.correlationId,
      );
    },
    errorMessage: "ویرایش برچسب با خطا مواجه شد.",
  });
}
