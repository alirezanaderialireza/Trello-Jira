// apps/web/src/features/board/store/mutations/labels/useCreateLabel.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface CreateLabelVariables {
  boardId: string;
  name: string;
  color: string;
  correlationId: string;
}

export function useCreateLabel() {
  return useOptimisticMutation<CreateLabelVariables, any>({
    mutationFn: (vars) =>
      boardApi.createLabel({ boardId: vars.boardId, name: vars.name, color: vars.color, mutationId: vars.correlationId }),

    targetSnapshot: (_vars) => ({}), // labels are board-scoped; no snapshot needed for rollback

    generateEnvelope: (vars) => {
      const tempId = crypto.randomUUID();
      return createOptimisticEnvelope(
        "label.created",
        { labelId: tempId, boardId: vars.boardId, name: vars.name, color: vars.color },
        tempId, "label", 0, vars.correlationId,
      );
    },
    errorMessage: "ساخت لیبل با خطا مواجه شد.",
  });
}
