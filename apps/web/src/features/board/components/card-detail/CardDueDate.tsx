"use client";

// apps/web/src/features/board/components/card-detail/CardDueDate.tsx
//
// Phase 1.2 (F1.2.2) — replaces the F1.2.1-era stub with a Jalali-aware
// due-date picker.
//
// Anti-patterns the stub had (now fixed)
//   • Used `new Date()` + `toLocaleDateString()` (Gregorian) for display.
//   • Used `<input type="datetime-local">` which forces Gregorian input
//     and exposes the browser's locale-dependent picker. The new
//     picker is a plain text input with a Jalali placeholder
//     ("1404/01/15") parsed via `fromJalaliInput` from the time engine.
//   • Called `trpc.v1.public.dueDate.set` directly (no idempotency,
//     no realtime store update).
//
// New picker
//   • Reads the card's current due date from the local Zustand store
//     (the realtime patch loop keeps it in sync; no extra tRPC fetch
//     needed when the card is already loaded by the modal).
//   • Editing mode: text input (dir="auto") with Persian placeholder.
//     Enter saves; Escape cancels. The clear button (X icon) sits
//     beside the trigger when a date is currently set.
//   • On save: parse with `fromJalaliInput` (Result type — never
//     throws). On parse failure, surfaces an inline Persian error
//     and keeps the modal open.
//   • On success: optimistic store update via `useUpdateCardDueDate`;
//     server reconciliation happens via the realtime echo within
//     ~50ms.
//   • CardDueDateBadge renders the saved value when not editing
//     (keeps the same colour palette as the card preview).

import { useEffect, useRef, useState } from "react";
import { Calendar, X } from "lucide-react";

import {
  fromJalaliInput,
  getUserTZ,
  toJalaliDisplay,
  type DateOnly,
} from "@/lib/date";

import { CardDueDateBadge } from "@/components/cards/CardDueDateBadge";

import { useBoardStore } from "../../store/useBoardStore";
import { useUpdateCardDueDate } from "../../store/mutations/cards/useUpdateCardDueDate";

interface Props {
  cardId: string;
  boardId: string;
}

export function CardDueDate({ cardId, boardId }: Props) {
  // Store-driven read — the modal already loaded the card; we don't
  // re-fetch via tRPC here.
  const dueDate = useBoardStore(
    (s: any) => (s.cards[cardId]?.dueDate ?? null) as string | null,
  );

  const updateDueDate = useUpdateCardDueDate();

  const [editing, setEditing] = useState(false);
  const [input, setInput]     = useState("");
  const [error, setError]     = useState<string | null>(null);
  const inputRef              = useRef<HTMLInputElement>(null);

  const tz = getUserTZ();

  // Pre-fill the input with the current Jalali representation when the
  // user enters edit mode. Empty when there's no date yet (the user
  // types from scratch).
  function startEdit() {
    const initial = dueDate
      ? toJalaliDisplay(dueDate as DateOnly, tz, "YYYY/MM/DD")
      : "";
    setInput(initial);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  useEffect(() => {
    if (editing) {
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [editing]);

  function handleSave() {
    const trimmed = input.trim();

    // Empty input in edit mode → treat as clear.
    if (trimmed === "") {
      updateDueDate.mutate({
        cardId,
        boardId,
        dueDate:       null,
        correlationId: crypto.randomUUID(),
      });
      setEditing(false);
      return;
    }

    const parsed = fromJalaliInput(trimmed);
    if (!parsed.ok) {
      // Persian error per L10. The picker keeps the modal open so the
      // user can correct without re-typing the rest of the form.
      setError("تاریخ معتبر نیست. مثال: ۱۴۰۴/۰۱/۱۵");
      inputRef.current?.focus();
      return;
    }

    updateDueDate.mutate({
      cardId,
      boardId,
      dueDate:       parsed.value, // already a DateOnly per the time engine
      correlationId: crypto.randomUUID(),
    });
    setEditing(false);
  }

  function handleClear() {
    if (!dueDate) return;
    updateDueDate.mutate({
      cardId,
      boardId,
      dueDate:       null,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
        تاریخ سررسید
      </h3>

      {editing ? (
        <div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              dir="auto"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={handleKeyDown}
              disabled={updateDueDate.isPending}
              autoComplete="off"
              spellCheck={false}
              placeholder="مثال: ۱۴۰۴/۰۱/۱۵"
              aria-invalid={error ? "true" : "false"}
              aria-describedby={error ? "card-due-date-error" : undefined}
              className="block flex-1 rounded-md border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={updateDueDate.isPending}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateDueDate.isPending ? "در حال ذخیره..." : "ذخیره"}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={updateDueDate.isPending}
              className="inline-flex items-center justify-center rounded-md border border-slate-600 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              انصراف
            </button>
          </div>
          {error ? (
            <p
              id="card-due-date-error"
              role="alert"
              className="mt-1.5 text-xs text-red-400"
            >
              {error}
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-slate-500">
              فرمت تاریخ شمسی: YYYY/MM/DD. کلید Enter برای ذخیره، Esc برای
              انصراف. خالی گذاشتن = حذف سررسید.
            </p>
          )}
        </div>
      ) : dueDate ? (
        <div className="flex items-center gap-2">
          <CardDueDateBadge dueDate={dueDate} size="md" />
          <button
            type="button"
            onClick={startEdit}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            ویرایش
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={updateDueDate.isPending}
            aria-label="حذف تاریخ سررسید"
            title="حذف تاریخ سررسید"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-500 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-400 hover:bg-slate-700/50 hover:text-slate-100"
        >
          <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
          <span>افزودن تاریخ سررسید</span>
        </button>
      )}
    </div>
  );
}
