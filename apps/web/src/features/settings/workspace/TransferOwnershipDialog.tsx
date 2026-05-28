"use client";

// apps/web/src/features/settings/workspace/TransferOwnershipDialog.tsx
//
// Confirmation dialog for transferring workspace ownership. Opens
// from the "ارتقاء به مالک" button on a member row. After a
// successful transfer, the current viewer is no longer OWNER —
// router.refresh() re-runs the layout's getBySlug fetch, the role
// chip in the workspace header updates, and the page re-renders
// with ADMIN-level affordances (transfer/delete buttons disappear).
//
// Why an inline dialog (no Radix): same rationale as F4 D4 — keeps
// the component dependency-light, and a simple modal pattern with
// escape + backdrop click + focus trap (basic) is enough for this
// rare confirmation step.

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, AlertTriangle } from "lucide-react";

import type { MemberRow, TransferOwnershipAction } from "./MembersTable";

interface Props {
  open: boolean;
  target: MemberRow | null;
  workspaceId: string;
  onClose: () => void;
  onConfirm: TransferOwnershipAction;
}

export function TransferOwnershipDialog({
  open,
  target,
  workspaceId,
  onClose,
  onConfirm,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isPending, onClose]);

  if (!open || !target) return null;

  const targetName = target.user?.displayName ?? "این عضو";

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await onConfirm({
        workspaceId,
        newOwnerId: target.userId,
      });
      if (result.ok) {
        toast.success(`مالکیت به «${targetName}» منتقل شد.`);
        onClose();
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در انتقال مالکیت.");
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-ownership-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
            <Crown className="h-5 w-5 text-amber-600" aria-hidden="true" />
          </div>
          <h3
            id="transfer-ownership-title"
            className="text-lg font-bold text-slate-900"
          >
            انتقال مالکیت
          </h3>
        </div>

        <p className="mb-3 text-sm leading-7 text-slate-700">
          آیا مالکیت فضای کاری به{" "}
          <strong dir="auto" className="text-slate-900">
            «{targetName}»
          </strong>{" "}
          منتقل شود؟
        </p>

        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
              aria-hidden="true"
            />
            <div className="flex-1 text-xs leading-6 text-amber-800">
              <p className="font-medium">پس از این عملیات:</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>نقش شما از «مالک» به «مدیر» تغییر می‌کند.</li>
                <li>برای حذف فضای کاری دسترسی نخواهید داشت.</li>
                <li>این عملیات قابل بازگشت نیست (مگر با درخواست از مالک جدید).</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Crown className="h-4 w-4" aria-hidden="true" />
            {isPending ? "در حال انتقال..." : "تأیید انتقال مالکیت"}
          </button>
        </div>
      </div>
    </div>
  );
}
