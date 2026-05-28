// apps/web/src/app/(app)/workspaces/[slug]/settings/members/page.tsx
//
// Members tab. Server Component — fetches the members list AND the
// active invitations list in parallel, then hands them to two
// dedicated Client Components for the per-row interactions.
//
// Two server queries:
//   • workspace.members.list       (workspaceMemberProcedure)
//   • workspace.invitations.list   (workspaceAdminProcedure)
//
// The settings layout already gates to OWNER+ADMIN, so the
// invitations.list call (admin-gated) is always allowed at this
// point. The defensive try/catch around invitations protects against
// a hypothetical role change between the layout's gate and this
// page's render — in that case we surface an empty pending list
// instead of crashing the whole tab.

import { notFound } from "next/navigation";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { MembersTable } from "@/features/settings/workspace/MembersTable";
import { InviteMemberModal } from "@/features/settings/workspace/InviteMemberModal";
import { PendingInvitationsList } from "@/features/settings/workspace/PendingInvitationsList";

import { inviteToWorkspaceAction } from "../../../../_actions/inviteToWorkspace";
import { revokeInvitationAction } from "../../../../_actions/revokeInvitation";
import { removeWorkspaceMemberAction } from "../../../../_actions/removeWorkspaceMember";
import { updateMemberRoleAction } from "../../../../_actions/updateMemberRole";
import { transferOwnershipAction } from "../../../../_actions/transferOwnership";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function MembersSettingsPage({ params }: PageProps) {
  const { slug } = await params;

  const session = await getWebSession();
  if (!session) notFound();

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  let workspace;
  try {
    workspace = await caller.v1.public.workspace.getBySlug({ slug });
  } catch {
    notFound();
  }

  // Both reads run server-side in parallel.
  const [members, invitations] = await Promise.all([
    caller.v1.public.workspace.members.list({ workspaceId: workspace.id }),
    caller.v1.public.workspace.invitations
      .list({ workspaceId: workspace.id })
      .catch(() => [] as Array<{
        id: string;
        invitedEmail: string;
        role: string;
        invitedByUserId: string;
        expiresAt: string;
        createdAt: string;
      }>),
  ]);

  return (
    <div className="space-y-8">
      {/* ── Members section ──────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              اعضای فضای کاری
            </h2>
            <p className="text-sm text-slate-500">
              {members.length.toLocaleString("fa-IR")} عضو فعال
            </p>
          </div>
          <InviteMemberModal
            workspaceId={workspace.id}
            onInvite={inviteToWorkspaceAction}
          />
        </div>

        <MembersTable
          workspaceId={workspace.id}
          members={members.map((m) => ({
            userId: m.userId,
            role: m.role as "OWNER" | "ADMIN" | "MEMBER",
            joinedAt: m.joinedAt instanceof Date ? m.joinedAt.toISOString() : String(m.joinedAt),
            user: m.user
              ? {
                  email: m.user.email,
                  displayName: m.user.displayName,
                  avatarUrl: m.user.avatarUrl,
                  lastSeenAt:
                    m.user.lastSeenAt instanceof Date
                      ? m.user.lastSeenAt.toISOString()
                      : m.user.lastSeenAt
                        ? String(m.user.lastSeenAt)
                        : null,
                }
              : null,
          }))}
          currentUserId={session.user.id}
          currentUserRole={workspace.role as "OWNER" | "ADMIN"}
          onUpdateRole={updateMemberRoleAction}
          onRemove={removeWorkspaceMemberAction}
          onTransferOwnership={transferOwnershipAction}
        />
      </section>

      {/* ── Pending invitations section ──────────────────────────────────── */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-900">
            دعوت‌های در انتظار
          </h2>
          <p className="text-sm text-slate-500">
            دعوت‌هایی که هنوز پذیرفته یا منقضی نشده‌اند
          </p>
        </div>

        <PendingInvitationsList
          workspaceId={workspace.id}
          invitations={invitations}
          onRevoke={revokeInvitationAction}
        />
      </section>
    </div>
  );
}
