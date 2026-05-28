"use client";

// apps/web/src/features/settings/workspace/DangerZone.tsx
//
// Wraps the two danger-tab panels:
//
//   • Leave panel  — visible to OWNER + ADMIN. The procedure rejects
//                    a sole-OWNER leave with a Persian directive
//                    pointing at transferOwnership; the message is
//                    surfaced verbatim via toast.
//
//   • Delete panel — OWNER-only. Opens DeleteWorkspaceDialog. On
//                    successful soft-delete, this component is
//                    responsible for the 10-second \"بازگردانی\"
//                    grace-window toast (D6) and the post-delete
//                    redirect to /workspaces.
//
// Layout already gates to OWNER+ADMIN, so this component never
// renders for plain MEMBER.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, DoorOpen, Trash2 } from "lucide-react";

import {
  DeleteWorkspaceDialog,
  type SoftDeleteAction,
  type SoftDeleteResult,
} from "./DeleteWorkspaceDialog";

export type LeaveAction = (input: {
  workspaceId: string;
}) => Promise<{ ok: boolean; error?: string }>;

export type RestoreAction = (input: {
  workspaceId: string;
}) => Promise<{ ok: boolean; error?: string }>;

interface Props {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  /** Layout already gates to OWNER+ADMIN. */
  currentUserRole: "OWNER" | "ADMIN";
  onLeave: LeaveAction;
  onSoftDelete: SoftDeleteAction;
  onRestore: RestoreAction;
}

const GRACE_WINDOW_MS = 10_000;

export function DangerZone({
  workspaceId,
  workspaceName,
  workspaceSlug,
  currentUserRole,
  onLeave,
  onSoftDelete,
  onRestore,
}: Props) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isLeaving, startLeave] = useTransition();

  const isOwner = currentUserRole === "OWNER";

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = () => {
    if (
      !window.confirm(
        `آیا می‌خواهید از فضای کاری «${workspaceName}» خارج شوید؟`,
      )
    ) {
      return;
    }
    startLeave(async () => {
      const result = await onLeave({ workspaceId });
      if (result.ok) {
        toast.success(`از فضای کاری «${workspaceName}» خارج شدید.`);
        router.push("/workspaces");
      } else {
        toast.error(result.error ?? "خطا در خروج از فضای کاری.");
      }
    });
  };

  // ── Delete + grace-window restore ────────────────────────────────────────
  const handleDeleteResult = (result: SoftDeleteResult) => {
    setDeleteOpen(false);
    if (!result.ok) {
      toast.error(result.error ?? "خطا در حذف فضای کاری.");
      return;
    }

    // Show the 10-second "بازگردانی" toast. Sonner accepts a custom
    // duration; the action callback fires the restore action and
    // navigates back to the settings page on success. After
    // GRACE_WINDOW_MS the toast auto-dismisses; the soft-delete
    // remains in effect (the server has its own 30-day grace before
    // hard-delete).
    toast(`فضای کاری «${workspaceName}» حذف شد.`, {
      duration: GRACE_WINDOW_MS,
      action: {
        label: "بازگردانی",
        onClick: async () => {
          const restoreResult = await onRestore({ workspaceId });
          if (restoreResult.ok) {
            toast.success(`«${workspaceName}» بازگردانی شد.`);
            router.push(`/workspaces/${workspaceSlug}/settings/danger`);
          } else {
            toast.error(restoreResult.error ?? "خطا در بازگردانی.");
          }
        },
      },
    });

    // Navigate away immediately — the user no longer has access to
    // this workspace's settings (it's soft-deleted). The toast
    // survives navigation because Sonner's <Toaster /> lives at the
    // root layout.
    router.push("/workspaces");
  };

  return (
    <div className="space-y-6">
      {/* ── Leave panel ───────────────────────────────────────────────────── */}
      <DangerPanel
        icon={<DoorOpen className="h-5 w-5" aria-hidden="true" />}
        title="خروج از فضای کاری"
        description={
          isOwner
            ? "برای خروج، ابتدا مالکیت را به یکی از اعضا منتقل کنید."
            : "پس از خروج، دسترسی شما به بوردها و اعضای این فضای کاری قطع می‌شود."
        }
        action={
          <button
            type="button"
            onClick={handleLeave}
            disabled={isLeaving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DoorOpen className="h-4 w-4" aria-hidden="true" />
            {isLeaving ? "در حال خروج..." : "خروج از فضای کاری"}
          </button>
        }
      />

      {/* ── Delete panel (OWNER-only UI; ADMIN sees explainer) ───────────── */}
      {isOwner ? (
        <DangerPanel
          variant="destructive"
          icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
          title="حذف فضای کاری"
          description="این عملیات فضای کاری را حذف می‌کند و تا ۳۰ روز فرصت بازگردانی خواهید داشت. پس از آن، تمام داده‌ها به‌طور دائمی حذف می‌شوند."
          action={
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              حذف فضای کاری...
            </button>
          }
        />
      ) : (
        <DangerPanel
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="حذف فضای کاری"
          description="حذف فضای کاری فقط توسط مالک امکان‌پذیر است."
          muted
        />
      )}

      <DeleteWorkspaceDialog
        open={deleteOpen}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onSoftDelete}
        onResult={handleDeleteResult}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component
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
  variant?: "destructive";
  muted?: boolean;
}) {
  const palette =
    variant === "destructive"
      ? {
          border: "border-red-200",
          bg: "bg-red-50",
          icon: "text-red-600",
          title: "text-red-900",
          body: "text-red-800",
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
      className={`flex flex-col gap-3 rounded-xl border ${palette.border} ${palette.bg} p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${palette.icon}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${palette.title}`}>{title}</p>
          <p className={`mt-1 text-xs leading-6 ${palette.body}`}>{description}</p>
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
