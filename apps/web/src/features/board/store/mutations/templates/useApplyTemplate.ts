// apps/web/src/features/board/store/mutations/templates/useApplyTemplate.ts
//
// Applying a template is a composite server operation: the server creates lists
// and cards, then emits individual list.created / card.created events.
// The optimistic envelope records the template.applied event for the activity
// feed, but structural changes arrive via the server's entity events — no
// optimistic structural mutation is made here.
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface ApplyTemplateVariables {
  templateId: string;
  boardId: string;
  correlationId: string;
}

export function useApplyTemplate() {
  return useOptimisticMutation<ApplyTemplateVariables, any>({
    mutationFn: (vars) =>
      boardApi.applyTemplate({ templateId: vars.templateId, boardId: vars.boardId, mutationId: vars.correlationId }),

    // Snapshot the full list order so a rollback can restore it if the server
    // rejects the apply operation before emitting any entity events.
    targetSnapshot: (_vars) => ({ includeListOrder: true }),

    generateEnvelope: (vars, state) => {
      if (!state.templates[vars.templateId]) return null;
      const nowIso = new Date().toISOString();
      return createOptimisticEnvelope(
        "template.applied",
        {
          templateId:     vars.templateId,
          boardId:        vars.boardId,
          createdListIds: [],
          createdCardIds: [],
          appliedAt:      nowIso,
        },
        vars.templateId, "template", 0, vars.correlationId,
      );
    },
    errorMessage: "اعمال قالب با خطا مواجه شد.",
  });
}
