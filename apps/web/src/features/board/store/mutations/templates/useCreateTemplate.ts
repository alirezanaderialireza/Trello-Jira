// apps/web/src/features/board/store/mutations/templates/useCreateTemplate.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";
import type { TemplateStructure } from "@repo/domain";

interface CreateTemplateVariables {
  boardId: string;
  name: string;
  description?: string;
  structure: TemplateStructure;
  correlationId: string;
}

export function useCreateTemplate() {
  return useOptimisticMutation<CreateTemplateVariables, any>({
    mutationFn: (vars) =>
      boardApi.createTemplate({
        boardId:     vars.boardId,
        name:        vars.name,
        description: vars.description,
        structure:   vars.structure,
        mutationId:  vars.correlationId,
      }),

    targetSnapshot: (_vars) => ({}),

    generateEnvelope: (vars) => {
      const tempId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      return createOptimisticEnvelope(
        "template.created",
        {
          templateId:  tempId,
          boardId:     vars.boardId,
          name:        vars.name,
          description: vars.description,
          structure:   vars.structure,
          createdAt:   nowIso,
        },
        tempId, "template", 0, vars.correlationId,
      );
    },
    errorMessage: "ساخت قالب با خطا مواجه شد.",
  });
}
