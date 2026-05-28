"use client";

// apps/web/src/app/board/[boardId]/_components/DangerTab.tsx
//
// Three panels gated by both lifecycle state and role:
//
//   1. Archive panel
//      • Visible when archivedAt === null.
//      • OWNER + ADMIN can archive. On success a sonner toast is
//        shown for 10 seconds with a "بازگردانی" action button
//        that calls onUnarchive.
//
//   2. Unarchive panel
//      • Visible when archivedAt !== null.
//      • OWNER + ADMIN can restore. Soft-deleted boards never
//        reach this drawer (the procedure returns NOT_FOUND), so
//        we never mix archive + delete UX in the same render.
//
//   3. Delete panel
//      • Visible only after archive (archivedAt !== null) AND only
//        for OWNER. Type-title-to-confirm dialog (D7 case-
//        insensitive Persian collation).
//      • On successful delete the parent drawer is closed (via
//        onCloseDrawer) and the user is bounced off the board page
//        with router.push('/workspaces').
//
// The 10-second grace toast (D4) for archive matches the F5a
// soft-delete pattern: sonner.toast with action button +
// duration: 10_000.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, AlertTriangle, Trash2, X } from "lucide-react";

import type { ActionResult } from "../_actions/_helpers";

interface Props {
  boardId: string;
  title: string;
  archivedAt: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  onArchive: (input: { boardId: string }) => Promise<ActionResult>;
  onUnarchive: (input: { boardId: string }) => Promise<ActionResult>;
  onDelete: (input: { boardId: string }) => Promise<ActionResult>;
  onCloseDrawer: () => void;
}

const GRACE_WINDOW_MS = 10_000;

