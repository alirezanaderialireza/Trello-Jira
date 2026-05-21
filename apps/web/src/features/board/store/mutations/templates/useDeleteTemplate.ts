// apps/web/src/features/board/store/mutations/templates/useDeleteTemplate.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface DeleteTemplateVariables {
  templateId: string;
  boardId: string;
  correlationId: string;
}

export function useDeleteTemplate() {
  return useOptimisticMutation<DeleteTemplateVariables, any>({
    mutationFn: (vars) =>
      boardApi.deleteTemplate({ templateId: vars.templateId, mutationId: vars.correlationId }),

    targetSnapshot: (_vars) => ({}),

    generateEnvelope: (vars, state) => {
      if (!state.templates[vars.templateId]) return null;
      const tpl = state.templates[vars.templateId];
      return createOptimisticEnvelope(
        "template.deleted",
        { templateId: vars.templateId, boardId: vars.boardId },
        vars.templateId, "template", 0, vars.correlationId,
      );
    },
    errorMessage: "حذف قالب با خطا مواجه شد.",
  });
}
