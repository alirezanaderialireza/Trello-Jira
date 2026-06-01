"use client";

// apps/web/src/components/checklists/ChecklistHeader.tsx
//
// Header strip for one checklist. Three layout zones:
//
//   [drag handle]  [title (inline-editable D8)]  [progress bar]  [actions ⋯]
//
// The progress bar is a separate (smaller) presentational component
// (commit 2 ChecklistProgressBar). The actions menu is the dropdown
// per D9 — only the delete action lives there for now; future
// "duplicate / archive" items can land in the same place.
//
// Inline title edit (D8 mirrors D7 from item rows)
//   • Click title → input + select-all.
//   • Enter / blur → commit (validate + onUpdateTitle).
//   • Esc → revert.
//   • Drag handle is gated `disabled` while editing so an accidental
//     click-drag doesn't kick the row out.
//
// Dropdown (D9)
//   • role="menu" with role="menuitem" buttons.
//   • Closes on Esc, outside click, or click on a menu item.
//   • Future: could add "duplicate" / "archive" here.

import { useEffect, useRef, useState } from "react";
import { GripVertical, MoreHorizontal, Trash2 } from "lucide-react";

import {
  ChecklistProgressBar,
} from "./ChecklistProgressBar";

const TITLE_MAX_LENGTH = 100;

interface Props {
  title: string;
  /** Pre-computed by the parent via `computeProgress`. */
  progress: { done: number; total: number; percent: number };
  /** Whether the viewer can edit the title / open the actions menu. */
  canEdit: boolean;
  /** Drag handle wiring from the parent's useSortable. */
  dragAttributes?: Record<string, unknown>;
  dragListeners?:  Record<string, unknown>;
  isDragging?:    boolean;
  /** Disables the drag handle (e.g. while editing the title). */
  isDragDisabled?: boolean;
  /** Commit a new (already-trimmed) title. Caller validates duplicates. */
  onUpdateTitle:  (newTitle: string) => void;
  /** Open the delete dialog (parent owns the dialog state). */
  onRequestDelete: () => void;
}

export function ChecklistHeader({
  title,
  progress,
  canEdit,
  dragAttributes,
  dragListeners,
  isDragging = false,
  isDragDisabled = false,
  onUpdateTitle,
  onRequestDelete,
}: Props) {
  const [isEditing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const menuRef     = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  // Reconcile incoming title with local draft when not editing.
  useEffect(() => {
    if (!isEditing) {
      setDraftTitle(title);
    }
  }, [title, isEditing]);

  // Auto-focus + select-all on edit.
  useEffect(() => {
    if (isEditing) {
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  // Close menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(event: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      if (menuTriggerRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function commitDraft() {
    if (!canEdit) return;
    const trimmed = draftTitle.trim();
    if (trimmed.length === 0) {
      // Empty after trim → revert.
      setDraftTitle(title);
      setEditing(false);
      setError(null);
      return;
    }
    if (trimmed.length > TITLE_MAX_LENGTH) {
      setError("عنوان چک‌لیست نباید از ۱۰۰ نویسه بیشتر باشد.");
      inputRef.current?.focus();
      return;
    }
    if (trimmed !== title) {
      onUpdateTitle(trimmed);
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
      setDraftTitle(title);
      setEditing(false);
      setError(null);
    }
  }

  function handleDeleteFromMenu() {
    setMenuOpen(false);
    onRequestDelete();
  }

  return (
    <div className="space-y-1">
      <div
        className={`flex items-start gap-2 transition-colors ${
          isDragging ? "opacity-70" : ""
        }`}
      >
        {/* Drag handle */}
        {canEdit ? (
          <button
            type="button"
            aria-label={`جابجایی چک‌لیست ${title}`}
            title="جابجایی چک‌لیست"
            disabled={isDragDisabled}
            {...dragAttributes}
            {...dragListeners}
            className="mt-1 flex h-6 w-6 flex-shrink-0 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span aria-hidden="true" className="h-6 w-6 flex-shrink-0" />
        )}

        {/* Title — view / edit */}
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div>
              <input
                ref={inputRef}
                type="text"
                dir="auto"
                value={draftTitle}
                onChange={(event) => {
                  setDraftTitle(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={handleKeyDown}
                onBlur={commitDraft}
                maxLength={TITLE_MAX_LENGTH + 4}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? "true" : "false"}
                className="block w-full rounded border border-blue-400 bg-white px-2 py-1 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
              className={`block w-full rounded px-2 py-1 text-start text-sm font-semibold text-slate-800 transition-colors ${
                canEdit
                  ? "cursor-text hover:bg-slate-100"
                  : "cursor-default"
              }`}
            >
              {title}
            </button>
          )}
        </div>

        {/* Actions menu */}
        {canEdit ? (
          <div className="relative flex-shrink-0">
            <button
              type="button"
              ref={menuTriggerRef}
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`گزینه‌های چک‌لیست ${title}`}
              title="گزینه‌ها"
              className="mt-1 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div
                ref={menuRef}
                role="menu"
                aria-label="گزینه‌های چک‌لیست"
                className="absolute end-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleDeleteFromMenu}
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>حذف چک‌لیست</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Progress bar — sits below title on its own row, indented past
          the drag handle width so it aligns with the title text. */}
      <div className="ps-8">
        <ChecklistProgressBar
          done={progress.done}
          total={progress.total}
          percent={progress.percent}
        />
      </div>
    </div>
  );
}
