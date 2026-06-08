"use client";

// apps/web/src/features/board/components/card-detail/CardActivity.tsx
//
// Phase 1.2 (F1.2.6) — full rewrite of the Phase-4 stub.
//
// Data strategy (D7):
//   1. Initial load: trpc.v1.public.activity.getByCard (enriched server data)
//   2. Real-time:    useBoardStore.activityFeed (websocket-pushed events)
//   3. Merge:        dedup by id, sort DESC by timestamp
//
// Pagination (D9): cursor-based via nextCursor (ISO timestamp).
//   «نمایش بیشتر» appends next page to allEntries.

import { useCallback, useMemo, useState } from "react";
import { Loader2 }            from "lucide-react";

import { trpc }               from "../../../../utils/trpc";
import { useBoardStore }      from "../../store/useBoardStore";
import type { ActivityEntry } from "../../store/useBoardStore";
import { ActivityRow }        from "./activity/ActivityRow";
import { ActivitySkeleton }   from "./activity/ActivitySkeleton";

interface Props {
  cardId:  string;
  boardId: string;
}

const PAGE_LIMIT = 20;

export function CardActivity({ cardId, boardId }: Props) {
  // ── Cursor state for pagination ───────────────────────────────────────────
  const [cursor,     setCursor]     = useState<string | undefined>(undefined);
  const [allEntries, setAllEntries] = useState<ActivityEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // ── tRPC query (initial + paginated loads) ────────────────────────────────
  const query = trpc.v1.public.activity.getByCard.useQuery(
    { boardId, cardId, limit: PAGE_LIMIT, cursor },
    {
      staleTime: 30_000,
      onSuccess: (data: any) => {
        const incoming = (data.events ?? []) as ActivityEntry[];
        setAllEntries((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const fresh = incoming.filter((e) => !seen.has(e.id));
          // Sort all together DESC by timestamp
          return [...prev, ...fresh].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
        });
        setNextCursor((data.nextCursor as string | null) ?? null);
      },
    } as any,
  );

  // ── Real-time feed from store (D7) ────────────────────────────────────────
  const realtimeEntries = useBoardStore(
    useCallback(
      (s: any) =>
        (s.activityFeed as ActivityEntry[]).filter(
          (e) => (e.payload as any)?.cardId === cardId,
        ),
      [cardId],
    ),
  ) as ActivityEntry[];

  // ── Merge + dedup ─────────────────────────────────────────────────────────
  const merged = useMemo(() => {
    const serverIds = new Set(allEntries.map((e) => e.id));
    const rtNew = realtimeEntries.filter((e) => !serverIds.has(e.id));
    return [...rtNew, ...allEntries].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [allEntries, realtimeEntries]);

  // ── Board members for name/avatar resolution ──────────────────────────────
  const boardMembers = useBoardStore((s: any) => s.boardMembers);

  // ── Load more ─────────────────────────────────────────────────────────────
  const [loadingMore, setLoadingMore] = useState(false);

  function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setCursor(nextCursor);
    // Reset loadingMore once the next query result arrives.
    // onSuccess above will set allEntries; we clear flag after mount.
    setTimeout(() => setLoadingMore(false), 3000);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isInitialLoading = query.isLoading && allEntries.length === 0;

  return (
    <div dir="rtl">
      <h3 className="mb-3 text-xs font-semibold uppercase text-slate-400">
        فعالیت‌ها
      </h3>

      {isInitialLoading ? (
        <ActivitySkeleton />
      ) : merged.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          هنوز فعالیتی ثبت نشده.
        </p>
      ) : (
        <div className="space-y-0.5">
          {merged.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              boardMembers={boardMembers}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {nextCursor ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore || query.isFetching}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore || query.isFetching ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                <span>در حال بارگذاری...</span>
              </>
            ) : (
              "نمایش بیشتر"
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
