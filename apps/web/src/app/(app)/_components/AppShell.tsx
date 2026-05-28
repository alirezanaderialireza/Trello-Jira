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
// co-located with the components that fill its cells. The topnav
// placeholder gets replaced in Commit 4 with the real TopNav.

import { useState } from "react";
import { Menu } from "lucide-react";

import { Sidebar } from "@/features/shell/sidebar/Sidebar";
import type { AppRouter } from "@repo/api";
import type { inferRouterOutputs } from "@trpc/server";

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
      {/* TopNav placeholder — Commit 4 will replace with real <TopNav />. */}
      <header
        className="
          md:col-span-2
          flex h-14 items-center justify-between border-b border-slate-200
          bg-white px-4
        "
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="باز کردن منو"
            className="
              rounded-md p-2 text-slate-600 hover:bg-slate-100
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-blue-500 md:hidden
            "
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="text-sm font-semibold text-slate-700">
            {initialData?.currentUser.displayName
              ? `سلام، ${initialData.currentUser.displayName}`
              : "Trello OS"}
          </span>
        </div>
      </header>

      <Sidebar
        initialData={initialData}
        mobileDrawerOpen={mobileDrawerOpen}
        onMobileClose={() => setMobileDrawerOpen(false)}
      />

      <main className="row-start-2 overflow-y-auto bg-white">{children}</main>
    </div>
  );
}
