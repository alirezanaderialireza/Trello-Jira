"use client";

// apps/web/src/features/shell/topnav/TopNav.tsx
//
// Top navigation bar wrapper. Composes:
//   • Mobile burger button (visible < md, opens the sidebar drawer)
//   • Logo / app name
//   • WorkspaceSwitcher
//   • SearchBar (placeholder + Cmd/Ctrl+K)
//   • NotificationsBell (Commit 5 will replace placeholder)
//   • ProfileDropdown
//
// All children are Client Components. The host (AppShell, also a
// Client Component) passes `mobileMenuOpen` state and a handler so
// the burger can toggle the sidebar's mobile drawer.

import Link from "next/link";
import { Menu } from "lucide-react";

import type { AppRouter } from "@repo/api";
import type { inferRouterOutputs } from "@trpc/server";

import { ProfileDropdown } from "./ProfileDropdown";
import { NotificationsBell } from "./NotificationsBell";
import { SearchBar } from "./SearchBar";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type SidebarBootstrap = inferRouterOutputs<AppRouter>["v1"]["public"]["sidebar"]["bootstrap"];

interface TopNavProps {
  initialData: SidebarBootstrap | null;
  onOpenMobileMenu: () => void;
}

export function TopNav({ initialData, onOpenMobileMenu }: TopNavProps) {
  // Defensive defaults — if the bootstrap fetch failed, we still want
  // a navigable topnav rather than a crash. Real data is the common
  // case; null is the rare degraded-mode case.
  const workspaces = initialData?.workspaces ?? [];
  const user = initialData?.currentUser;

  return (
    <header
      className="
        md:col-span-2 z-20
        flex h-14 items-center justify-between gap-2 border-b border-slate-200
        bg-white px-3 sm:px-4
      "
    >
      {/* Start cluster: mobile burger + logo + WorkspaceSwitcher */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="باز کردن منو"
          className="
            rounded-md p-2 text-slate-600 hover:bg-slate-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
            md:hidden
          "
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>

        <Link
          href="/workspaces"
          className="hidden items-center gap-2 text-sm font-bold text-slate-800 sm:flex"
          aria-label="صفحه فضاهای کاری"
        >
          <span aria-hidden="true">📋</span>
          <span>Trello OS</span>
        </Link>

        <div className="ms-1">
          <WorkspaceSwitcher workspaces={workspaces} />
        </div>
      </div>

      {/* Center cluster: search */}
      <div className="hidden flex-1 justify-center md:flex">
        <SearchBar />
      </div>

      {/* End cluster: notifications + profile */}
      <div className="flex items-center gap-1">
        {user && (
          <NotificationsBell
            initialCount={initialData?.pendingInvitationsCount ?? 0}
            userTimezone={user.timezone}
          />
        )}

        {user ? (
          <ProfileDropdown
            displayName={user.displayName}
            avatarUrl={user.avatarUrl}
            locale={user.locale}
            timezone={user.timezone}
          />
        ) : (
          // No-user fallback — bootstrap fetch failed. A signOut/login
          // hint is friendlier than an empty corner.
          <Link
            href="/login"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            ورود
          </Link>
        )}
      </div>
    </header>
  );
}
