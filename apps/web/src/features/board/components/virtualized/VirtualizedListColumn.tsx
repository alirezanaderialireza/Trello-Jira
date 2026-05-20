"use client";
import { useRef, useState, useCallback, useMemo, memo } from "react";
import { useBoardStore } from "../../store/useBoardStore";
import { computeVisibleCards, computeTotalContentHeight } from "../../store/sync/performance/virtualRenderer";
import { selectCardIdsInList, selectListById } from "../../store/sync/performance/selectorCache";
import { VirtualizedCardItem } from "./VirtualizedCardItem";

const CARD_HEIGHT = 72;
const CARD_GAP = 8;
const CONTAINER_HEIGHT = 600;

interface Props { listId: string; }

export const VirtualizedListColumn = memo(function VirtualizedListColumn({ listId }: Props) {
  const list = useBoardStore(selectListById(listId));
  const cardIds = useBoardStore(selectCardIdsInList(listId));
  const [scrollTop, setScrollTop] = useState(0);
  const totalCards = cardIds.length;
  const totalContentHeight = computeTotalContentHeight(totalCards);

  const visibleRange = useMemo(() => computeVisibleCards(scrollTop, CONTAINER_HEIGHT, totalCards), [scrollTop, totalCards]);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => { setScrollTop(e.currentTarget.scrollTop); }, []);

  const visibleCardIds = useMemo(() => {
    const ids: string[] = [];
    for (let i = visibleRange.startIndex; i <= visibleRange.endIndex; i++) { if (cardIds[i]) ids.push(cardIds[i]); }
    return ids;
  }, [visibleRange, cardIds]);

  if (!list) return null;

  return (
    <div className="w-72 shrink-0 rounded-lg bg-slate-800 flex flex-col max-h-[calc(100vh-120px)]">
      <div className="px-3 py-2.5 border-b border-slate-700">
        <h3 className="text-sm font-semibold text-white truncate">{list.title}</h3>
        <span className="text-[10px] text-slate-500">{totalCards} cards</span>
      </div>
      <div onScroll={handleScroll} className="flex-1 overflow-y-auto px-2 py-2" style={{ maxHeight: CONTAINER_HEIGHT }}>
        <div style={{ height: totalContentHeight, position: "relative" }}>
          {visibleCardIds.map((cardId, idx) => {
            const top = (visibleRange.startIndex + idx) * (CARD_HEIGHT + CARD_GAP);
            return (<div key={cardId} style={{ position: "absolute", top, left: 0, right: 0, height: CARD_HEIGHT }}><VirtualizedCardItem cardId={cardId} /></div>);
          })}
        </div>
      </div>
      <div className="px-3 py-2 border-t border-slate-700"><button className="w-full text-left text-xs text-slate-400 hover:text-slate-200">+ Add a card</button></div>
    </div>
  );
});
