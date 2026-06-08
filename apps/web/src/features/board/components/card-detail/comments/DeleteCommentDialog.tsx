"use client";

// apps/web/src/features/board/components/card-detail/comments/DeleteCommentDialog.tsx
//
// Confirmation dialog for deleting a comment.
// NO type-name-to-confirm (body is too long and free-form — D-UI-1).
// Instead: preview of first 100 chars + two buttons.
//
// Closes on Esc / backdrop / X.
// Submit disabled while in-flight.

import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  open:         boolean;
  commentBody:  string;
  isSubmitting?: boolean;
  onClose:      () => void;
  onConfirm:    () => void;
}

export function DeleteCommentDialog({
  open,
  commentBody,
  isSubmitting = false,
  onClose,
  onConfirm,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button when the dialog opens
  useEffect(() => {
    if (open) {
      queueMicrotask(() => confirmRef.current?.focus());
    }
  }, [open]);

  // Close on Escape
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

  const preview = commentBody.length > 100
    ? `${commentBody.slice(0, 100)}…`
    : commentBody;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-comment-title"
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" />
            </div>
            <h3 id="delete-comment-title" className="text-base font-bold text-slate-900">
              حذف کامنت
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="بستن"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Preview */}
        <p className="mb-3 text-sm text-slate-700">
          این کامنت حذف خواهد شد:
        </p>
        <blockquote className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm italic text-slate-600 line-clamp-3">
          {preview}
        </blockquote>

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            انصراف
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "در حال حذف..." : "حذف کامنت"}
          </button>
        </div>
      </div>
    </div>
  );
}
