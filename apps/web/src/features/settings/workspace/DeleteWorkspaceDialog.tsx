"use client";

// apps/web/src/features/settings/workspace/DeleteWorkspaceDialog.tsx
//
// Type-name-to-confirm modal for soft-deleting the workspace.
//
// UX contract (D7): comparison is case-insensitive after trimming
// whitespace. The user types the workspace name into a free-text
// input; the submit button stays disabled until the typed value
// matches the workspace's display name. Visual hint shows the
// expected name verbatim (in a code-style block so RTL / LTR mixing
// reads correctly).
//
// On submit:
//   • Closes the dialog (parent handles the success toast + grace
//     window + redirect — we only own the input + confirmation).
//   • Reports success/failure to the parent via the onConfirm prop's
//     resolved value so the parent can branch into the toast UX.
//
// No Radix dep — see F4 D4. Closes on Escape, backdrop click, or
// the X button.

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, X } from "lucide-react";

export type SoftDeleteResult = { ok: boolean; error?: string };

export type SoftDeleteAction = (input: {
  workspaceId: string;
}) => Promise<SoftDeleteResult>;

interface Props {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  onConfirm: SoftDeleteAction;
  /** Called with the action result so the parent can show toast / redirect. */
  onResult: (result: SoftDeleteResult) => void;
}

export function DeleteWorkspaceDialog({
  open,
  workspaceId,
  workspaceName,
  onClose,
  onConfirm,
  onResult,
}: Props) {
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when the dialog opens. Reset typed when closed.
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isPending, onClose]);

  if (!open) return null;

  // Case-insensitive, whitespace-trimmed match.
  const matches =
    typed.trim().toLocaleLowerCase("fa") ===
    workspaceName.trim().toLocaleLowerCase("fa");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!matches || isPending) return;
    startTransition(async () => {
      const result = await onConfirm({ workspaceId });
      // Defer to the parent — it knows whether to redirect, toast,
      // or show the grace-window action.
      onResult(result);
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-workspace-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle
                className="h-5 w-5 text-red-600"
                aria-hidden="true"
              />
            </div>
            <h3
              id="delete-workspace-title"
              className="text-lg font-bold text-slate-900"
            >
              حذف فضای کاری
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="بستن"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-3 text-sm leading-7 text-slate-700">
          این عملیات تمام بوردها، اعضا و دعوت‌های فضای کاری{" "}
          <strong dir="auto" className="text-slate-900">
            «{workspaceName}»
          </strong>{" "}
          را حذف می‌کند.
        </p>

        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-6 text-red-800">
          فضای کاری به‌صورت موقت بایگانی می‌شود. تا ۳۰ روز فرصت بازگردانی دارید
          و پس از آن داده‌ها به‌طور دائمی حذف خواهند شد.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="delete-workspace-confirm-input"
              className="mb-1.5 block text-sm font-medium text-slate-900"
            >
              برای تأیید، نام فضای کاری را تایپ کنید:
            </label>
            <p
              dir="auto"
              className="mb-2 select-all rounded-md border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-mono text-slate-700"
            >
              {workspaceName}
            </p>
            <input
              id="delete-workspace-confirm-input"
              ref={inputRef}
              type="text"
              dir="auto"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={isPending}
              autoComplete="off"
              spellCheck={false}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={!matches || isPending}
              className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "در حال حذف..." : "حذف فضای کاری"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
