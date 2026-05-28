"use client";

// apps/web/src/app/board/[boardId]/_components/LabelsTab.tsx
//
// Drawer tab container for the labels manager. Lives at the `app`
// boundary (not inside features/) so it can legitimately import:
//   • `@/features/labels/components/LabelManager` — feature surface.
//   • `@/features/board/store/mutations/labels/*` — board-feature
//     hooks (the same set the card-detail picker uses).
//   • `@/features/board/store/useBoardStore` — to derive per-label
//     usage counts for the delete-confirm dialog.
//
// The container's job is to translate between the optimistic mutation
// hook API and the LabelManager's prop contract (presentational
// component that knows about labels but nothing about tRPC).
//
// affectedCardCounts (D3 — delete dialog count)
//   The store keeps `cards[].labels: string[]` in sync via the
//   dispatcher's reducer, so we tally locally instead of issuing a
//   per-label COUNT(*) round-trip. We filter to `card.boardId ===
//   boardId` even though labels are board-scoped — a defensive
//   measure in case a multi-board page ever hydrates the same store
//   slice.

import { useMemo } from "react";

import type { ColorToken } from "@repo/domain";

import { trpc } from "../../../../utils/trpc";

import {
  LabelManager,
  type LabelManagerLabel,
} from "@/features/labels/components/LabelManager";

import { useBoardStore } from "@/features/board/store/useBoardStore";

import { useCreateLabel } from "@/features/board/store/mutations/labels/useCreateLabel";
import { useUpdateLabel } from "@/features/board/store/mutations/labels/useUpdateLabel";
import { useDeleteLabel } from "@/features/board/store/mutations/labels/useDeleteLabel";

interface Props {
  boardId: string;
  /**
   * The viewer's board-membership role. ADMIN and OWNER may
   * create / edit / delete / reorder; MEMBER sees a read-only list.
   * Server still enforces D8 — this is a UX-tier mirror.
   */
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export function LabelsTab({ boardId, role }: Props) {
  const canManage = role === "ADMIN" || role === "OWNER";

  // ── Read board labels via tRPC ───────────────────────────────────────────
  // The list endpoint already orders by position server-side, but we
  // re-sort client-side so an optimistic insert (placeholder
  // position="z") lands at the end without a network hop.
  const labelsQuery = trpc.v1.public.label.list.useQuery({ boardId });

  const sortedLabels: LabelManagerLabel[] = useMemo(() => {
    const list =
      (labelsQuery.data ?? []) as Array<{
        id:         string;
        name:       string;
        colorToken: string;
        position:   string;
      }>;
    return list
      .slice()
      .sort((a, b) => a.position.localeCompare(b.position));
  }, [labelsQuery.data]);

  // ── Per-label card counts (delete dialog "X کارت" message) ──────────────
  const cards = useBoardStore(
    (s: any) =>
      s.cards as Record<string, { boardId: string; labels?: string[] }>,
  );

  const affectedCardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const card of Object.values(cards)) {
      if (card.boardId !== boardId) continue;
      const ids = card.labels;
      if (!ids) continue;
      for (const id of ids) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  }, [cards, boardId]);

  // ── Mutation hooks ───────────────────────────────────────────────────────
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  function handleCreate(values: { name: string; colorToken: ColorToken }) {
    createLabel.mutate({
      boardId,
      name:          values.name,
      colorToken:    values.colorToken,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleUpdate(
    labelId: string,
    patch:   { name?: string; colorToken?: ColorToken; position?: string },
  ) {
    updateLabel.mutate({
      labelId,
      boardId,
      ...patch,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleDelete(labelId: string) {
    deleteLabel.mutate({
      labelId,
      boardId,
      correlationId: crypto.randomUUID(),
    });
  }

  // Surface the most recent server-rejection text per mutation so the
  // child can render an inline error inside the relevant form.
  const createError =
    createLabel.error instanceof Error ? createLabel.error.message : null;
  const updateError =
    updateLabel.error instanceof Error ? updateLabel.error.message : null;
  const deleteError =
    deleteLabel.error instanceof Error ? deleteLabel.error.message : null;

  // Loading / error state for the initial fetch.
  if (labelsQuery.isLoading) {
    return <LabelsTabLoading />;
  }
  if (labelsQuery.isError) {
    return <LabelsTabError onRetry={() => labelsQuery.refetch()} />;
  }

  return (
    <LabelManager
      labels={sortedLabels}
      affectedCardCounts={affectedCardCounts}
      canManage={canManage}
      isCreating={createLabel.isPending}
      createError={createError}
      isUpdating={updateLabel.isPending}
      updateError={updateError}
      isDeleting={deleteLabel.isPending}
      deleteError={deleteError}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading / error states (mirror the drawer's Loading / Error treatment)
// ─────────────────────────────────────────────────────────────────────────────

function LabelsTabLoading() {
  return (
    <div className="space-y-3">
      <div className="h-5 w-1/3 animate-pulse rounded bg-slate-200" />
      <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function LabelsTabError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">خطا در بارگذاری برچسب‌ها.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
      >
        تلاش مجدد
      </button>
    </div>
  );
}
