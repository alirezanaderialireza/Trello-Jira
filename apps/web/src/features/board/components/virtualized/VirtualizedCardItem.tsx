"use client";
import { memo } from "react";
import { useBoardStore } from "../../store/useBoardStore";
import { selectCardById } from "../../store/sync/performance/selectorCache";
import { useCardModal } from "../../hooks/useCardModal";

interface Props { cardId: string; }

export const VirtualizedCardItem = memo(function VirtualizedCardItem({ cardId }: Props) {
  const card = useBoardStore(selectCardById(cardId));
  const { open } = useCardModal();
  if (!card) return null;

  const hasLabels = card.labels && card.labels.length > 0;
  const hasDueDate = !!card.dueDate;
  const isOverdue = hasDueDate && new Date(card.dueDate!) < new Date();

  return (
    <div onClick={() => open(cardId)} className="h-full cursor-pointer rounded-lg border border-slate-700 bg-slate-900 p-3 hover:border-slate-500 transition-colors flex flex-col justify-between">
      {hasLabels && <div className="flex flex-wrap gap-1 mb-1">{card.labels!.slice(0, 4).map((l) => <div key={l} className="h-1.5 w-8 rounded-full bg-blue-500" />)}</div>}
      <p className="text-sm text-white font-medium truncate">{card.title}</p>
      <div className="flex items-center gap-2 mt-auto pt-1">
        {hasDueDate && <span className={`text-[10px] px-1.5 py-0.5 rounded ${isOverdue ? "bg-red-900/50 text-red-300" : "bg-slate-700 text-slate-400"}`}>{new Date(card.dueDate!).toLocaleDateString()}</span>}
        {card.locked && <span className="text-[10px] text-amber-400">🔒</span>}
        {card.isOptimistic && <span className="text-[10px] text-blue-400 animate-pulse">Saving...</span>}
      </div>
    </div>
  );
});
