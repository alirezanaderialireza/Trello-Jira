"use client";

// apps/web/src/app/board/[boardId]/_components/MembersTab.tsx
//
// Board membership list + invite-from-workspace-members modal.
//
// Data sources:
//   • boardMembers.getMembers({ boardId })   → board members + role
//   • workspace.members.list({ workspaceId }) → addable pool
//
// Why two queries: boards have a workspace-member-first invariant
// (see addBoardMember domain use case). The invite picker therefore
// shows only users who are workspace members AND not yet on the
// board. Subtraction happens client-side.
//
// Per-row affordances:
//   • Role select (ADMIN ↔ MEMBER) — disabled for OWNER row.
//   • "حذف" button — visible to OWNER + ADMIN. Server enforces
//     last-OWNER + ADMIN-cannot-remove-OWNER guards; we surface
//     Persian errors via toast.
//
// Both invite + role/remove paths utils.invalidate the
// boardMembers.getMembers query so the list re-renders without a
// hard refetch.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Plus, Trash2, UserRound, X } from "lucide-react";

import { trpc } from "../../../../utils/trpc";
import { toJalaliDisplay, utcFromServer } from "@/lib/date";
import type { ActionResult } from "../_actions/_helpers";

type BoardRole = "OWNER" | "ADMIN" | "MEMBER";
type AssignableRole = "ADMIN" | "MEMBER";

interface Props {
  boardId: string;
  workspaceId: string;
  role: BoardRole;
  onInviteMember: (input: {
    boardId: string;
    userId: string;
    role: BoardRole;
  }) => Promise<ActionResult & { alreadyMember?: boolean; memberId?: string }>;
  onChangeRole: (input: {
    boardId: string;
    userId: string;
    newRole: BoardRole;
  }) => Promise<ActionResult>;
  onRemoveMember: (input: {
    boardId: string;
    userId: string;
  }) => Promise<ActionResult>;
}

const ROLE_LABELS: Record<BoardRole, string> = {
  OWNER: "مالک",
  ADMIN: "مدیر",
  MEMBER: "عضو",
};

export function MembersTab({
  boardId,
  workspaceId,
  role,
  onInviteMember,
  onChangeRole,
  onRemoveMember,
}: Props) {
  const utils = trpc.useUtils();
  const [inviteOpen, setInviteOpen] = useState(false);

  const canModerate = role === "OWNER" || role === "ADMIN";

  const membersQuery = trpc.v1.public.boardMembers.getMembers.useQuery({
    boardId,
  });

  if (membersQuery.isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }
  if (membersQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        خطا در بارگذاری اعضای بورد.
      </div>
    );
  }

  const members = membersQuery.data?.members ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {members.length.toLocaleString("fa-IR")} عضو فعال
        </p>
        {canModerate && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            دعوت عضو
          </button>
        )}
      </div>

      <div className="space-y-1">
        {members.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-6 text-center text-xs text-slate-400">
            هنوز عضوی به این بورد اضافه نشده.
          </p>
        )}
        {members.map((member) => (
          <MemberRow
            key={member.id}
            boardId={boardId}
            member={member}
            currentUserRole={role}
            canModerate={canModerate}
            onChangeRole={onChangeRole}
            onRemoveMember={onRemoveMember}
            onInvalidate={() =>
              utils.v1.public.boardMembers.getMembers.invalidate({ boardId })
            }
          />
        ))}
      </div>

      {!canModerate && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
          فقط مدیران و مالک بورد می‌توانند اعضا را مدیریت کنند.
        </p>
      )}

      <InviteMemberModal
        open={inviteOpen}
        boardId={boardId}
        workspaceId={workspaceId}
        existingMemberUserIds={members.map((m) => m.userId)}
        onClose={() => setInviteOpen(false)}
        onInvite={onInviteMember}
        onInvalidate={() =>
          utils.v1.public.boardMembers.getMembers.invalidate({ boardId })
        }
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-row component
// ─────────────────────────────────────────────────────────────────────────────

