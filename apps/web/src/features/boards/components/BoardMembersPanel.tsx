"use client";

import { useState } from "react";
import { trpc } from "../../../utils/trpc";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";

interface Props {
  boardId: string;
}

export function BoardMembersPanel({ boardId }: Props) {
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteRole, setInviteRole] = useState<"MEMBER" | "ADMIN">("MEMBER");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const { data, isLoading, refetch } =
    trpc.v1.public.boardMembers.getMembers.useQuery({ boardId });

  const inviteMutation = trpc.v1.public.boardMembers.inviteMember.useMutation({
    onSuccess: (result) => {
      if (result.alreadyMember) {
        toast.info("User is already a member.");
      } else {
        toast.success("Member invited successfully.");
      }
      setInviteUserId("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = trpc.v1.public.boardMembers.removeMember.useMutation({
    onSuccess: () => { toast.success("Member removed."); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const changeRoleMutation = trpc.v1.public.boardMembers.changeRole.useMutation({
    onSuccess: () => { toast.success("Role updated."); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const canManage = data?.currentUserRole === "OWNER" || data?.currentUserRole === "ADMIN";
  const isOwner = data?.currentUserRole === "OWNER";

  if (isLoading) {
    return <div className="p-4 text-sm text-slate-400">Loading members...</div>;
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <h3 className="text-sm font-semibold text-white">Board Members</h3>

      {/* Member list */}
      <ul className="mt-3 space-y-2">
        {data?.members.map((member) => (
          <li key={member.id} className="flex items-center justify-between rounded-md bg-slate-700/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-600 text-xs font-bold text-slate-300">
                {member.userId.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-sm text-slate-200 truncate max-w-[140px]">{member.userId}</span>
              <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-300">
                {member.role}
              </span>
            </div>

            {/* Actions */}
            {canManage && member.role !== "OWNER" && (
              <div className="flex items-center gap-1">
                {/* Role toggle (only owner can promote to ADMIN) */}
                {isOwner && (
                  <select
                    value={member.role}
                    onChange={(e) =>
                      changeRoleMutation.mutate({
                        boardId,
                        userId: member.userId,
                        newRole: e.target.value as "ADMIN" | "MEMBER",
                      })
                    }
                    className="rounded border border-slate-600 bg-slate-700 px-1 py-0.5 text-[11px] text-slate-300"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                )}

                <button
                  onClick={() => setRemoveTarget(member.userId)}
                  className="ml-1 rounded p-1 text-slate-400 hover:bg-red-900/30 hover:text-red-400"
                  title="Remove member"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Invite form */}
      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!inviteUserId.trim()) return;
            inviteMutation.mutate({ boardId, userId: inviteUserId.trim(), role: inviteRole });
          }}
          className="mt-4 border-t border-slate-700 pt-3"
        >
          <p className="mb-2 text-xs font-medium text-slate-400">Invite a new member</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={inviteUserId}
              onChange={(e) => setInviteUserId(e.target.value)}
              placeholder="User ID or email"
              className="flex-1 rounded border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "MEMBER" | "ADMIN")}
              className="rounded border border-slate-600 bg-slate-700 px-2 py-1.5 text-sm text-slate-300"
            >
              <option value="MEMBER">Member</option>
              {isOwner && <option value="ADMIN">Admin</option>}
            </select>
            <button
              type="submit"
              disabled={!inviteUserId.trim() || inviteMutation.isPending}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {inviteMutation.isPending ? "..." : "Invite"}
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title="حذف عضو از بورد"
        description={
          removeTarget !== null
            ? `آیا «${removeTarget}» از این بورد حذف شود؟`
            : undefined
        }
        confirmLabel="حذف"
        cancelLabel="انصراف"
        variant="danger"
        isPending={removeMutation.isPending}
        onConfirm={() => {
          if (removeTarget !== null) {
            removeMutation.mutate({ boardId, userId: removeTarget });
          }
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