export function DangerTab({
  boardId,
  title,
  archivedAt,
  role,
  onArchive,
  onUnarchive,
  onDelete,
  onCloseDrawer,
}: Props) {
  const router = useRouter();
  const isArchived = archivedAt !== null;
  const isOwner = role === "OWNER";
  const canModerate = role === "OWNER" || role === "ADMIN";

  const [isArchiving, startArchive] = useTransition();
  const [isUnarchiving, startUnarchive] = useTransition();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // ── Archive ───────────────────────────────────────────────────────────────
  const handleArchive = () => {
    if (!canModerate) return;
    if (
      !window.confirm(`آیا می‌خواهید بورد «${title}» را بایگانی کنید؟`)
    ) {
      return;
    }
    startArchive(async () => {
      const result = await onArchive({ boardId });
      if (!result.ok) {
        toast.error(result.error ?? "خطا در بایگانی بورد.");
        return;
      }
      toast(`بورد «${title}» بایگانی شد.`, {
        duration: GRACE_WINDOW_MS,
        action: {
          label: "بازگردانی",
          onClick: async () => {
            const restoreResult = await onUnarchive({ boardId });
            if (restoreResult.ok) {
              toast.success(`بورد «${title}» بازگردانی شد.`);
              router.refresh();
            } else {
              toast.error(restoreResult.error ?? "خطا در بازگردانی.");
            }
          },
        },
      });
      // Refresh the drawer so the panel switches to the unarchive
      // path, but keep the drawer open so the user can use the
      // toast's "بازگردانی" or close manually.
      router.refresh();
    });
  };

  // ── Unarchive ─────────────────────────────────────────────────────────────
  const handleUnarchive = () => {
    if (!canModerate) return;
    startUnarchive(async () => {
      const result = await onUnarchive({ boardId });
      if (result.ok) {
        toast.success(`بورد «${title}» از بایگانی خارج شد.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در خروج از بایگانی.");
      }
    });
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDeleteResult = (result: ActionResult) => {
    setDeleteDialogOpen(false);
    if (!result.ok) {
      toast.error(result.error ?? "خطا در حذف بورد.");
      return;
    }
    toast.success(`بورد «${title}» حذف شد.`);
    onCloseDrawer();
    router.push("/workspaces");
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Archive / Unarchive panel */}
      {!isArchived ? (
        <DangerPanel
          icon={<Archive className="h-5 w-5" aria-hidden="true" />}
          title="بایگانی بورد"
          description="بورد بایگانی‌شده در سایدبار پنهان می‌شود ولی داده‌های آن حفظ می‌شود. هر زمان می‌توانید آن را برگردانید."
          action={
            canModerate && (
              <button
                type="button"
                onClick={handleArchive}
                disabled={isArchiving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                {isArchiving ? "در حال بایگانی..." : "بایگانی"}
              </button>
            )
          }
        />
      ) : (
        <DangerPanel
          variant="amber"
          icon={<ArchiveRestore className="h-5 w-5" aria-hidden="true" />}
          title="این بورد بایگانی شده"
          description="بورد بایگانی‌شده فقط از این صفحه قابل بازگردانی است. هیچ عضوی اعلان جدیدی برای آن دریافت نمی‌کند."
          action={
            canModerate && (
              <button
                type="button"
                onClick={handleUnarchive}
                disabled={isUnarchiving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                {isUnarchiving ? "در حال بازگردانی..." : "خروج از بایگانی"}
              </button>
            )
          }
        />
      )}

      {/* Delete panel — visible only after archive AND only for OWNER */}
      {isArchived && isOwner && (
        <DangerPanel
          variant="red"
          icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
          title="حذف بورد"
          description="بورد به‌صورت موقت بایگانی می‌شود و داده‌ها برای ۳۰ روز حفظ می‌شوند. پس از آن، تمام محتویات به‌طور دائمی حذف خواهد شد."
          action={
            <button
              type="button"
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              حذف بورد...
            </button>
          }
        />
      )}

      {isArchived && !isOwner && (
        <DangerPanel
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="حذف بورد"
          description="حذف بورد فقط توسط مالک امکان‌پذیر است."
          muted
        />
      )}

      {!canModerate && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
          فقط مدیران و مالک بورد می‌توانند عملیات حساس را انجام دهند.
        </p>
      )}

      <DeleteBoardDialog
        open={deleteDialogOpen}
        boardId={boardId}
        boardTitle={title}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={onDelete}
        onResult={handleDeleteResult}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function DangerPanel({
  icon,
  title,
  description,
  action,
  variant,
  muted,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  variant?: "red" | "amber";
  muted?: boolean;
}) {
  const palette =
    variant === "red"
      ? {
          border: "border-red-200",
          bg: "bg-red-50",
          icon: "text-red-600",
          title: "text-red-900",
          body: "text-red-800",
        }
      : variant === "amber"
        ? {
            border: "border-amber-200",
            bg: "bg-amber-50",
            icon: "text-amber-600",
            title: "text-amber-900",
            body: "text-amber-800",
          }
        : muted
          ? {
              border: "border-slate-200",
              bg: "bg-slate-50",
              icon: "text-slate-400",
              title: "text-slate-700",
              body: "text-slate-500",
            }
          : {
              border: "border-slate-200",
              bg: "bg-white",
              icon: "text-slate-500",
              title: "text-slate-900",
              body: "text-slate-600",
            };

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border ${palette.border} ${palette.bg} p-4`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${palette.icon}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${palette.title}`}>{title}</p>
          <p className={`mt-1 text-xs leading-6 ${palette.body}`}>{description}</p>
        </div>
      </div>
      {action && <div className="flex justify-end">{action}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete confirmation dialog (type-title-to-confirm)
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors the F5a DeleteWorkspaceDialog pattern: case-insensitive
// Persian-collation match between the typed value and the board
// title. Submit stays disabled until the values match.

function DeleteBoardDialog({
  open,
  boardId,
  boardTitle,
  onClose,
  onConfirm,
  onResult,
}: {
  open: boolean;
  boardId: string;
  boardTitle: string;
  onClose: () => void;
  onConfirm: (input: { boardId: string }) => Promise<ActionResult>;
  onResult: (result: ActionResult) => void;
}) {
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!open) return null;

  const matches =
    typed.trim().toLocaleLowerCase("fa") ===
    boardTitle.trim().toLocaleLowerCase("fa");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!matches || isPending) return;
    startTransition(async () => {
      const result = await onConfirm({ boardId });
      onResult(result);
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-board-dialog-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle
                className="h-5 w-5 text-red-600"
                aria-hidden="true"
              />
            </div>
            <h3
              id="delete-board-dialog-title"
              className="text-lg font-bold text-slate-900"
            >
              حذف بورد
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="بستن"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-3 text-sm leading-7 text-slate-700">
          این عملیات تمام لیست‌ها، کارت‌ها، چک‌لیست‌ها و کامنت‌های بورد{" "}
          <strong dir="auto" className="text-slate-900">
            «{boardTitle}»
          </strong>{" "}
          را حذف می‌کند.
        </p>

        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-6 text-red-800">
          بورد به‌مدت ۳۰ روز قابل بازیابی است. پس از آن، داده‌ها به‌طور دائمی حذف
          می‌شوند.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="delete-board-confirm-input"
              className="mb-1.5 block text-sm font-medium text-slate-900"
            >
              برای تأیید، عنوان بورد را تایپ کنید:
            </label>
            <p
              dir="auto"
              className="mb-2 select-all rounded-md border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-mono text-slate-700"
            >
              {boardTitle}
            </p>
            <input
              id="delete-board-confirm-input"
              type="text"
              dir="auto"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={isPending}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={!matches || isPending}
              className="inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "در حال حذف..." : "حذف بورد"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
