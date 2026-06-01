"use client";

// apps/web/src/components/checklists/AddChecklistButton.tsx
//
// "+ افزودن چک‌لیست" CTA on the card-detail surface. Two states:
//
//   Resting → a flat outlined button with a Plus icon.
//   Open    → an inline form (NOT a separate dialog) with a single
//             text input + Persian "ایجاد" / "انصراف" buttons.
//
// Why an inline form (instead of a dialog)
//   The Master Contract said "dialog ساده", but inline keeps the
//   user in the card-detail context — they can see existing
//   checklists while choosing the new title, which avoids
//   duplicate-naming friction. This is the same UX as Trello and
//   matches the F1.2.3.a steering doc's "primary surface" guidance.
//   If you need a true modal later, swap the inline JSX for a
//   <Dialog> wrapper without changing the API.
//
// Behaviour
//   • Open state auto-focuses the input.
//   • Enter / Submit button → onCreate(title) (caller trims).
//   • Esc / Cancel → close + clear.
//   • Empty after trim → silent no-op.
//   • Length limit 100 mirrors the server cap (F1.2.3.a D7).
//   • Hidden entirely when canEdit=false (viewer tier).

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

const TITLE_MAX_LENGTH = 100;

interface Props {
  /** Submitted title, already trimmed. Caller invokes the
      useCreateChecklist hook + handles optimistic flow. */
  onCreate:     (title: string) => void;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  /** Whether the viewer can create checklists (member ✓; viewer ✗). */
  canEdit:       boolean;
  /** Existing checklist titles on this card — used for client-side
      duplicate detection so the user catches the conflict before
      the round-trip. Pre-lower-cased via toLocaleLowerCase("fa-IR")
      by the caller. */
  existingTitlesLower: readonly string[];
}

export function AddChecklistButton({
  onCreate,
  isSubmitting = false,
  errorMessage = null,
  canEdit,
  existingTitlesLower,
}: Props) {
  const [isOpen, setOpen]         = useState(false);
  const [title, setTitle]         = useState("");
  const [error, setError]         = useState<string | null>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (errorMessage) setError(errorMessage);
  }, [errorMessage]);

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (isSubmitting || !canEdit) return;
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > TITLE_MAX_LENGTH) {
      setError("عنوان چک‌لیست نباید از ۱۰۰ نویسه بیشتر باشد.");
      return;
    }
    const lowerCandidate = trimmed.toLocaleLowerCase("fa-IR");
    if (existingTitlesLower.includes(lowerCandidate)) {
      setError("این عنوان چک‌لیست قبلاً در این کارت وجود دارد.");
      return;
    }
    onCreate(trimmed);
    setTitle("");
    setError(null);
    setOpen(false);
  }

  function handleCancel() {
    setTitle("");
    setError(null);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancel();
    }
    // Enter handled via form submit.
  }

  if (!canEdit) return null;

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>افزودن چک‌لیست</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3"
    >
      <label
        htmlFor="add-checklist-title"
        className="block text-xs font-medium text-slate-700"
      >
        عنوان چک‌لیست
      </label>
      <input
        ref={inputRef}
        id="add-checklist-title"
        type="text"
        dir="auto"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="مثلاً: موارد پذیرش"
        autoComplete="off"
        spellCheck={false}
        maxLength={TITLE_MAX_LENGTH + 4}
        disabled={isSubmitting}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? "add-checklist-title-error" : undefined}
        className="block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
      />

      {error ? (
        <p
          id="add-checklist-title-error"
          role="alert"
          className="text-xs text-red-600"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting || title.trim().length === 0}
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "در حال ایجاد..." : "ایجاد"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          انصراف
        </button>
      </div>
    </form>
  );
}
