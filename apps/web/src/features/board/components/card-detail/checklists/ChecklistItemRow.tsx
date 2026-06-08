"use client";

// apps/web/src/features/board/components/card-detail/checklists/ChecklistItemRow.tsx
//
// Single checklist item row — lives in features/board (NOT shared)
// because it directly calls board mutation hooks. Any component that
// needs a read-only summary (e.g. CardItem badge) uses the shared
// ChecklistProgressBadge in components/cards/ instead.
//
// Responsibilities:
//   • Checkbox to toggle isDone via useUpdateChecklistItem({ isDone })
//   • Click-on-text inline rename via useUpdateChecklistItem({ text })
//   • Drag handle for position reorder via useUpdateChecklistItem({ position })
//   • Trash icon to delete via useRemoveChecklistItem
//
// Keyboard: Enter saves rename, Esc cancels.
// DnD: @dnd-kit/sortable. Drag handle carries listeners so the text
//      click target doesn't accidentally start a drag.

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";

import type { ChecklistItemDto } from "../../../store/useBoardStore";
import { useUpdateChecklistItem } from "../../../store/mutations/checklists/useUpdateChecklistItem";
import { useRemoveChecklistItem } from "../../../store/mutations/checklists/useRemoveChecklistItem";

interface Props {
  item:        ChecklistItemDto;
  checklistId: string;
  cardId:      string;
  boardId:     string;
}

export function ChecklistItemRow({ item, checklistId, cardId, boardId }: Props) {
  const [isEditing, setIsEditing]   = useState(false);
  const [editText,  setEditText]    = useState(item.text);
  const inputRef                    = useRef<HTMLInputElement>(null);

  const updateItem = useUpdateChecklistItem();
  const removeItem = useRemoveChecklistItem();

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id:       item.id,
    disabled: isEditing,
  });

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
  };

  // Sync text if the store updates from a WS echo while not editing.
  useEffect(() => {
    if (!isEditing) setEditText(item.text);
  }, [item.text, isEditing]);

  // Focus the input when entering edit mode.
  useEffect(() => {
    if (isEditing) {
      queueMicrotask(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
    }
  }, [isEditing]);

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleToggle() {
    updateItem.mutate({
      checklistId,
      checklistItemId: item.id,
      cardId,
      boardId,
      isDone:          !item.isDone,
      correlationId:   crypto.randomUUID(),
    });
  }

  function handleStartEdit() {
    setEditText(item.text);
    setIsEditing(true);
  }

  function handleSave() {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === item.text) {
      setEditText(item.text);
      setIsEditing(false);
      return;
    }
    if (trimmed.length > 500) return; // client-side guard
    updateItem.mutate({
      checklistId,
      checklistItemId: item.id,
      cardId,
      boardId,
      text:          trimmed,
      correlationId: crypto.randomUUID(),
    });
    setIsEditing(false);
  }

  function handleCancel() {
    setEditText(item.text);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") { e.preventDefault(); handleCancel(); }
  }

  function handleDelete() {
    removeItem.mutate({
      checklistId,
      checklistItemId: item.id,
      cardId,
      boardId,
      correlationId: crypto.randomUUID(),
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <li
      ref={setNodeRef}
      style={style}
      dir="rtl"
      className={`group flex items-start gap-2 rounded-md px-2 py-1.5 transition-all ${
        isDragging ? "opacity-50 bg-slate-700/50 shadow-lg" : "hover:bg-slate-700/30"
      }`}
    >
      {/* Drag handle — carries dnd-kit listeners so text clicks don't drag */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="جابجایی مورد"
        title="جابجایی"
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 cursor-grab items-center justify-center rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-300 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={item.isDone}
        onChange={handleToggle}
        disabled={updateItem.isPending}
        aria-label={item.isDone ? `علامت‌زدایی: ${item.text}` : `تکمیل: ${item.text}`}
        className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-slate-500 bg-slate-700 text-emerald-500 accent-emerald-500 disabled:cursor-not-allowed"
      />

      {/* Text — view or edit */}
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            dir="auto"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            maxLength={500}
            aria-label="ویرایش متن مورد"
            className="w-full rounded border border-blue-500 bg-slate-700 px-2 py-0.5 text-sm text-slate-100 outline-none ring-2 ring-blue-500/30"
          />
        ) : (
          <button
            type="button"
            onClick={handleStartEdit}
            title="کلیک برای ویرایش"
            dir="auto"
            className={`w-full text-start text-sm leading-relaxed transition-colors hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${
              item.isDone
                ? "text-slate-500 line-through"
                : "text-slate-300"
            }`}
          >
            {item.text}
          </button>
        )}
      </div>

      {/* Delete */}
      {!isEditing && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={removeItem.isPending}
          aria-label={`حذف مورد: ${item.text}`}
          title="حذف"
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 disabled:cursor-not-allowed"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
