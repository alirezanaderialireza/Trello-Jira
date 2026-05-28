"use client";

// apps/web/src/features/settings/workspace/PendingInvitationsList.tsx
//
// Renders the pending invitations table below the members list.
// Shows email, role chip, expiry date, and a "لغو" button on each
// row. Empty state when there are no pending invitations.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, X } from "lucide-react";

import { toJalaliDisplay, utcFromServer } from "@/lib/date";

export interface PendingInvitation {
  id: string;
  invitedEmail: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

export type RevokeInvitationAction = (input: {
  workspaceId: string;
  invitationId: string;
}) => Promise<{ ok: boolean; error?: string }>;

interface Props {
  workspaceId: string;
  invitations: PendingInvitation[];
  onRevoke: RevokeInvitationAction;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "مدیر",
  MEMBER: "عضو",
};

export function PendingInvitationsList({
  workspaceId,
  invitations,
  onRevoke,
}: Props) {
  if (invitations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
        <Mail
          className="mx-auto h-6 w-6 text-slate-300"
          aria-hidden="true"
        />
        <p className="mt-2 text-sm text-slate-500">
          هیچ دعوت فعالی موجود نیست.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          با کلیک روی «دعوت عضو» در بالا، عضو جدید اضافه کنید.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2.5 text-start font-medium">ایمیل</th>
            <th className="px-4 py-2.5 text-start font-medium">نقش</th>
            <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">
              تا تاریخ
            </th>
            <th className="px-4 py-2.5 text-end font-medium">عملیات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invitations.map((invitation) => (
            <PendingInvitationRow
              key={invitation.id}
              workspaceId={workspaceId}
              invitation={invitation}
              onRevoke={onRevoke}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row component
// ─────────────────────────────────────────────────────────────────────────────

function PendingInvitationRow({
  workspaceId,
  invitation,
  onRevoke,
}: {
  workspaceId: string;
  invitation: PendingInvitation;
  onRevoke: RevokeInvitationAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRevoke = () => {
    if (
      !window.confirm(
        `آیا دعوت ارسال‌شده به «${invitation.invitedEmail}» لغو شود؟`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await onRevoke({
        workspaceId,
        invitationId: invitation.id,
      });
      if (result.ok) {
        toast.success("دعوت لغو شد.");
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در لغو دعوت.");
      }
    });
  };

  return (
    <tr className={isPending ? "opacity-60" : undefined}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Mail
            className="h-4 w-4 flex-shrink-0 text-slate-400"
            aria-hidden="true"
          />
          <span dir="ltr" className="truncate text-slate-900">
            {invitation.invitedEmail}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {ROLE_LABELS[invitation.role.toUpperCase()] ?? invitation.role}
        </span>
      </td>
      <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
        {formatExpiry(invitation.expiresAt)}
      </td>
      <td className="px-4 py-3 text-end">
        <button
          type="button"
          onClick={handleRevoke}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          لغو
        </button>
      </td>
    </tr>
  );
}

function formatExpiry(iso: string): string {
  try {
    return toJalaliDisplay(utcFromServer(iso), undefined, "YYYY/MM/DD");
  } catch {
    return iso;
  }
}
