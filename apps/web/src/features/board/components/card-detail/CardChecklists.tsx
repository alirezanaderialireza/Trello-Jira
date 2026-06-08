"use client";

// apps/web/src/features/board/components/card-detail/CardChecklists.tsx
//
// Container for the checklists section of a card detail modal.
// Mirrors CardLabels.tsx pattern:
//   • Initial data fetched via tRPC (checklist.list + checklist.listItems)
//   • Store hydrated on success — subsequent state comes from Zustand
//   • Mutations flow through optimistic hooks (never raw tRPC)
//
// T7 HYDRATION DECISION (documented in checklists-conventions.md):
//   checklist.list returns checklists WITHOUT items. Items must be
//   fetched separately via checklist.listItems per checklist, OR via
//   a single per-card fetch.
//   CHOICE: Fetch checklists first, then for each checklist fetch its
//   items. Both fetches populate the Zustand store. After hydration,
//   all state reads go through the store (no re-fetching on toggle etc).
//   Rationale: Keeps the server contract clean (no forced nesting),
//   avoids an N+1 problem at the component level by using useQueries.
//
// VIEWER AUTH:
//   Board role comes from the board context (CardDetailModal passes boardId).
//   We read the workspace membership from the session in the parent; here
//   we accept viewerId + viewerRole as props from the modal which already
//   has access to them. If not provided, defaults to empty string / MEMBER.

import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { trpc }         from "../../../../utils/trpc";
import { useBoardStore } from "../../store/useBoardStore";
import { ChecklistManager } from "./checklists/ChecklistManager";

interface Props {
  cardId:      string;
  boardId:     string;
  /** userId of the current viewer — used by ChecklistManager for delete gating. */
  viewerId?:   string;
  /** Board role: "OWNER" | "ADMIN" | "MEMBER" — default "MEMBER". */
  viewerRole?: string;
}

export function CardChecklists({
  cardId,
  boardId,
  viewerId   = "",
  viewerRole = "MEMBER",
}: Props) {
  // ── 1. Fetch checklists list ─────────────────────────────────────────────
  const checklistsQuery = trpc.v1.public.checklist.list.useQuery(
    { boardId, cardId },
    { staleTime: 30_000 },
  );

  const rawChecklists = (checklistsQuery.data ?? []) as Array<{
    id:        string;
    cardId:    string;
    boardId:   string;
    title:     string;
    position:  string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  }>;

  // ── 2. Fetch items for each checklist (parallel, cached) ─────────────────
  // useQueries fires N queries in parallel with React Query's coordination.
  // Each query is keyed by checklistId so it only re-runs if the checklist
  // list changes. staleTime matches the parent query so they cohere.
  const itemsQueryResults = useQueries({
    queries: rawChecklists.map((cl) => ({
      queryKey: ["checklist.listItems", boardId, cl.id] as const,
      queryFn:  () =>
        (trpc as any).v1.public.checklist.listItems.query({
          boardId,
          checklistId: cl.id,
        }) as Promise<
          Array<{
            id:          string;
            checklistId: string;
            text:        string;
            isDone:      boolean;
            position:    string;
          }>
        >,
      staleTime: 30_000,
      enabled:   !!cl.id,
    })),
  });

  // ── 3. Hydrate the Zustand store ─────────────────────────────────────────
  // Once both checklists + all their items are loaded, write them into
  // the store via applyEvent with optimistic: false so the revision
  // guard lets them through. We use a synthetic "checklist.created"
  // envelope for each checklist (mirroring how CardLabels hydrates via
  // the store's applyEvent action).
  //
  // NOTE: We use store.applyEvent with version=1 for initial hydration.
  // If a WS event for the same checklist arrives first it will have
  // revision>0 and will overwrite; if hydration arrives after WS it
  // is ignored because revision guard skips lower versions.

  const applyEvent = useBoardStore((s) => s.applyEvent);

  const allItemsLoaded = itemsQueryResults.every((r) => r.isSuccess);

  useEffect(() => {
    if (!checklistsQuery.isSuccess || !allItemsLoaded) return;

    rawChecklists.forEach((cl, idx) => {
      const itemsResult = itemsQueryResults[idx];
      const items = itemsResult?.data ?? [];

      // Hydrate checklist with its items by dispatching a created event.
      // The reducer checks `existing.revision >= envelope.version`, so
      // version:1 only applies if no WS event has set revision≥1 yet.
      applyEvent(
        {
          event: {
            id:            `hydrate-${cl.id}`,
            type:          "checklist.created",
            version:       1,
            occurredAt:    cl.createdAt,
            aggregateId:   cl.cardId,
            aggregateType: "card",
            payload: {
              checklistId: cl.id,
              cardId:      cl.cardId,
              boardId:     cl.boardId,
              title:       cl.title,
              position:    cl.position,
              createdBy:   cl.createdBy,
            },
          },
          optimistic: false,
        } as any,
        { mode: "live" },
      );

      // Hydrate each item via item_added events.
      items.forEach((item) => {
        applyEvent(
          {
            event: {
              id:            `hydrate-item-${item.id}`,
              type:          "checklist.item_added",
              version:       1,
              occurredAt:    new Date().toISOString(),
              aggregateId:   cl.cardId,
              aggregateType: "card",
              payload: {
                checklistItemId: item.id,
                checklistId:     item.checklistId,
                cardId:          cl.cardId,
                boardId:         cl.boardId,
                text:            item.text,
                isDone:          item.isDone,
                position:        item.position,
                addedBy:         "",
              },
            },
            optimistic: false,
          } as any,
          { mode: "live" },
        );
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Intentionally keyed only on the raw data references — we re-hydrate
    // if the server data changes (e.g. after a stale-time refresh).
  }, [checklistsQuery.dataUpdatedAt, allItemsLoaded]);

  // ── 4. Read checklists from store (single source of truth after hydrate) ─
  const checklistsByCard = useBoardStore((s) => s.checklistsByCard);
  const checklistsMap    = useBoardStore((s) => s.checklists);

  const checklists = useMemo(() => {
    const ids = checklistsByCard[cardId] ?? [];
    return ids
      .map((id) => checklistsMap[id])
      .filter(Boolean);
  }, [checklistsByCard, cardId, checklistsMap]);

  // ── 5. Loading / error states ────────────────────────────────────────────
  if (checklistsQuery.isLoading) {
    return (
      <div dir="rtl">
        <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
          چک‌لیست‌ها
        </h3>
        <div className="space-y-2">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-16 animate-pulse rounded-lg bg-slate-700/40"
            />
          ))}
        </div>
      </div>
    );
  }

  if (checklistsQuery.isError) {
    return (
      <div dir="rtl">
        <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
          چک‌لیست‌ها
        </h3>
        <p className="text-xs text-red-400">
          بارگذاری چک‌لیست‌ها با خطا مواجه شد. لطفاً صفحه را بازنشانی کنید.
        </p>
      </div>
    );
  }

  // ── 6. Render ─────────────────────────────────────────────────────────────
  return (
    <div dir="rtl">
      <h3 className="mb-3 text-xs font-semibold uppercase text-slate-400">
        چک‌لیست‌ها
      </h3>
      <ChecklistManager
        checklists={checklists}
        cardId={cardId}
        boardId={boardId}
        viewerId={viewerId}
        viewerRole={viewerRole}
      />
    </div>
  );
}
