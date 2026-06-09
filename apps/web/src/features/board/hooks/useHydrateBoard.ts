"use client";

// apps/web/src/features/board/hooks/useHydrateBoard.ts
//
// Phase 1.3 (F1.3.3) — extracted hydration effect from BoardView.
//
// Enriches the server board projection with boardId/revision defaults and
// pushes it into the Zustand store via initBoard. Re-hydrates only when the
// underlying list/card identity hash changes (versionHash), so a parent
// re-render with the same data is a no-op. Also owns the SSR mount guard.

import { useEffect, useRef, useState } from "react";

interface HydrateListInput {
  id: string;
  boardId?: string;
  revision?: number;
  cards?: Array<{
    id: string;
    boardId?: string;
    revision?: number;
    description?: string | null;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

interface HydrateInput {
  lists?: HydrateListInput[];
}

export function useHydrateBoard(
  data: HydrateInput | undefined,
  boardId: string,
  initBoard: (lists: any[], sequence: string) => void,
): { isMounted: boolean } {
  const [isMounted, setIsMounted] = useState(false);
  const boardVersionRef = useRef<string | null>(null);

  useEffect(() => {
    setIsMounted(true);

    const versionHash = JSON.stringify(
      data?.lists?.map(
        (list) => list.id + (list.cards?.map((card) => card.id).join("") || ""),
      ),
    );

    if (boardVersionRef.current !== versionHash) {
      // Enrich each list with boardId before passing to the store. Cards
      // inherit boardId from their list. Mirrors the original BoardView logic.
      const enrichedLists = (data?.lists || []).map((list) => ({
        ...list,
        boardId: list.boardId ?? boardId,
        revision: list.revision ?? 0,
        cards: (list.cards || []).map((card) => ({
          ...card,
          boardId: card.boardId ?? boardId,
          revision: card.revision ?? 0,
          description: card.description ?? undefined,
        })),
      })) as any;

      // sequence "0" — the WS catch-up replays from the real watermark.
      initBoard(enrichedLists, "0");
      boardVersionRef.current = versionHash;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.lists, initBoard]);

  return { isMounted };
}
