// apps/web/src/features/board/store/mutations/labels/useCreateLabel.ts
//
// Optimistic create-label. The optimistic envelope uses v2 payload
// shape (colorToken + position + createdBy); position is filled with
// a placeholder string because the server-side LexoRank generation
// runs in the router and the live event reconciles the speculative
// state. F1.2.1.b will thread the real session userId through
// `createdBy`; until then it's an empty string — the dispatcher's
// reducer doesn't read it for state derivation, so the optimistic
// projection is unaffected.

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface CreateLabelVariables {
  boardId: string;
  name: string;
  colorToken: string;
  correlationId: string;
}

const OPTIMISTIC_POSITION_PLACEHOLDER = "z"; // sorts last; server reconciles

export function useCreateLabel() {
  return useOptimisticMutation<CreateLabelVariables, any>({
    mutationFn: (vars) =>
      boardApi.createLabel({
        boardId:        vars.boardId,
        name:           vars.name,
        colorToken:     vars.colorToken,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (_vars) => ({}),

    generateEnvelope: (vars) => {
      const tempId = crypto.randomUUID();
      return createOptimisticEnvelope(
        "label.created",
        {
          labelId:    tempId,
          boardId:    vars.boardId,
          name:       vars.name,
          colorToken: vars.colorToken,
          position:   OPTIMISTIC_POSITION_PLACEHOLDER,
          createdBy:  "", // server reconciles via the live event
        },
        tempId,
        "board",
        0,
        vars.correlationId,
      );
    },
    errorMessage: "ساخت برچسب با خطا مواجه شد.",
  });
}
