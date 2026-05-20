"use client";
import { useRef, useState, useCallback, useMemo } from "react";
import { useBoardStore } from "../../store/useBoardStore";
import { computeVisibleLists, computeTotalContentWidth } from "../../store/sync/performance/virtualRenderer";
import { VirtualizedListColumn } from "./VirtualizedListColumn";

const LIST_WIDTH = 288;
const LIST_GAP = 16;

export function VirtualizedBoard() {
  const [scrollLeft, setScrollLeft] = useState(0);
  const listOrder = useBoardStore((s) => s.listOrder);
  const totalLists = listOrder.length;
  const totalContentWidth = computeTotalContentWidth(totalLists);

  const visibleRange = useMemo(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    return computeVisibleLists({ scrollLeft, scrollTop: 0, viewportWidth: vw, viewportHeight: 0 }, totalLists);
  }, [scrollLeft, totalLists]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => { setScrollLeft(e.currentTarget.scrollLeft); }, []);

  const visibleListIds = useMemo(() => {
    const ids: string[] = [];
    for (let i = visibleRange.startIndex; i <= visibleRange.endIndex; i++) { if (listOrder[i]) ids.push(listOrder[i]); }
    return ids;
  }, [visibleRange, listOrder]);

  return (
    <div onScroll={handleScroll} className="flex-1 overflow-x-auto overflow-y-hidden p-6" style={{ position: "relative" }}>
      <div style={{ width: totalContentWidth, display: "flex", gap: LIST_GAP, paddingLeft: visibleRange.startIndex * (LIST_WIDTH + LIST_GAP) }}>
        {visibleListIds.map((listId) => <VirtualizedListColumn key={listId} listId={listId} />)}
      </div>
    </div>
  );
}
