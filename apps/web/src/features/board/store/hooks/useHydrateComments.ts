"use client";

// apps/web/src/features/board/store/hooks/useHydrateComments.ts
//
// Fetches comments for a card (cursor-paginated, newest-first from the
// server), hydrates the Zustand store on success, and exposes
// pagination controls for the CommentsList.
//
// Hydration pattern mirrors CardChecklists (F1.2.3.b):
//   1. Call trpc.v1.public.comment.list via useInfiniteQuery.
//   2. On success, dispatch synthetic comment.created envelopes so the
//      store reducer (applyCommentCreated) owns the merge logic —
//      idempotent, revision-guarded.
//   3. After hydration, UI reads exclusively from the Zustand store.
//
// Pagination:
//   The server returns newest-first (desc createdAt). The UI displays
//   oldest-first (chronological). The hook exposes fetchPreviousPage
//   so CommentsList can show a «نمایش کامنت‌های قدیمی‌تر» CTA at the
//   top of the list.

import { useEffect } from "react";
import { trpc }         from "../../../../utils/trpc";
import { useBoardStore } from "../useBoardStore";

const PAGE_LIMIT = 20;

interface Options {
  cardId:  string;
  boardId: string;
}

export function useHydrateComments({ cardId, boardId }: Options) {
  const applyEvent = useBoardStore((s) => s.applyEvent);

  // useInfiniteQuery with cursor-based pagination.
  // getNextPageParam feeds the nextCursor from each page as cursor for
  // the next call — but since the server orders desc (newest-first) and
  // we want to load _older_ comments by paginating, the cursor logic is:
  //   • Initial fetch: no cursor → returns the latest PAGE_LIMIT comments
  //   • "Load older": pass nextCursor (= oldest id on current page) →
  //     server returns comments older than that cursor
  const query = (trpc as any).v1.public.comment.list.useInfiniteQuery(
    { boardId, cardId, limit: PAGE_LIMIT },
    {
      getNextPageParam: (lastPage: any) => lastPage.nextCursor ?? undefined,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  // Hydrate store whenever new pages arrive.
  useEffect(() => {
    if (!query.data) return;

    for (const page of query.data.pages as any[]) {
      for (const c of (page.comments ?? []) as any[]) {
        applyEvent(
          {
            event: {
              id:            `hydrate-comment-${c.id}`,
              type:          "comment.created",
              version:       c.revision ?? 1,
              occurredAt:    c.createdAt,
              aggregateId:   c.cardId,
              aggregateType: "card",
              payload: {
                commentId: c.id,
                cardId:    c.cardId,
                boardId:   c.boardId,
                authorId:  c.authorId,
                body:      c.body,
                createdAt: c.createdAt,
                revision:  c.revision ?? 1,
              },
            },
            optimistic: false,
          } as any,
          { mode: "live" },
        );
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.dataUpdatedAt]);

  return {
    isLoading:           query.isLoading,
    isError:             query.isError,
    hasNextPage:         query.hasNextPage ?? false,
    isFetchingNextPage:  query.isFetchingNextPage,
    fetchNextPage:       query.fetchNextPage,
  };
}
