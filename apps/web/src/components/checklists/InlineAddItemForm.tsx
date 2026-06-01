"use client";

// apps/web/src/components/checklists/InlineAddItemForm.tsx
//
// "Add an item" affordance at the bottom of a checklist (D14).
// Two states:
//
//   • Resting → a flat "+ افزودن مورد" button.
//   • Open    → a dir="auto" text input with submit / cancel buttons.
//
// Open-state UX (D15)
//   • Auto-focus on open so the user can start typing.
//   • Enter → submit; clear input; keep input focused for batch
//     entry. The modal-style "many items in a row" entry is the
//     dominant flow for acceptance-criteria checklists, so we
//     intentionally don't close after submit.
//   • Esc OR clicking "انصراف" OR blur (with empty input) → close.
//   • Trim before submission. Empty (after trim) is a no-op.
//
// All actions go through the `onSubmit` callback the parent
// supplies. The parent (ChecklistSection) calls
// `useAddChecklistItem.mutate` and handles the optimistic envelope.
//
// No internal state for "submitting" — the parent owns that flag and
// passes it via `isSubmitting` so the input goes disabled while a
// previous addition is in-flight (rare on a fast network, but covers
// the slow-3G case).

import { useEffect, useRef, useState } from "react";
import { Plus, Send, X } from "lucide-react";

const ITEM_TEXT_MAX_LENGTH = 500;

interface Props {
  /** Submitted text, already trimmed. */
  onSubmit:      (text: string) => void;
  /** Whether the parent's mutation is in flight. */
  isSubmitting?: boolean;
  /** Persian server-rejection message (e.g. CONFLICT). */
  errorMessage?: string | null;
  /** Auto-focus the input on initial render (used by empty state — D16). */
  autoOpen?:     boolean;
  /** Whether the viewer can add items (member ✓; viewer ✗). */
  canEdit:       boolean;
}

export function InlineAddItemForm({
  onSubmit,
  isSubmitting = false,
  errorMessage = null,
  autoOpen     = false,
  canEdit,
}: Props) {
  const [isOpen, setOpen]     = useState(autoOpen);
  const [text, setText]       = useState("");
  const [error, setError]     = useState<string | null>(null);
  const inputRef              = useRef<HTMLInputElement>(null);

  // Auto-focus on open. queueMicrotask defers past the render so the
  // input is mounted in the DOM by the time we focus.
  useEffect(() => {
    if (isOpen) {
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Reset to closed state on outer error (e.g. server rejected the
  // last submission and the parent flipped errorMessage). The error
  // text stays visible until the next interaction.
  useEffect(() => {
    if (errorMessage) setError(errorMessage);
  }, [errorMessage]);

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (isSubmitting || !canEdit) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return; // silent no-op
    if (trimmed.length > ITEM_TEXT_MAX_LENGTH) {
      setError("متن مورد نباید از ۵۰۰ نویسه بیشتر باشد.");
      return;
    }
    onSubmit(trimmed);
    setText("");
    setError(null);
    // Keep input focused for batch entry per D15.
    queueMicrotask(() => inputRef.current?.focus());
  }

  function handleCancel() {
    setText("");
    setError(null);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancel();
    }
    // Enter is handled via the form's onSubmit (covers both keyboard
    // submit and clicking the send button).
  }

  if (!canEdit) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-800"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        <span>افزودن مورد</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        ref={inputRef}
        type="text"
        dir="auto"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        // Don't auto-close on blur if user is mid-typing — only close
        // when truly empty AND user has tabbed away. We check `text`
        // at blur time.
        onBlur={() => {
          if (text.trim().length === 0 && !isSubmitting) {
            setOpen(false);
          }
        }}
        placeholder="افزودن یک مورد..."
        autoComplete="off"
        spellCheck={false}
        maxLength={ITEM_TEXT_MAX_LENGTH + 4}
        disabled={isSubmitting}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? "inline-add-item-error" : undefined}
        aria-label="متن مورد جدید"
        className="block w-full rounded-md border border-blue-400 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
      />

      {error ? (
        <p
          id="inline-add-item-error"
          role="alert"
          className="text-[11px] text-red-600"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting || text.trim().length === 0}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send className="h-3 w-3" aria-hidden="true" />
          <span>{isSubmitting ? "در حال افزودن..." : "افزودن"}</span>
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="انصراف از افزودن مورد"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          <span>انصراف</span>
        </button>
      </div>
    </form>
  );
}
