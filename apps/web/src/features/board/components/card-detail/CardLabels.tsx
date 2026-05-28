"use client";

// apps/web/src/features/board/components/card-detail/CardLabels.tsx
//
// ⚠ Phase 4 stub — will be replaced by the rich LabelPicker /
// LabelManager surface in F1.2.1.b. Updated here only so the build
// stays green after the F1.2.1.a router rename + payload bump.
//
// Procedures consumed (post-rename):
//   • label.list({ boardId })             — was getByBoard
//   • label.listByCard({ boardId, cardId }) — was getByCard
//   • label.applyToCard({ boardId, cardId, labelId, idempotencyKey })
//                                          — was addToCard
//   • label.removeFromCard({ boardId, cardId, labelId, idempotencyKey })
//                                          — name unchanged, payload added boardId
//
// The 12-token colour palette is kept here as a local map only because
// this stub will be deleted in F1.2.1.b. The canonical mapping lives
// in the LabelBadge component the next featurelet introduces.

import { trpc } from "../../../../utils/trpc";

interface Props { cardId: string; boardId: string; }

const TOKEN_HEX: Record<string, string> = {
  "red.500":    "#EF4444",
  "orange.500": "#F97316",
  "yellow.500": "#EAB308",
  "green.500":  "#22C55E",
  "teal.500":   "#14B8A6",
  "blue.500":   "#3B82F6",
  "indigo.500": "#6366F1",
  "purple.500": "#A855F7",
  "pink.500":   "#EC4899",
  "gray.500":   "#6B7280",
  "brown.500":  "#92400E",
  "black":      "#1F2937",
};

export function CardLabels({ cardId, boardId }: Props) {
  const { data: boardLabels } = trpc.v1.public.label.list.useQuery({ boardId });
  const { data: cardLabelsList } = trpc.v1.public.label.listByCard.useQuery({
    boardId,
    cardId,
  });
  const utils = trpc.useUtils();

  const applyMutation = trpc.v1.public.label.applyToCard.useMutation({
    onSuccess: () =>
      utils.v1.public.label.listByCard.invalidate({ boardId, cardId }),
  });
  const removeMutation = trpc.v1.public.label.removeFromCard.useMutation({
    onSuccess: () =>
      utils.v1.public.label.listByCard.invalidate({ boardId, cardId }),
  });

  const cardLabelIds = new Set((cardLabelsList ?? []).map((l: any) => l.id));

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
        برچسب‌ها
      </h3>
      <div className="flex flex-wrap gap-2">
        {(boardLabels ?? []).map((label: any) => {
          const isActive = cardLabelIds.has(label.id);
          const bg = TOKEN_HEX[label.colorToken] ?? "#6B7280";
          return (
            <button
              key={label.id}
              onClick={() => {
                if (isActive) {
                  removeMutation.mutate({
                    boardId,
                    cardId,
                    labelId:        label.id,
                    idempotencyKey: crypto.randomUUID(),
                  });
                } else {
                  applyMutation.mutate({
                    boardId,
                    cardId,
                    labelId:        label.id,
                    idempotencyKey: crypto.randomUUID(),
                  });
                }
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                isActive ? "ring-2 ring-white/50" : "opacity-60 hover:opacity-100"
              }`}
              style={{ backgroundColor: bg, color: "#fff" }}
            >
              {label.name}
            </button>
          );
        })}
        {(!boardLabels || boardLabels.length === 0) && (
          <span className="text-xs text-slate-500">
            هنوز برچسبی روی این برد ثبت نشده.
          </span>
        )}
      </div>
    </div>
  );
}
