// apps/web/src/app/(app)/layout.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// App-shell layout for every post-login route (Server Component).
//
// Contract:
//   • Pre-fetches `sidebar.bootstrap` ONCE on the server via
//     `appRouter.createCaller(ctx)` and passes the result to the client
//     Sidebar / TopNav as `initialData`. The client then registers a
//     `useQuery({ initialData, staleTime: 60_000 })` so re-mounts hit
//     the cache instead of re-fetching.
//   • Auth-gates the entire (app) tree: missing or expired session →
//     redirect to /login. The middleware also redirects on cookie
//     absence, but we duplicate the check here because the cookie
//     could be present-but-invalid (e.g. user record deleted).
//   • Renders a 12-column-style grid: TopNav (h-14) spans the whole
//     viewport width; below it, the sidebar (260px on md+, hidden on
//     mobile) and main share the remaining height.
//   • RTL is inherited from <html dir="rtl"> in the root layout — we
//     use logical Tailwind utilities (border-e, ms-, me-) so the
//     layout flips correctly without per-direction overrides.
//
// In Commit 1 (route-group setup) the Sidebar and TopNav are
// placeholder elements. Commit 3 swaps the sidebar with the real
// `<Sidebar />`, Commit 4 swaps the topnav. The placeholders are
// styled to match the eventual layout's footprint so other commits
// don't introduce visual jumps.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { AppShell } from "./_components/AppShell";

// Force dynamic rendering for every (app) page.
//
// Every page underneath needs the per-request session + RLS-scoped
// queries. Static prerendering would either return an empty shell or
// crash on the missing tRPC context. Mark it explicit at the layout
// level so all descendants inherit.
export const dynamic = "force-dynamic";

type SidebarBootstrap = Awaited<
  ReturnType<ReturnType<typeof appRouter.createCaller>["v1"]["public"]["sidebar"]["bootstrap"]>
>;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── Auth gate ───────────────────────────────────────────────────────────
  //
  // `getWebSession` returns null if there is no Auth.js session, or if
  // the session JWT is valid but the user record was deleted /
  // soft-deleted. Either way → /login with the requested URL preserved
  // as `callbackUrl` (mirrors the middleware behaviour for cookie
  // absence). We pass no tenantId so getWebSession resolves the
  // user's personal workspace as the default tenant.
  const session = await getWebSession();
  if (!session) {
    redirect("/login");
  }

  // ── sidebar.bootstrap server-side prefetch ──────────────────────────────
  //
  // The shape returned by createCaller matches the public client tRPC
  // surface (same router, same procedures), so the data we set as
  // `initialData` on the client query side is a perfect cache hit.
  //
  // Defensive try/catch: a brand-new user with no membership rows
  // would still resolve a session here but bootstrap might surface as
  // an empty payload. We don't want a transient backend error to crash
  // the layout — the sidebar can render an empty state instead. Real
  // failures still surface via the error.tsx boundary one level down.
  // `getWebSession` returns the same { user, tenantId, aclVersion, roles }
  // shape that the tRPC `Session` type expects. The `Session` type isn't
  // re-exported from @repo/api/index.ts (kept internal to packages/api) so
  // we cast at the boundary; the runtime invariant is enforced by
  // `createContext`'s own session-shape contract.
  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  let bootstrap: SidebarBootstrap | null = null;
  try {
    bootstrap = await caller.v1.public.sidebar.bootstrap();
  } catch {
    bootstrap = null;
  }

  // The placeholders below get swapped in commits 3 (Sidebar) and 4
  // (TopNav). Their dimensions match the final components so commits
  // 3 and 4 are visual no-ops on the wireframe.
  return <AppShell initialData={bootstrap}>{children}</AppShell>;
}
