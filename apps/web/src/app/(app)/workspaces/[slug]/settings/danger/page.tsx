// apps/web/src/app/(app)/workspaces/[slug]/settings/danger/page.tsx
//
// Danger tab — destructive operations on the current workspace.
//
// Two panels (rendered conditionally on role):
//
//   • "خروج از فضای کاری"
//       Visible to OWNER + ADMIN. The leave procedure itself rejects
//       a sole-OWNER attempt with a Persian message pointing at
//       transferOwnership; we surface that verbatim if the user
//       presses the button.
//
//   • "حذف فضای کاری"
//       OWNER-only. The settings layout has already gated to
//       OWNER+ADMIN, so we further gate this panel inline on
//       workspace.role === \"OWNER\". Opens a type-name-to-confirm
//       dialog (D7); on success we show a 10-second sonner toast
//       with a \"بازگردانی\" action (D6) that calls
//       restoreWorkspaceAction.
//
// All wiring lives in the DangerZone Client Component below — this
// page just fetches the workspace + passes the actions in.

import { notFound } from "next/navigation";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";
import { DangerZone } from "@/features/settings/workspace/DangerZone";

import { leaveWorkspaceAction } from "../../../../_actions/leaveWorkspace";
import { softDeleteWorkspaceAction } from "../../../../_actions/softDeleteWorkspace";
import { restoreWorkspaceAction } from "../../../../_actions/restoreWorkspace";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function DangerSettingsPage({ params }: PageProps) {
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

  return (
    <DangerZone
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      workspaceSlug={workspace.slug}
      currentUserRole={workspace.role as "OWNER" | "ADMIN"}
      onLeave={leaveWorkspaceAction}
      onSoftDelete={softDeleteWorkspaceAction}
      onRestore={restoreWorkspaceAction}
    />
  );
}
