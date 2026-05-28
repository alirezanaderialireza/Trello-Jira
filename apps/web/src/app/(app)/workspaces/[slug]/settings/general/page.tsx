// apps/web/src/app/(app)/workspaces/[slug]/settings/general/page.tsx
//
// General settings tab. Server Component — fetches the current
// workspace metadata and renders the GeneralForm pre-filled with
// the existing values.
//
// Visibility is OWNER-gated server-side; we surface that to the
// form via the `canChangeVisibility` flag so the radio is rendered
// disabled (with a Persian explainer) for ADMIN viewers. Submitting
// it anyway would surface a Persian permission error from the
// procedure, but disabling makes the boundary obvious upfront.

import { notFound } from "next/navigation";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";
import { GeneralForm } from "@/features/settings/workspace/GeneralForm";

import { updateWorkspaceAction } from "../../../../_actions/updateWorkspace";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function GeneralSettingsPage({ params }: PageProps) {
  const { slug } = await params;

  const session = await getWebSession();
  if (!session) {
    // Defensive — layout already redirected. Returning notFound
    // here keeps the type signature happy and gives a clean fallback
    // if the layout's gate somehow gets bypassed.
    notFound();
  }

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  let workspace;
  try {
    workspace = await caller.v1.public.workspace.getBySlug({ slug });
  } catch {
    notFound();
  }

  const visibility =
    workspace.visibility === "public" ? ("public" as const) : ("private" as const);

  return (
    <GeneralForm
      workspaceId={workspace.id}
      initialName={workspace.name}
      initialDescription={workspace.description ?? null}
      initialSlug={workspace.slug}
      initialVisibility={visibility}
      canChangeVisibility={workspace.role === "OWNER"}
      onSubmit={updateWorkspaceAction}
    />
  );
}
