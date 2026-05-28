"use client";

// apps/web/src/features/shell/sidebar/Sidebar.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Client wrapper for the (app) sidebar.
//
// Receives the bootstrap data fetched server-side by (app)/layout.tsx
// and feeds it into a useQuery as `initialData`. That query takes
// over thereafter — the 60s staleTime means casual navigation never
// re-fetches; explicit invalidations from BoardLink (toggleStar) and
// CreateWorkspaceButton (create workspace via Server Action — wired
// in Commit 6) refresh on demand.
//
// The same component renders BOTH the desktop persistent sidebar
// (md+) and the contents of the mobile drawer. The drawer's
// open/close state lives at the layout level so the topnav burger
// button can toggle it. F4 ships the drawer as a self-contained
// MobileDrawer component imported here; layout calls
// `<Sidebar mobileDrawerOpen onMobileClose={...} />` to wire it.
//
// Active workspace highlighting comes from `usePathname()` matching
// against the workspace slug — an "active" row gets a brighter bg
// and a darker role badge.
// ─────────────────────────────────────────────────────────────────────────────

import { usePathname } from "next/navigation";

import { trpc } from "../../../utils/trpc";
import type { AppRouter } from "@repo/api";
import type { inferRouterOutputs } from "@trpc/server";

import { CreateWorkspaceButton } from "./CreateWorkspaceButton";
import { MobileDrawer } from "./MobileDrawer";
import { PendingInvitationsBadge } from "./PendingInvitationsBadge";
import { RecentSection } from "./RecentSection";
import { StarredSection } from "./StarredSection";
import { WorkspaceNode } from "./WorkspaceNode";

type SidebarBootstrap = inferRouterOutputs<AppRouter>["v1"]["public"]["sidebar"]["bootstrap"];

interface SidebarProps {
  /** Server-rendered initial data from (app)/layout.tsx. */
  initialData: SidebarBootstrap | null;
  /**
   * Mobile drawer open/close state, owned by the parent layout.
   * Desktop renders the sidebar as a sibling of `<main>` and ignores
   * these props.
   */
  mobileDrawerOpen?: boolean;
  onMobileClose?: () => void;
}

const SIDEBAR_QUERY_STALE_MS = 60_000;

export function Sidebar({
  initialData,
  mobileDrawerOpen = false,
  onMobileClose = () => {},
}: SidebarProps) {
  const pathname = usePathname() ?? "";

  // initialData may be null if the server fetch failed (transient
  // network hiccup, etc.). Cast to undefined for tRPC's initialData
  // contract — that triggers a foreground fetch instead of seeding
  // the cache with bad data.
  const initialForQuery: SidebarBootstrap | undefined =
    initialData ?? undefined;

  const { data, isLoading } = trpc.v1.public.sidebar.bootstrap.useQuery(
    undefined,
    {
      initialData: initialForQuery,
      staleTime: SIDEBAR_QUERY_STALE_MS,
      // The bootstrap query hydrates the entire sidebar UI; if we ever
      // need to differentiate a "no data" state from "fetching", the
      // isLoading flag is sufficient. Keep retry default — transient
      // failures shouldn't lock the user out of navigation.
    },
  );

  // Body content is identical between mobile drawer and desktop
  // pane. Render once and pass through both shells.
  const body = (
    <SidebarBody data={data ?? null} isLoading={isLoading} pathname={pathname} />
  );

  return (
    <>
      {/* Desktop sidebar — md+ only */}
      <aside
        className="
          row-start-2 hidden h-full overflow-y-auto border-e border-slate-200
          bg-slate-50 md:block
        "
        aria-label="فضاهای کاری"
      >
        {body}
      </aside>

      {/* Mobile drawer */}
      <MobileDrawer
        open={mobileDrawerOpen}
        onClose={onMobileClose}
        titleId="sidebar-mobile-title"
      >
        {body}
      </MobileDrawer>
    </>
  );
}

// ─── SidebarBody — content shared between desktop and mobile shells ─────────

function SidebarBody({
  data,
  isLoading,
  pathname,
}: {
  data: SidebarBootstrap | null;
  isLoading: boolean;
  pathname: string;
}) {
  if (!data && isLoading) {
    return (
      <div className="space-y-3 p-3" aria-busy="true">
        <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-3 text-sm text-slate-500">
        امکان بارگذاری فضاهای کاری وجود ندارد. لطفاً بعداً تلاش کنید.
      </div>
    );
  }

  // Build a Set<string> of starred boardIds so RecentSection can pass
  // the right initial isStarred to BoardLink without N^2 lookups.
  const starredBoardIds = new Set(
    data.starredBoards.map((b) => b.boardId),
  );

  return (
    <div className="flex h-full flex-col p-3">
      <PendingInvitationsBadge count={data.pendingInvitationsCount} />

      <section
        aria-labelledby="sidebar-workspaces-heading"
        className={data.pendingInvitationsCount > 0 ? "mt-4" : ""}
      >
        <h2
          id="sidebar-workspaces-heading"
          className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          فضاهای کاری
        </h2>

        {data.workspaces.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-slate-400">
            هنوز فضای کاری ندارید. اولین مورد را بسازید.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {data.workspaces.map((w) => (
              <WorkspaceNode
                key={w.id}
                workspace={w}
                isActive={pathname.startsWith(`/workspaces/${w.slug}`)}
              />
            ))}
          </ul>
        )}

        <CreateWorkspaceButton />
      </section>

      <StarredSection boards={data.starredBoards} />

      <RecentSection
        boards={data.recentBoards}
        starredBoardIds={starredBoardIds}
        userTimezone={data.currentUser.timezone}
      />
    </div>
  );
}
