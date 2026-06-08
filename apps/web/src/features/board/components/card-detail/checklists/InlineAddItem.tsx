"use client";

// apps/web/src/features/board/components/card-detail/checklists/InlineAddItem.tsx
//
// Small form at the bottom of each checklist for adding new items.
// Pattern: Enter or blur → save, input clears but focus stays (Trello
// style so the user can type multiple items in quick succession).
// Validation: non-empty + max 500 chars (matches server TitleSchema).

import { useRef, useState } from "react";
import { useAddChecklistItem } from "../../../store/mutations/checklists/useAddChecklistItem";

interface Props {
  checklistId: string;
  cardId:      string;
  boardId:     string;
}

export function InlineAddItem({ checklistId, cardId, boardId }: Props) {
  const [text, setText]       = useState("");
  const [error, setError]     = useState<string | null>(null);
  const inputRef              = useRef<HTMLInputElement>(null);
  const addItem               = useAddChecklistItem();

  function validate(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed)         return "متن مورد نمی‌تواند خالی باشد.";
    if (trimmed.length > 500) return "متن مورد نباید از ۵۰۰ نویسه بیشتر باشد.";
    return null;
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    const err = validate(text);
    if (err) {
      if (!trimmed) return; // silent fail on empty blur
      setError(err);
      return;
    }
    setError(null);
    addItem.mutate({
      checklistId,
      cardId,
      boardId,
      text:          trimmed,
      correlationId: crypto.randomUUID(),
    });
    // Clear text but keep focus so the user can add more items.
    setText("");
    queueMicrotask(() => inputRef.current?.focus());
  }

  function handleBlur() {
    // Save on blur only if there's actual content.
    if (text.trim()) handleSubmit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  { e.preventDefault(); handleSubmit(); }
    if (e.key === "Escape") { e.preventDefault(); setText(""); setError(null); }
  }

  return (
    <div className="mt-2 px-2" dir="rtl">
      <form onSubmit={handleSubmit} noValidate>
        <input
          ref={inputRef}
          type="text"
          dir="auto"
          value={text}
          onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          maxLength={500}
          placeholder="افزودن مورد..."
          aria-label="افزودن مورد جدید به چک‌لیست"
          disabled={addItem.isPending}
          className={`w-full rounded-md border px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 bg-slate-700/50 outline-none transition-colors focus:bg-slate-700 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
            error
              ? "border-red-500 focus:ring-red-500/30"
              : "border-slate-600 focus:border-blue-500 focus:ring-blue-500/30"
          }`}
        />
        {error ? (
          <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>
        ) : null}
      </form>
    </div>
  );
}
