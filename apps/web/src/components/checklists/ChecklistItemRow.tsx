"use client";

// apps/web/src/components/checklists/ChecklistItemRow.tsx
//
// One row in a checklist. Three concerns colocated because they share
// state (focus management, draft text, drag-disabled-while-editing):
//
//   1. Checkbox — toggle isDone (Master Contract D6 — optimistic +
//      rAF batching is the parent's job; this component just calls
//      onToggleDone immediately).
//   2. Inline edit text — click body → input. Enter / blur to submit,
//      Esc to revert. The local draft state is invalidated when the
//      incoming `item.text` flips (e.g. realtime patch wins a race).
//   3. Delete — X icon, no confirm (Trello-style for items, D10).
//
// Drag handle (≡) on the start side, gated by `canDrag`. The drag
// is provided by @dnd-kit's useSortable — same pattern as
// SortableLabelRow in LabelManager (F1.2.1.b). Drag is disabled
// while the row is in edit mode so a click on the body doesn't
// accidentally trigger a sortable handler.
//
// All three actions go through callbacks the parent (ChecklistSection)
// supplies; this row is presentational and never imports from
// `features/board`. Cross-feature ban → callbacks-as-props pattern.

import { useEffect, useRef, useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { ChecklistItemDto } from "@/features/board/store/useBoardStore";

interface Props {
  item: ChecklistItemDto;
  /** Whether the viewer can edit / delete / drag (member ✓; viewer ✗). */
  canEdit: boolean;
  /** Toggle isDone — called immediately (caller handles optimistic). */
  onToggleDone: (itemId: string, isDone: boolean) => void;
  /** Update text after user submits (Enter / blur). Caller trims. */
  onUpdateText: (itemId: string, text: string) => void;
  /** Delete — caller decides confirm/no-confirm (D10: no-confirm). */
  onDelete:     (itemId: string) => void;
}

const ITEM_TEXT_MAX_LENGTH = 500;

export function ChecklistItemRow({
  item,
  canEdit,
  onToggleDone,
  onUpdateText,
  onDelete,
}: Props) {
  const [isEditing, setEditing]   = useState(false);
  const [draftText, setDraftText] = useState(item.text);
  const [error, setError]         = useState<string | null>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  // ── Drag handle (D3 + D20) ──────────────────────────────────────────────
  // Drag is disabled while editing so accidental drags don't kick the row
  // out of edit mode. Disabled entirely for viewer-tier users.
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id:       item.id,
    disabled: !canEdit || isEditing,
  });

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // ── Reconcile incoming text with local draft ────────────────────────────
  // If a realtime patch updates `item.text` while the user wasn't
  // editing, mirror it into the draft so a subsequent edit starts from
  // the new value. We deliberately DON'T overwrite while editing —
  // that would clobber the user's typed input on every Zustand re-render.
  useEffect(() => {
    if (!isEditing) {
      setDraftText(item.text);
    }
  }, [item.text, isEditing]);

  // Auto-focus the input when entering edit mode + select-all so the user
  // can immediately overwrite or extend without an extra click.
  useEffect(() => {
    if (isEditing) {
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  function commitDraft() {
    if (!canEdit) return;
    const trimmed = draftText.trim();
    if (trimmed.length === 0) {
      // Empty after trim → revert (we don't allow blank items).
      setDraftText(item.text);
      setEditing(false);
      setError(null);
      return;
    }
    if (trimmed.length > ITEM_TEXT_MAX_LENGTH) {
      // UI guard mirrors the server cap; the inline message lets the
      // user shorten before submission. The server's CONFLICT/BAD_REQUEST
      // would also surface but this skips the round-trip.
      setError(`متن مورد نباید از ۵۰۰ نویسه بیشتر باشد.`);
      inputRef.current?.focus();
      return;
    }
    if (trimmed !== item.text) {
      onUpdateText(item.id, trimmed);
    }
    setEditing(false);
    setError(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraftText(item.text);
      setEditing(false);
      setError(null);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={dragStyle}
      className={`group/row flex items-start gap-2 rounded px-1 py-1 transition-colors ${
        isDragging
          ? "bg-blue-50 ring-1 ring-blue-300"
          : "hover:bg-slate-50"
      }`}
    >
      {/* Drag handle — start side under RTL inheritance */}
      {canEdit ? (
        <button
          type="button"
          aria-label={`جابجایی مورد ${item.text}`}
          title="جابجایی"
          className="mt-1 flex h-6 w-6 flex-shrink-0 cursor-grab items-center justify-center rounded text-slate-300 opacity-0 transition-opacity hover:text-slate-500 active:cursor-grabbing group-hover/row:opacity-100 focus-visible:opacity-100"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        <span aria-hidden="true" className="h-6 w-6 flex-shrink-0" />
      )}

      {/* Checkbox — Master Contract D6: optimistic toggle */}
      <input
        type="checkbox"
        checked={item.isDone}
        onChange={(event) => onToggleDone(item.id, event.target.checked)}
        disabled={!canEdit}
        aria-label={
          item.isDone
            ? `علامت‌گذاری «${item.text}» به‌عنوان انجام نشده`
            : `علامت‌گذاری «${item.text}» به‌عنوان انجام شده`
        }
        className="mt-1.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      />

      {/* Body — view mode is text; edit mode is input */}
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div>
            <input
              ref={inputRef}
              type="text"
              dir="auto"
              value={draftText}
              onChange={(event) => {
                setDraftText(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={handleKeyDown}
              onBlur={commitDraft}
              maxLength={ITEM_TEXT_MAX_LENGTH + 4}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? "true" : "false"}
              className="block w-full rounded border border-blue-400 bg-white px-2 py-1 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {error ? (
              <p role="alert" className="mt-1 text-[11px] text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!canEdit) return;
              setEditing(true);
            }}
            disabled={!canEdit}
            dir="auto"
            className={`block w-full break-words rounded px-2 py-1 text-start text-sm transition-colors ${
              item.isDone
                ? "text-slate-400 line-through"
                : "text-slate-800"
            } ${
              canEdit ? "cursor-text hover:bg-slate-100" : "cursor-default"
            }`}
          >
            {item.text}
          </button>
        )}
      </div>

      {/* Delete X — visible on hover/focus only, no confirm (D10) */}
      {canEdit && !isEditing ? (
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          aria-label={`حذف مورد ${item.text}`}
          title="حذف"
          className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover/row:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}
