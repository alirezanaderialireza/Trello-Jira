"use client";

// apps/web/src/components/ui/ConfirmDialog.tsx
//
// Phase 1.4 (F1.4.4) — shared, accessible confirmation dialog.
//
// Replaces the raw window.confirm() calls scattered across the app
// (board delete/archive/member-remove, workspace leave/member-remove,
// invitation revoke). The repo intentionally has NO Radix dependency —
// every dialog (DeleteWorkspaceDialog, DeleteChecklistDialog, …) is
// hand-built — so this primitive follows the same bespoke pattern and
// the Esc / outside-click contract used by NotificationsBell.
//
// a11y contract:
//   • role="alertdialog" + aria-modal, labelled by the title and
//     described by the optional description.
//   • Initial focus lands on the Cancel button (safer than Confirm,
//     especially for destructive actions).
//   • Tab / Shift+Tab are trapped within the dialog.
//   • Escape and a backdrop click both invoke onCancel — NEVER
//     onConfirm. Destructive confirmation must always be deliberate.
//   • On close, focus is restored to whatever element opened the
//     dialog (captured on open).
//   • While `isPending`, both buttons are disabled and the confirm
//     label switches to a progress string.

import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "تأیید",
  cancelLabel = "انصراف",
  variant = "default",
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Element focused before the dialog opened — restored on close.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Focus the safe default (Cancel) once mounted.
    queueMicrotask(() => cancelRef.current?.focus());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;

      // Focus trap — keep Tab cycling inside the dialog.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger when the dialog unmounts/closes.
      previouslyFocused.current?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  const titleId = "confirm-dialog-title";
  const descId = description ? "confirm-dialog-desc" : undefined;

  const confirmClasses =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-500"
      : "bg-blue-600 hover:bg-blue-500";

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4"
      onMouseDown={(e) => {
        // Backdrop click cancels (never confirms). Guard against drags
        // that start inside the panel by only acting on the backdrop itself.
        if (e.target === e.currentTarget && !isPending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-lg font-bold text-slate-900">
          {title}
        </h3>

        {description ? (
          <p
            id={descId}
            dir="auto"
            className="mt-3 text-sm leading-7 text-slate-700"
          >
            {description}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${confirmClasses}`}
          >
            {isPending ? "در حال انجام..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
