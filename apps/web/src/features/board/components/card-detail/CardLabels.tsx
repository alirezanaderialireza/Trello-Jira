"use client";

// apps/web/src/features/board/components/card-detail/CardLabels.tsx
//
// Container that wires the LabelPicker (now in @/components/labels —
// hoisted from features/labels per D21 to satisfy the boundaries
// linter's cross-feature ban) into the card-detail surface.
//
// Responsibilities the container owns:
//   • tRPC read   — `trpc.v1.public.label.list.useQuery({ boardId })`
//                   per Spec 2.3 ("read at parent level, prop-down").
//   • Mutations   — `useAddCardLabel` / `useRemoveCardLabel` /
//                   `useCreateLabel` from features/board's own
//                   store/mutations slice. Each pre-existing optimistic
//                   hook handles envelope generation, store dispatch,
//                   server reconciliation, and rollback toast.
//   • L-key       — D3 keyboard shortcut. Toggles the picker unless
//                   focus is in an input / textarea / contenteditable.
//   • Defence (R9) — verifies a clicked labelId belongs to this board
//                    before forwarding to applyToCard. The server's
//                    LabelBoardMismatchError is the second layer.
//   • Applied list — reads `state.cards[cardId].labels` + `state.labels`
//                    from the Zustand store (the dispatcher already
//                    keeps these in sync with realtime events).
//   • Empty state  — no applied labels => only show the "+ برچسب"
//                    trigger; the picker's own empty-state shows the
//                    create CTA.
//
// LabelPicker is purely presentational; this container owns all
// state + side-effects.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import type { ColorToken } from "@repo/domain";

import { trpc } from "../../../../utils/trpc";

import { LabelBadge } from "@/components/labels/LabelBadge";
import {
  LabelPicker,
  type LabelPickerLabel,
} from "@/components/labels/LabelPicker";

import { useBoardStore } from "../../store/useBoardStore";
import { useCreateLabel }     from "../../store/mutations/labels/useCreateLabel";
import { useAddCardLabel }    from "../../store/mutations/labels/useAddCardLabel";
import { useRemoveCardLabel } from "../../store/mutations/labels/useRemoveCardLabel";

interface Props {
  cardId: string;
  boardId: string;
}

export function CardLabels({ cardId, boardId }: Props) {
  // ── Picker open/close state ──────────────────────────────────────────────
  const [isPickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerWrapperRef = useRef<HTMLDivElement>(null);

  // ── Board labels (single source of truth on the wire) ────────────────────
  // The tRPC query is paired with the store's labels slice — the
  // realtime patch loop keeps both in sync, but the query is what the
  // picker filters and the create form duplicate-checks against.
  const { data: boardLabelsRaw = [] } =
    trpc.v1.public.label.list.useQuery({ boardId });

  const boardLabels: LabelPickerLabel[] = useMemo(
    () =>
      (boardLabelsRaw as Array<{
        id:         string;
        name:       string;
        colorToken: string;
        position:   string;
      }>)
        .slice()
        .sort((a, b) => a.position.localeCompare(b.position)),
    [boardLabelsRaw],
  );

  // ── Currently applied labels (read from store — already kept in sync) ───
  const cardLabelIds = useBoardStore(
    (s: any) => s.cards[cardId]?.labels as string[] | undefined,
  );
  const labelMap = useBoardStore(
    (s: any) =>
      s.labels as Record<
        string,
        { id: string; name: string; colorToken: string; position: string }
      >,
  );

  const appliedLabels = useMemo(() => {
    if (!cardLabelIds || cardLabelIds.length === 0) return [];
    return cardLabelIds
      .map((id) => labelMap[id])
      .filter(Boolean)
      .sort((a, b) => a.position.localeCompare(b.position));
  }, [cardLabelIds, labelMap]);

  const cardLabelIdSet = useMemo(
    () => new Set(cardLabelIds ?? []),
    [cardLabelIds],
  );

  // ── Mutations ────────────────────────────────────────────────────────────
  const createLabel     = useCreateLabel();
  const addCardLabel    = useAddCardLabel();
  const removeCardLabel = useRemoveCardLabel();

  // ── D3: L keyboard shortcut to toggle the picker ─────────────────────────
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Skip when the user is typing into a control — the L key is a
      // common letter and we mustn't intercept it inside titles, the
      // description editor, or a comment box.
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      // Plain "l" / "L" — no Ctrl/Meta/Alt to avoid colliding with
      // browser shortcuts.
      if (
        (event.key === "l" || event.key === "L") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setPickerOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Apply / remove handlers (R9 defence-in-depth) ───────────────────────
  function handleApply(labelId: string) {
    // Verify the labelId actually belongs to this board before
    // forwarding. The server's LabelBoardMismatchError is the second
    // layer; this catches a stale tRPC cache that surfaced a label
    // from a different board's list query (very unlikely but cheap).
    const label = boardLabels.find((l) => l.id === labelId);
    if (!label || !labelMap[labelId]) return;
    addCardLabel.mutate({
      cardId,
      boardId,
      labelId,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleRemove(labelId: string) {
    removeCardLabel.mutate({
      cardId,
      boardId,
      labelId,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleCreate(values: { name: string; colorToken: ColorToken }) {
    createLabel.mutate({
      boardId,
      name:           values.name,
      colorToken:     values.colorToken,
      correlationId:  crypto.randomUUID(),
    });
  }

  // The picker takes a single in-flight prop covering both apply +
  // remove, since the user can only interact with one row at a time
  // and the visual feedback is identical.
  const isApplyingOrRemoving =
    addCardLabel.isPending || removeCardLabel.isPending;

  // Persian server-rejection message for the create form. The optimistic
  // hook surfaces a sonner toast; we also forward the persisted error
  // text into the picker so the inline form can highlight the input.
  const createError =
    createLabel.error instanceof Error ? createLabel.error.message : null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
        برچسب‌ها
      </h3>

      {/* Applied labels + open-picker trigger */}
      <div className="flex flex-wrap items-center gap-2">
        {appliedLabels.map((label) => (
          <button
            key={label.id}
            type="button"
            onClick={() => handleRemove(label.id)}
            disabled={isApplyingOrRemoving}
            aria-label={`حذف برچسب «${label.name}»`}
            title={`حذف برچسب «${label.name}»`}
            className="rounded-full transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <LabelBadge
              name={label.name}
              colorToken={label.colorToken}
              size="md"
            />
          </button>
        ))}

        {/* Add-label trigger */}
        <div className="relative" ref={pickerWrapperRef}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setPickerOpen((prev) => !prev)}
            aria-haspopup="dialog"
            aria-expanded={isPickerOpen}
            aria-label="افزودن برچسب (کلید L)"
            title="افزودن برچسب (کلید L)"
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-500 px-3 py-1 text-sm font-medium text-slate-300 hover:border-slate-400 hover:bg-slate-700/50 hover:text-slate-100"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>برچسب</span>
          </button>

          {isPickerOpen ? (
            <div className="absolute top-full start-0 z-30 mt-2">
              <LabelPicker
                labels={boardLabels}
                cardLabelIds={cardLabelIdSet}
                isApplying={isApplyingOrRemoving}
                isCreating={createLabel.isPending}
                createError={createError}
                onApply={handleApply}
                onRemove={handleRemove}
                onCreate={handleCreate}
                onClose={() => {
                  setPickerOpen(false);
                  // Restore focus to the trigger so keyboard users
                  // don't lose their place in the modal.
                  triggerRef.current?.focus();
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
