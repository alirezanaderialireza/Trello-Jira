"use client";

// apps/web/src/app/(app)/_components/AppShell.tsx
//
// Client Component glue between the (app) Server Layout and the
// interactive shell pieces (Sidebar, TopNav, mobile drawer toggle).
//
// The Server Layout cannot host useState — and we need state for
// "is the mobile drawer open?" which is shared between the topnav's
// burger button and the sidebar's MobileDrawer. Hoisting that state
// into this Client wrapper lets both children read/write it via
// props without forcing the layout itself to become a Client
// Component (which would block server-side bootstrap fetching).
//
// The grid template lives here so the visual structure stays
// co-located with the components that fill its cells.
//
// Server Action wiring (Lesson F4 — boundaries linter):
//   features/* must NEVER import from app/*. So the actions live
//   here in app/(app)/_actions/ (correct layer) and we inject them
//   into the feature components as props from this AppShell. The
//   one-way flow `app → features` is allowed; the reverse is not.

import { useState } from "react";

import { Sidebar } from "@/features/shell/sidebar/Sidebar";
import { TopNav } from "@/features/shell/topnav/TopNav";
import type { AppRouter } from "@repo/api";
import type { inferRouterOutputs } from "@trpc/server";

import { createWorkspaceAction } from "../_actions/createWorkspace";
import { updatePreferencesAction } from "../_actions/updatePreferences";

type SidebarBootstrap = inferRouterOutputs<AppRouter>["v1"]["public"]["sidebar"]["bootstrap"];

interface AppShellProps {
  initialData: SidebarBootstrap | null;
  children: React.ReactNode;
}

export function AppShell({ initialData, children }: AppShellProps) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  return (
    <div
      className="
        grid h-screen
        grid-cols-1 grid-rows-[56px_1fr]
        md:grid-cols-[260px_1fr]
      "
    >
      <TopNav
        initialData={initialData}
        onOpenMobileMenu={() => setMobileDrawerOpen(true)}
        onUpdatePreferences={updatePreferencesAction}
      />

      <Sidebar
        initialData={initialData}
        onCreateWorkspace={createWorkspaceAction}
        mobileDrawerOpen={mobileDrawerOpen}
        onMobileClose={() => setMobileDrawerOpen(false)}
      />

      <main className="row-start-2 overflow-y-auto bg-white">{children}</main>
    </div>
  );
}
