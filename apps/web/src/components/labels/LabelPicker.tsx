"use client";

// apps/web/src/components/labels/LabelPicker.tsx
//
// The popover surface for applying / removing labels on a card. Pure
// presentational — parent (e.g. CardLabels in features/board) owns
// the mutation hooks and passes:
//
//   labels       — every live label on the board, sorted by position.
//   cardLabelIds — Set of labelIds currently applied to the active card.
//   isApplying   — true while any apply/remove is in flight.
//   isCreating   — true while a create-label call is in flight.
//   createError  — Persian error from the parent's last create attempt.
//   on{Apply, Remove, Create, Close} — interaction callbacks.
//
// Layout / behaviour:
//   • D16: 320px desktop, full-width-minus-margin on mobile.
//   • D17: positioning is the parent's job (this component renders the
//     content; the parent wraps it in an absolute / fixed container
//     anchored to the trigger). The picker's outer div is just a
//     styled card with no layout assumptions.
//   • D9 + L10: search filter is case-insensitive with the fa-IR locale
//     fold so "BUG" matches "bug" and "بَرنامه" matches "برنامه".
//   • D11: ↑/↓ navigate the filtered list, Enter toggles the focused
//     item, Esc closes. The currently-focused item gets a tabIndex=0
//     ring so the parent's wrapper doesn't steal Tab cycles.
//   • D12: empty state has a "+ ساخت برچسب جدید" CTA that toggles to
//     the embedded CreateLabelForm. A second empty state covers the
//     "search has no matches" case with a Persian distinct message.
//   • Outside click closes — the picker registers a window mousedown
//     listener and bails when the event target is outside its root.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";

import type { ColorToken } from "@repo/domain";

import { LabelBadge } from "./LabelBadge";
import { CreateLabelForm } from "./CreateLabelForm";

export interface LabelPickerLabel {
  id:         string;
  name:       string;
  colorToken: string;
  position:   string;
}

interface Props {
  labels:        readonly LabelPickerLabel[];
  cardLabelIds:  ReadonlySet<string>;
  isApplying?:   boolean;
  isCreating?:   boolean;
  createError?:  string | null;
  onApply:       (labelId: string) => void;
  onRemove:      (labelId: string) => void;
  onCreate:      (values: { name: string; colorToken: ColorToken }) => void;
  onClose:       () => void;
}

