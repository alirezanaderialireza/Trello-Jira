// apps/web/src/app/(app)/workspaces/[slug]/settings/layout.tsx
//
// Server Component layout for workspace settings.
//
// Two responsibilities:
//   1. Role gate. ONLY OWNER + ADMIN may access any settings tab.
//      MEMBER users get redirected to /workspaces/[slug] (the boards
//      page). The redirect is server-side — no flash-of-unauthorised
//      content.
//   2. Header chrome + tabs nav. The page background, breadcrumb,
//      workspace title, and tab strip are rendered once here so each
//      tab page below only owns its own content.
//
// The fetch + gate live in the layout (not the page) so the same
// guard runs whether the user lands on /general, /members, or
// /danger via direct URL.

import { redirect } from "next/navigation";
import Link from "next/link";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";
import { SettingsTabs } from "@/features/settings/workspace/SettingsTabs";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}

export default async function WorkspaceSettingsLayout({
  params,
  children,
}: LayoutProps) {
  const { slug } = await params;

  const session = await getWebSession();
  if (!session) {
    // Defensive — middleware already enforces this for the (app)
    // group, but Server Component code paths get the same guard so a
    // future change to middleware can't accidentally open this page.
    redirect(`/login?callbackUrl=${encodeURIComponent(`/workspaces/${slug}/settings`)}`);
  }

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  let workspace;
  try {
    workspace = await caller.v1.public.workspace.getBySlug({ slug });
  } catch {
    // NOT_FOUND or FORBIDDEN — bounce back to the workspaces list
    // rather than a generic 404 so the user sees the navigation
    // affordance to recover.
    redirect("/workspaces");
  }

  // Role gate. The danger tab additionally restricts certain actions
  // to OWNER (delete + transfer ownership), but layout-level access
  // is OWNER + ADMIN. MEMBER goes back to the workspace boards page.
  if (workspace.role !== "OWNER" && workspace.role !== "ADMIN") {
    redirect(`/workspaces/${slug}`);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link
            href={`/workspaces/${slug}`}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <span aria-hidden="true">←</span>
            بازگشت به فضای کاری
          </Link>
          <h1
            dir="auto"
            className="mt-2 truncate text-2xl font-bold text-slate-900"
            title={workspace.name}
          >
            تنظیمات «{workspace.name}»
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            مدیریت متادیتا، اعضا، دعوت‌ها و عملیات حساس فضای کاری
          </p>
        </header>

        <SettingsTabs slug={slug} role={workspace.role} />

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
