"use client";

// apps/web/src/features/settings/workspace/MembersTable.tsx
//
// Read + write surface for the members list. Each row shows
// avatar / display name / email / role chip / last-seen and (when
// the current viewer has permission) a row-level action cluster:
//
//   • Role select  — toggles ADMIN ↔ MEMBER (OWNER row uses a
//                    static chip; OWNER cannot be demoted via this
//                    procedure — must use transferOwnership first).
//   • "ارتقاء به مالک" — only visible to the current OWNER, only
//                    for non-OWNER rows. Opens the
//                    TransferOwnershipDialog confirm.
//   • "حذف"        — admin removes admin/member, owner removes
//                    anyone. Hidden for the current user's own row
//                    (use the danger tab's "leave workspace"
//                    instead) and for the OWNER row (transfer
//                    ownership first).
//
// All mutations land on Server Actions passed in as props. After
// each successful mutation we router.refresh() so the Server
// Component above re-runs and the table reflects the new state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, ShieldCheck, Trash2, UserRound } from "lucide-react";

import { toJalaliDisplay, utcFromServer } from "@/lib/date";
import { TransferOwnershipDialog } from "./TransferOwnershipDialog";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";
export type AssignableRole = "ADMIN" | "MEMBER";

export interface MemberRow {
  userId: string;
  role: WorkspaceRole;
  joinedAt: string; // ISO 8601
  user: {
    email: string;
    displayName: string;
    avatarUrl: string | null;
    /** ISO 8601, or null if the user has never logged in. */
    lastSeenAt: string | null;
  } | null;
}

export type UpdateRoleAction = (input: {
  workspaceId: string;
  userId: string;
  role: AssignableRole;
}) => Promise<{ ok: boolean; error?: string }>;

export type RemoveMemberAction = (input: {
  workspaceId: string;
  userId: string;
}) => Promise<{ ok: boolean; error?: string }>;

export type TransferOwnershipAction = (input: {
  workspaceId: string;
  newOwnerId: string;
}) => Promise<{ ok: boolean; error?: string }>;

