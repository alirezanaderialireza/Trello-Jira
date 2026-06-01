"use client";

// apps/web/src/components/checklists/DeleteChecklistDialog.tsx
//
// Light confirm dialog for deleting a checklist (Master Contract D9).
// Unlike F1.2.1.b's DeleteLabelDialog (type-name-to-confirm, used for
// destructive label deletes that propagate across many cards), a
// checklist delete is per-card and the items are hard-deleted in a
// single tx — moderate impact, so a single-click confirm is enough.
//
// The dialog SURFACES the affectedItemCount in Persian numerals so the
// user sees how many items they're about to lose:
//   "این چک‌لیست شامل ۵ مورد است. حذف شود؟"
//
// affectedItemCount comes from the parent (ChecklistSection), which
// computes it locally from `checklist.items.length` — no extra
// round-trip. The server's response also carries the canonical count
// (it's part of the v2 ChecklistDeletedPayload from F1.2.3.a) for
// the post-delete success toast.

import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

import { toPersianNumber } from "@/lib/checklists/persianNumerals";

interface Props {
  open: boolean;
  /** Display purposes only — used in the header copy. */
  title: string;
  /** Local count from `checklist.items.length` at parent's render time. */
  affectedItemCount: number;
  isSubmitting?:    boolean;
  /** Persian server-rejection message (e.g. role escalation race). */
  errorMessage?:    string | null;
  onClose:   () => void;
  onConfirm: () => void;
}

export function DeleteChecklistDialog({
  open,
  title,
  affectedItemCount,
  isSubmitting = false,
  errorMessage = null,
  onClose,
  onConfirm,
}: Props) {
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

  // Persian copy varies by count for natural readability.
  const countFa = toPersianNumber(affectedItemCount);
  const message =
    affectedItemCount === 0
      ? "این چک‌لیست هیچ موردی ندارد. حذف شود؟"
      : `این چک‌لیست شامل ${countFa} مورد است. با حذف، تمام موارد آن نیز حذف می‌شوند.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-checklist-title"
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
          <strong dir="auto" className="text-slate-900">
            «{title}»
          </strong>{" "}
          حذف خواهد شد.
        </p>

        <div
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800"
          role="status"
        >
          {message}
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-6 text-red-800"
          >
            {errorMessage}
          </div>
        ) : null}

        {/* Actions */}
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
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "در حال حذف..." : "حذف چک‌لیست"}
          </button>
        </div>
      </div>
    </div>
  );
}