export function LabelPicker({
  labels,
  cardLabelIds,
  isApplying = false,
  isCreating = false,
  createError = null,
  onApply,
  onRemove,
  onCreate,
  onClose,
}: Props) {
  const [query, setQuery]           = useState("");
  const [isCreateMode, setCreateMode] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the search input on mount.
  useEffect(() => {
    queueMicrotask(() => searchRef.current?.focus());
  }, []);

  // Outside click + Escape both close. We use mousedown (not click)
  // so the listener fires before any inner button's click handler,
  // matching the F5b drawer convention.
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Persian-aware case-insensitive filter. `q` is empty → return all.
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("fa-IR");
    if (q.length === 0) return labels;
    return labels.filter((label) =>
      label.name.toLocaleLowerCase("fa-IR").includes(q),
    );
  }, [labels, query]);

  // Reset focused index when the filtered set changes.
  useEffect(() => {
    if (filtered.length === 0) {
      setFocusedIndex(-1);
    } else if (focusedIndex >= filtered.length) {
      setFocusedIndex(filtered.length - 1);
    }
  }, [filtered.length, focusedIndex]);

  function handleListKey(event: React.KeyboardEvent) {
    if (filtered.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedIndex((prev) =>
        prev < 0 ? 0 : (prev + 1) % filtered.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedIndex((prev) =>
        prev <= 0 ? filtered.length - 1 : prev - 1,
      );
    } else if (event.key === "Enter" && focusedIndex >= 0) {
      event.preventDefault();
      const label = filtered[focusedIndex];
      if (label) toggleLabel(label.id);
    }
  }

  function toggleLabel(labelId: string) {
    if (isApplying) return;
    if (cardLabelIds.has(labelId)) {
      onRemove(labelId);
    } else {
      onApply(labelId);
    }
  }

  function handleEnterCreateMode() {
    setCreateMode(true);
    // The form auto-focuses on mount; nothing else to do here.
  }

  function handleCancelCreate() {
    setCreateMode(false);
    queueMicrotask(() => searchRef.current?.focus());
  }

  function handleCreate(values: { name: string; colorToken: ColorToken }) {
    onCreate(values);
    // Optimistically exit create mode — the parent's `isCreating`
    // flag flips back to false on success/failure and the new label
    // shows up via the live event.
    setCreateMode(false);
  }

  // Existing names for the CreateLabelForm's duplicate check.
  const existingNames = useMemo(
    () => labels.map((l) => l.name),
    [labels],
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label="انتخاب برچسب"
      className="
        flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xl
        w-[calc(100vw-2rem)] max-w-sm md:w-80
      "
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {isCreateMode ? "ساخت برچسب جدید" : "برچسب‌ها"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {isCreateMode ? (
          <CreateLabelForm
            existingNames={existingNames}
            isSubmitting={isCreating}
            errorMessage={createError}
            onSubmit={handleCreate}
            onCancel={handleCancelCreate}
          />
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-3">
              <Search
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 start-3"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                type="text"
                dir="auto"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleListKey}
                placeholder="جستجو در برچسب‌ها..."
                aria-label="جستجو در برچسب‌ها"
                autoComplete="off"
                spellCheck={false}
                className="block w-full rounded-md border border-slate-300 ps-9 pe-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            {/* List */}
            {labels.length === 0 ? (
              <EmptyStateNoLabels onCreate={handleEnterCreateMode} />
            ) : filtered.length === 0 ? (
              <EmptyStateNoMatches query={query} />
            ) : (
              <ul
                role="listbox"
                aria-label="فهرست برچسب‌های برد"
                className="max-h-72 space-y-1 overflow-y-auto"
                onKeyDown={handleListKey}
              >
                {filtered.map((label, idx) => {
                  const isApplied = cardLabelIds.has(label.id);
                  const isFocused = idx === focusedIndex;
                  return (
                    <li key={label.id} role="option" aria-selected={isApplied}>
                      <button
                        type="button"
                        onClick={() => toggleLabel(label.id)}
                        onFocus={() => setFocusedIndex(idx)}
                        disabled={isApplying}
                        tabIndex={isFocused ? 0 : -1}
                        className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-start transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed ${
                          isFocused ? "bg-slate-100" : "hover:bg-slate-50"
                        }`}
                      >
                        <LabelBadge
                          name={label.name}
                          colorToken={label.colorToken}
                          size="sm"
                          className="flex-1 justify-start"
                        />
                        <span
                          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                            isApplied
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-300 bg-white"
                          }`}
                          aria-hidden="true"
                        >
                          {isApplied ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Footer — create CTA (hidden in create mode and in the empty-no-labels state) */}
      {!isCreateMode && labels.length > 0 ? (
        <div className="border-t border-slate-200 px-4 py-2.5">
          <button
            type="button"
            onClick={handleEnterCreateMode}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>ساخت برچسب جدید</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty states (D12)
// ─────────────────────────────────────────────────────────────────────────────

function EmptyStateNoLabels({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="space-y-3 py-4 text-center">
      <p className="text-sm text-slate-600">
        هنوز برچسبی روی این برد ساخته نشده.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>ساخت برچسب جدید</span>
      </button>
    </div>
  );
}

function EmptyStateNoMatches({ query }: { query: string }) {
  return (
    <div className="py-4 text-center text-sm text-slate-500">
      نتیجه‌ای برای{" "}
      <span dir="auto" className="font-medium text-slate-700">
        «{query}»
      </span>{" "}
      یافت نشد.
    </div>
  );
}
