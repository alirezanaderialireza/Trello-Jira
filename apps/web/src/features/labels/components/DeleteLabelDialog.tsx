"use client";

// apps/web/src/features/labels/components/DeleteLabelDialog.tsx
//
// Type-name-to-confirm modal for deleting a label. Mirrors F5a's
// DeleteWorkspaceDialog (D8).
//
// UX contract:
//   • The Persian warning shows `affectedCardCount` so the user knows
//     how many cards lose this label. The count comes from the parent
//     (computed from the local board store — cards.labels[]). Server
//     truth lands in the success response and the parent surfaces it
//     via a follow-up toast.
//   • Name match is case-insensitive (toLocaleLowerCase("fa")) after
//     trimming on both sides, matching the workspace dialog's match.
//   • Submit stays disabled until the typed value matches.
//   • Closes on Escape, backdrop click, or the X button (only when not
//     already submitting — same guard as the workspace dialog).
//   • Owns NO mutation call — parent passes `onConfirm`, the dialog
//     just gates submission. The parent's `useDeleteLabel` hook
//     handles optimistic + rollback + toast.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  open: boolean;
  label: { id: string; name: string };
  affectedCardCount: number;
  isSubmitting?: boolean;
  /** Persian server-rejection message (e.g. role escalation race). */
  errorMessage?: string | null;
  onClose:   () => void;
  onConfirm: () => void;
}

export function DeleteLabelDialog({
  open,
  label,
  affectedCardCount,
  isSubmitting = false,
  errorMessage = null,
  onClose,
  onConfirm,
}: Props) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when the dialog opens; reset typed when closed.
  useEffect(() => {
    if (open) {
      queueMicrotask(() => inputRef.current?.focus());
    } else {
      setTyped("");
    }
  }, [open]);

  // Close on Escape (only when not in flight).
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isSubmitting, onClose]);

  if (!open) return null;

  // Case-insensitive, whitespace-trimmed match — same fold as the
  // workspace dialog. Persian "fa" locale handles letter-form variants.
  const matches =
    typed.trim().toLocaleLowerCase("fa") ===
    label.name.trim().toLocaleLowerCase("fa");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!matches || isSubmitting) return;
    onConfirm();
    // Don't reset `typed` here — the parent decides whether to close
    // (success → close + toast) or keep open (server rejection).
  }

  // Format the count in Persian numerals per Master Contract Rule 1.
  const countFa = affectedCardCount.toLocaleString("fa-IR");

  // Persian copy varies by count for natural readability.
  const usageMessage =
    affectedCardCount === 0
      ? "این برچسب در حال حاضر روی هیچ کارتی اعمال نشده است."
      : `این برچسب در حال حاضر روی ${countFa} کارت اعمال شده است. با حذف، برچسب از همه‌ی این کارت‌ها برداشته می‌شود.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-label-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle
                className="h-5 w-5 text-red-600"
                aria-hidden="true"
              />
            </div>
            <h3
              id="delete-label-title"
              className="text-lg font-bold text-slate-900"
            >
              حذف برچسب
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="بستن"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <p className="mb-3 text-sm leading-7 text-slate-700">
          برچسب{" "}
          <strong dir="auto" className="text-slate-900">
            «{label.name}»
          </strong>{" "}
          حذف خواهد شد.
        </p>

        <div
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800"
          role="status"
        >
          {usageMessage}
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-6 text-red-800"
          >
            {errorMessage}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="delete-label-confirm-input"
              className="mb-1.5 block text-sm font-medium text-slate-900"
            >
              برای تأیید، نام برچسب را تایپ کنید:
            </label>
            <p
              dir="auto"
              className="mb-2 select-all rounded-md border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-mono text-slate-700"
            >
              {label.name}
            </p>
            <input
              id="delete-label-confirm-input"
              ref={inputRef}
              type="text"
              dir="auto"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={isSubmitting}
              autoComplete="off"
              spellCheck={false}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={!matches || isSubmitting}
              className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "در حال حذف..." : "حذف برچسب"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
