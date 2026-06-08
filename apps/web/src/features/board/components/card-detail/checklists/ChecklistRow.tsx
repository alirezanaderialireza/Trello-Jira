"use client";

// apps/web/src/features/board/components/card-detail/checklists/ChecklistRow.tsx
//
// A single checklist — header with inline title rename, progress bar,
// conditional delete button, and a sortable list of items + InlineAddItem.
//
// Progress bar and count are computed client-side from the items array.
// Persian numerals: toLocaleString("fa-IR").
// Delete button shown only when canDelete (creator || admin/owner).
//
// DnD: SortableContext for items. The row itself is NOT sortable here —
// the parent ChecklistManager wraps rows in its own SortableContext.

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Trash2 } from "lucide-react";
import { generatePosition } from "@repo/domain/ordering";

import type { ChecklistDto } from "../../../store/useBoardStore";
import { useUpdateChecklist }     from "../../../store/mutations/checklists/useUpdateChecklist";
import { useUpdateChecklistItem } from "../../../store/mutations/checklists/useUpdateChecklistItem";
import { ChecklistItemRow }       from "./ChecklistItemRow";
import { InlineAddItem }          from "./InlineAddItem";

interface Props {
  checklist:  ChecklistDto;
  cardId:     string;
  boardId:    string;
  /** True when the viewer is creator OR board admin/owner — mirrors server auth. */
  canDelete:  boolean;
  onRequestDelete: () => void;
  /** Titles of other checklists on this card (for duplicate validation). */
  otherTitles: readonly string[];
}

export function ChecklistRow({
  checklist,
  cardId,
  boardId,
  canDelete,
  onRequestDelete,
  otherTitles,
}: Props) {
  // ── Inline rename state ──────────────────────────────────────────────────
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue,     setTitleValue]     = useState(checklist.title);
  const [titleError,     setTitleError]     = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const updateChecklist = useUpdateChecklist();
  const updateItem      = useUpdateChecklistItem();

  // Sync title if the store updates from a WS echo while not editing.
  useEffect(() => {
    if (!isEditingTitle) setTitleValue(checklist.title);
  }, [checklist.title, isEditingTitle]);

  // Focus title input on edit mode.
  useEffect(() => {
    if (isEditingTitle) {
      queueMicrotask(() => {
        if (titleInputRef.current) {
          titleInputRef.current.focus();
          titleInputRef.current.select();
        }
      });
    }
  }, [isEditingTitle]);

  // ── Progress ─────────────────────────────────────────────────────────────
  const total     = checklist.items.length;
  const done      = checklist.items.filter((i) => i.isDone).length;
  const pct       = total > 0 ? Math.round((done / total) * 100) : 0;
  const doneFa    = done.toLocaleString("fa-IR");
  const totalFa   = total.toLocaleString("fa-IR");

  // ── DnD for items ────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortedItems = [...checklist.items].sort((a, b) =>
    a.position.localeCompare(b.position),
  );
  const itemIds = sortedItems.map((i) => i.id);

  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = sortedItems.findIndex((i) => i.id === active.id);
    const newIdx = sortedItems.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const reordered = arrayMove([...sortedItems], oldIdx, newIdx);
    const idx       = reordered.findIndex((i) => i.id === active.id);
    const prev      = reordered[idx - 1]?.position;
    const next      = reordered[idx + 1]?.position;
    const newPos    = generatePosition(prev, next);

    updateItem.mutate({
      checklistId:     checklist.id,
      checklistItemId: active.id as string,
      cardId,
      boardId,
      position:      newPos,
      correlationId: crypto.randomUUID(),
    });
  }

  // ── Title handlers ────────────────────────────────────────────────────────

  function validateTitle(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed)            return "عنوان چک‌لیست الزامی است.";
    if (trimmed.length > 100) return "عنوان چک‌لیست نباید از ۱۰۰ نویسه بیشتر باشد.";
    const fold = trimmed.toLocaleLowerCase("fa-IR");
    const isDuplicate = otherTitles.some(
      (t) => t.toLocaleLowerCase("fa-IR") === fold,
    );
    if (isDuplicate) return "این عنوان چک‌لیست قبلاً در این کارت وجود دارد.";
    return null;
  }

  function handleTitleSave() {
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === checklist.title) {
      setTitleValue(checklist.title);
      setTitleError(null);
      setIsEditingTitle(false);
      return;
    }
    const err = validateTitle(titleValue);
    if (err) { setTitleError(err); return; }

    setTitleError(null);
    updateChecklist.mutate({
      checklistId:   checklist.id,
      cardId,
      boardId,
      title:         trimmed,
      correlationId: crypto.randomUUID(),
    });
    setIsEditingTitle(false);
  }

  function handleTitleCancel() {
    setTitleValue(checklist.title);
    setTitleError(null);
    setIsEditingTitle(false);
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  { e.preventDefault(); handleTitleSave(); }
    if (e.key === "Escape") { e.preventDefault(); handleTitleCancel(); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      dir="rtl"
      className="rounded-lg border border-slate-700 bg-slate-800/60 p-3"
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        {/* Title (view or edit) */}
        <div className="min-w-0 flex-1">
          {isEditingTitle ? (
            <div>
              <input
                ref={titleInputRef}
                type="text"
                dir="auto"
                value={titleValue}
                onChange={(e) => { setTitleValue(e.target.value); if (titleError) setTitleError(null); }}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                maxLength={100}
                aria-label="ویرایش عنوان چک‌لیست"
                className={`w-full rounded border px-2 py-1 text-sm font-semibold text-slate-100 bg-slate-700 outline-none ring-2 ${
                  titleError
                    ? "border-red-500 ring-red-500/30"
                    : "border-blue-500 ring-blue-500/30"
                }`}
              />
              {titleError ? (
                <p role="alert" className="mt-1 text-xs text-red-400">
                  {titleError}
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingTitle(true)}
              title="کلیک برای ویرایش عنوان"
              className="text-start text-sm font-semibold text-slate-100 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            >
              {checklist.title}
            </button>
          )}
        </div>

        {/* Progress count */}
        {total > 0 && (
          <span
            aria-label={`${doneFa} از ${totalFa} مورد تکمیل شده`}
            className="flex-shrink-0 text-[11px] text-slate-500 tabular-nums"
          >
            {doneFa}/{totalFa}
          </span>
        )}

        {/* Delete button — only if canDelete */}
        {canDelete && (
          <button
            type="button"
            onClick={onRequestDelete}
            aria-label={`حذف چک‌لیست «${checklist.title}»`}
            title="حذف چک‌لیست"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-500 hover:bg-red-900/30 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-700"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct.toLocaleString("fa-IR")}٪ تکمیل شده`}
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Items list */}
      {sortedItems.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleItemDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <ul className="mt-3 space-y-0.5">
              {sortedItems.map((item) => (
                <ChecklistItemRow
                  key={item.id}
                  item={item}
                  checklistId={checklist.id}
                  cardId={cardId}
                  boardId={boardId}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Add item form */}
      <InlineAddItem
        checklistId={checklist.id}
        cardId={cardId}
        boardId={boardId}
      />
    </div>
  );
}