interface BoardMemberRow {
  id: string;
  userId: string;
  role: BoardRole;
  joinedAt: string;
  user: {
    email: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

function MemberRow({
  boardId,
  member,
  currentUserRole,
  canModerate,
  onChangeRole,
  onRemoveMember,
  onInvalidate,
}: {
  boardId: string;
  member: BoardMemberRow;
  currentUserRole: BoardRole;
  canModerate: boolean;
  onChangeRole: (input: {
    boardId: string;
    userId: string;
    newRole: BoardRole;
  }) => Promise<ActionResult>;
  onRemoveMember: (input: {
    boardId: string;
    userId: string;
  }) => Promise<ActionResult>;
  onInvalidate: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isOwnerRow = member.role === "OWNER";
  // Role change: any moderator (OWNER+ADMIN) can flip a non-OWNER
  // row between ADMIN and MEMBER. OWNER row is a static chip;
  // demoting an OWNER requires the (future) board-level transfer
  // ownership flow.
  const canChangeRole = canModerate && !isOwnerRow;
  const canRemove = canModerate && !isOwnerRow;

  const handleRoleChange = (next: AssignableRole) => {
    if (!canChangeRole || next === member.role || isPending) return;
    startTransition(async () => {
      const result = await onChangeRole({
        boardId,
        userId: member.userId,
        newRole: next,
      });
      if (result.ok) {
        toast.success("نقش به‌روزرسانی شد.");
        await onInvalidate();
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در تغییر نقش.");
      }
    });
  };

  const handleRemove = () => {
    if (!canRemove) return;
    const memberName = member.user?.displayName ?? "این عضو";
    if (!window.confirm(`آیا «${memberName}» از بورد حذف شود؟`)) return;
    startTransition(async () => {
      const result = await onRemoveMember({ boardId, userId: member.userId });
      if (result.ok) {
        toast.success("عضو حذف شد.");
        await onInvalidate();
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در حذف عضو.");
      }
    });
  };

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Avatar
          displayName={member.user?.displayName ?? ""}
          avatarUrl={member.user?.avatarUrl ?? null}
        />
        <div className="min-w-0 flex-1">
          <p
            dir="auto"
            className="truncate text-sm font-medium text-slate-900"
            title={member.user?.displayName ?? "کاربر حذف‌شده"}
          >
            {member.user?.displayName ?? "کاربر حذف‌شده"}
          </p>
          {member.user?.email && (
            <p
              dir="ltr"
              className="truncate text-[11px] text-slate-500"
              title={member.user.email}
            >
              {member.user.email}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isOwnerRow ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            <Crown className="h-3 w-3" aria-hidden="true" />
            {ROLE_LABELS.OWNER}
          </span>
        ) : (
          <select
            value={member.role}
            onChange={(event) =>
              handleRoleChange(event.target.value as AssignableRole)
            }
            disabled={!canChangeRole || isPending}
            className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-50"
          >
            <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
            <option value="MEMBER">{ROLE_LABELS.MEMBER}</option>
          </select>
        )}
        {canRemove && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isPending}
            aria-label="حذف از بورد"
            title="حذف از بورد"
            className="rounded-md p-1 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Invite modal — workspace-member dropdown picker
// ─────────────────────────────────────────────────────────────────────────────

function InviteMemberModal({
  open,
  boardId,
  workspaceId,
  existingMemberUserIds,
  onClose,
  onInvite,
  onInvalidate,
}: {
  open: boolean;
  boardId: string;
  workspaceId: string;
  existingMemberUserIds: string[];
  onClose: () => void;
  onInvite: (input: {
    boardId: string;
    userId: string;
    role: BoardRole;
  }) => Promise<ActionResult & { alreadyMember?: boolean; memberId?: string }>;
  onInvalidate: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [pickedRole, setPickedRole] = useState<AssignableRole>("MEMBER");
  const [isPending, startTransition] = useTransition();

  // Workspace-members query is enabled only when the modal is open
  // (saves a request for users who never click invite). The result
  // is cached by React Query so opening + closing + re-opening
  // doesn't re-fire.
  const workspaceMembersQuery =
    trpc.v1.public.workspace.members.list.useQuery(
      { workspaceId },
      { enabled: open },
    );

  // Subtract: workspace members not yet on this board.
  const addable = useMemo(() => {
    if (!workspaceMembersQuery.data) return [];
    const onBoard = new Set(existingMemberUserIds);
    return workspaceMembersQuery.data.filter((m) => !onBoard.has(m.userId));
  }, [workspaceMembersQuery.data, existingMemberUserIds]);

  if (!open) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUserId || isPending) return;
    startTransition(async () => {
      const result = await onInvite({
        boardId,
        userId: selectedUserId,
        role: pickedRole,
      });
      if (result.ok) {
        if (result.alreadyMember) {
          toast.info("این کاربر از قبل عضو بورد است.");
        } else {
          toast.success("عضو به بورد اضافه شد.");
        }
        setSelectedUserId("");
        setPickedRole("MEMBER");
        onClose();
        await onInvalidate();
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در دعوت عضو.");
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-board-member-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3
            id="invite-board-member-title"
            className="text-base font-bold text-slate-900"
          >
            دعوت عضو به بورد
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="بستن"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="invite-board-member-user"
              className="mb-1.5 block text-sm font-medium text-slate-900"
            >
              عضو
            </label>
            {workspaceMembersQuery.isLoading ? (
              <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ) : addable.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                همهٔ اعضای فضای کاری از قبل در این بورد هستند. ابتدا عضو جدیدی به
                فضای کاری دعوت کنید.
              </p>
            ) : (
              <select
                id="invite-board-member-user"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                disabled={isPending}
                required
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                <option value="">— انتخاب کنید —</option>
                {addable.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user?.displayName ?? m.userId}
                    {m.user?.email ? ` (${m.user.email})` : ""}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              فقط اعضای فضای کاری قابل افزودن هستند.
            </p>
          </div>

          <fieldset disabled={isPending || addable.length === 0}>
            <legend className="mb-1.5 block text-sm font-medium text-slate-900">
              نقش
            </legend>
            <div className="space-y-1.5">
              {(["MEMBER", "ADMIN"] as const).map((r) => (
                <label
                  key={r}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs transition-colors ${
                    pickedRole === r
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="invite-board-role"
                    value={r}
                    checked={pickedRole === r}
                    onChange={() => setPickedRole(r)}
                  />
                  <span className="font-medium text-slate-900">
                    {ROLE_LABELS[r]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              لغو
            </button>
            <button
              type="submit"
              disabled={
                !selectedUserId || isPending || addable.length === 0
              }
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "در حال افزودن..." : "افزودن به بورد"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar
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
    // eslint-disable-next-line @next/next/no-img-element -- user-supplied URL,
    // not guaranteed to match next/image domain config
    return (
      <img
        src={avatarUrl}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 flex-shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700"
    >
      {initial}
    </div>
  );
}

// (currently unused — keeps the date helper imported in case a
// "joined" timestamp is added next to each row in a follow-up.)
const _formatJoined = (iso: string): string => {
  try {
    return toJalaliDisplay(utcFromServer(iso), undefined, "YYYY/MM/DD");
  } catch {
    return iso;
  }
};
void _formatJoined;