interface Props {
  workspaceId: string;
  members: MemberRow[];
  currentUserId: string;
  /** Layout already restricts to OWNER + ADMIN. */
  currentUserRole: "OWNER" | "ADMIN";
  onUpdateRole: UpdateRoleAction;
  onRemove: RemoveMemberAction;
  onTransferOwnership: TransferOwnershipAction;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persian role labels — duplicated from features/shell/lib/roleLabels.ts
// because cross-feature imports are blocked by the boundaries linter.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: "مالک",
  ADMIN: "مدیر",
  MEMBER: "عضو",
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MembersTable({
  workspaceId,
  members,
  currentUserId,
  currentUserRole,
  onUpdateRole,
  onRemove,
  onTransferOwnership,
}: Props) {
  // Transfer ownership dialog state — opens with the targeted member.
  const [transferTarget, setTransferTarget] = useState<MemberRow | null>(null);

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">عضو</th>
              <th className="px-4 py-2.5 text-start font-medium">نقش</th>
              <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">
                آخرین فعالیت
              </th>
              <th className="px-4 py-2.5 text-end font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.map((member) => (
              <MemberTableRow
                key={member.userId}
                workspaceId={workspaceId}
                member={member}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onUpdateRole={onUpdateRole}
                onRemove={onRemove}
                onOpenTransfer={() => setTransferTarget(member)}
              />
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-slate-400">
                  هنوز عضوی در این فضای کاری نیست.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TransferOwnershipDialog
        open={transferTarget !== null}
        target={transferTarget}
        workspaceId={workspaceId}
        onClose={() => setTransferTarget(null)}
        onConfirm={onTransferOwnership}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row component
// ─────────────────────────────────────────────────────────────────────────────

function MemberTableRow({
  workspaceId,
  member,
  currentUserId,
  currentUserRole,
  onUpdateRole,
  onRemove,
  onOpenTransfer,
}: {
  workspaceId: string;
  member: MemberRow;
  currentUserId: string;
  currentUserRole: "OWNER" | "ADMIN";
  onUpdateRole: UpdateRoleAction;
  onRemove: RemoveMemberAction;
  onOpenTransfer: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isSelf = member.userId === currentUserId;
  const isOwnerRow = member.role === "OWNER";

  // Role select: ADMIN viewers can change ADMIN ↔ MEMBER for non-self
  // non-OWNER rows. OWNER viewers can do the same. OWNER row stays
  // a static chip (cannot be demoted via updateRole; transfer
  // ownership is the only path).
  const canChangeRole = !isOwnerRow && !isSelf;

  // Remove: admin/owner can remove non-OWNER non-self rows. Self-row
  // uses the danger tab's "leave workspace" CTA. OWNER row needs
  // transfer ownership first.
  const canRemove = !isOwnerRow && !isSelf;

  // Transfer: only the current OWNER can transfer. Target must not
  // already be OWNER (same row).
  const canTransferToHere = currentUserRole === "OWNER" && !isOwnerRow;

  const handleRoleChange = (nextRole: AssignableRole) => {
    if (!canChangeRole || nextRole === member.role) return;
    startTransition(async () => {
      const result = await onUpdateRole({
        workspaceId,
        userId: member.userId,
        role: nextRole,
      });
      if (result.ok) {
        toast.success("نقش به‌روزرسانی شد.");
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در تغییر نقش.");
      }
    });
  };

  const handleRemove = () => {
    if (!canRemove) return;
    const memberName = member.user?.displayName ?? "این عضو";
    if (!window.confirm(`آیا «${memberName}» از فضای کاری حذف شود؟`)) return;
    startTransition(async () => {
      const result = await onRemove({ workspaceId, userId: member.userId });
      if (result.ok) {
        toast.success("عضو حذف شد.");
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در حذف عضو.");
      }
    });
  };

  return (
    <tr className={isPending ? "opacity-60" : undefined}>
      {/* Member identity */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar
            displayName={member.user?.displayName ?? ""}
            avatarUrl={member.user?.avatarUrl ?? null}
          />
          <div className="min-w-0">
            <p
              dir="auto"
              className="truncate font-medium text-slate-900"
              title={member.user?.displayName}
            >
              {member.user?.displayName ?? "کاربر حذف‌شده"}
              {isSelf && (
                <span className="ms-2 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-normal text-blue-700">
                  شما
                </span>
              )}
            </p>
            <p
              dir="ltr"
              className="truncate text-xs text-slate-500"
              title={member.user?.email}
            >
              {member.user?.email ?? "—"}
            </p>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-4 py-3">
        {isOwnerRow ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
            <Crown className="h-3 w-3" aria-hidden="true" />
            {ROLE_LABELS.OWNER}
          </span>
        ) : (
          <select
            value={member.role}
            onChange={(e) => handleRoleChange(e.target.value as AssignableRole)}
            disabled={!canChangeRole || isPending}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-50"
          >
            <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
            <option value="MEMBER">{ROLE_LABELS.MEMBER}</option>
          </select>
        )}
      </td>

      {/* Last seen */}
      <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
        {formatLastSeen(member.user?.lastSeenAt ?? null)}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-end">
        <div className="flex justify-end gap-1">
          {canTransferToHere && (
            <button
              type="button"
              onClick={onOpenTransfer}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="انتقال مالکیت به این عضو"
            >
              <Crown className="h-3.5 w-3.5" aria-hidden="true" />
              ارتقاء به مالک
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="حذف از فضای کاری"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              حذف
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function Avatar({
  displayName,
  avatarUrl,
}: {
  displayName: string;
  avatarUrl: string | null;
}) {
  const initial = displayName.length > 0 ? Array.from(displayName)[0] : "?";
  if (avatarUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- avatars are user-supplied URLs and may not match next/image domains config */
      <img
        src={avatarUrl}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
      {initial}
    </div>
  );
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return "هرگز";
  try {
    return toJalaliDisplay(utcFromServer(iso), undefined, "YYYY/MM/DD");
  } catch {
    return iso;
  }
}
