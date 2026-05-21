"use client";

import { trpc } from "../../../../utils/trpc";

interface Props { cardId: string; boardId: string; }

export function CardLabels({ cardId, boardId }: Props) {
  const { data: boardLabels } = trpc.v1.public.label.getByBoard.useQuery({ boardId });
  const { data: cardLabelsList } = trpc.v1.public.label.getByCard.useQuery({ cardId });
  const utils = trpc.useUtils();

  const addMutation = trpc.v1.public.label.addToCard.useMutation({
    onSuccess: () => utils.v1.public.label.getByCard.invalidate({ cardId }),
  });
  const removeMutation = trpc.v1.public.label.removeFromCard.useMutation({
    onSuccess: () => utils.v1.public.label.getByCard.invalidate({ cardId }),
  });

  const cardLabelIds = new Set((cardLabelsList ?? []).map((l: any) => l.id));

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">Labels</h3>
      <div className="flex flex-wrap gap-2">
        {(boardLabels ?? []).map((label: any) => {
          const isActive = cardLabelIds.has(label.id);
          return (
            <button
              key={label.id}
              onClick={() => {
                if (isActive) removeMutation.mutate({ cardId, labelId: label.id });
                else addMutation.mutate({ cardId, labelId: label.id });
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                isActive ? "ring-2 ring-white/50" : "opacity-60 hover:opacity-100"
              }`}
              style={{ backgroundColor: label.color, color: "#fff" }}
            >
              {label.name}
            </button>
          );
        })}
        {(!boardLabels || boardLabels.length === 0) && (
          <span className="text-xs text-slate-500">No labels on this board yet</span>
        )}
      </div>
    </div>
  );
}
