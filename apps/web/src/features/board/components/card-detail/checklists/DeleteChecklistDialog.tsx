"use client";

// apps/web/src/features/board/components/card-detail/checklists/DeleteChecklistDialog.tsx
//
// Type-name-to-confirm dialog for deleting a checklist.
// Mirrors DeleteLabelDialog from features/labels/components/.
//
// UX contract:
//   • Persian warning shows affectedItemCount so the user sees impact.
//   • Name match is case-insensitive Persian fold + trim.
//   • Submit disabled until typed value matches.
//   • Closes on Escape / backdrop / X (guarded when submitting).
//   • Owns NO mutation call — parent passes onConfirm.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  open:               boolean;
  checklist:          { id: string; title: string };
  affectedItemCount:  number;
  isSubmitting?:      boolean;
  errorMessage?:      string | null;
  onClose:            () => void;
  onConfirm:          () => void;
}

export function DeleteChecklistDialog({
  open,
  checklist,
  affectedItemCount,
  isSubmitting = false,
  errorMessage = null,
  onClose,
  onConfirm,
}: Props) {
  const [typed, setTyped]   = useState("");
  const inputRef            = useRef<HTMLInputElement>(null);

  // Focus input on open; reset typed on close.
  useEffect(() => {
    if (open) {
      queueMicrotask(() => inputRef.current?.focus());
    } else {
      setTyped("");
    }
  }, [open]);

  // Close on Escape (guard while submitting).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSubmitting) {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isSubmitting, onClose]);

  if (!open) return null;

  // Persian case-insensitive fold + trim.
  const matches =
    typed.trim().toLocaleLowerCase("fa-IR") ===
    checklist.title.trim().toLocaleLowerCase("fa-IR");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!matches || isSubmitting) return;
    onConfirm();
  }

  // Persian numerals for item count.
  const countFa = affectedItemCount.toLocaleString("fa-IR");

  const usageMessage =
    affectedItemCount === 0
      ? "این چک‌لیست در حال حاضر هیچ موردی ندارد."
      : `این چک‌لیست ${countFa} مورد دارد. با حذف، همه‌ی موارد نیز حذف می‌شوند.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-checklist-title"
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
            </div>
            <h3
              id="delete-checklist-title"
              className="text-lg font-bold text-slate-900"
            >
              حذف چک‌لیست
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
          چک‌لیست{" "}
          <strong dir="auto" className="text-slate-900">«{checklist.title}»</strong>{" "}
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
              htmlFor="delete-checklist-confirm-input"
              className="mb-1.5 block text-sm font-medium text-slate-900"
            >
              برای تأیید، عنوان چک‌لیست را تایپ کنید:
            </label>
            <p
              dir="auto"
              className="mb-2 select-all rounded-md border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-mono text-slate-700"
            >
              {checklist.title}
            </p>
            <input
              id="delete-checklist-confirm-input"
              ref={inputRef}
              type="text"
              dir="auto"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
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
              {isSubmitting ? "در حال حذف..." : "حذف چک‌لیست"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
