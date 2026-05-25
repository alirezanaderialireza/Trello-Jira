// apps/web/src/app/workspaces/layout.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Server-component layout that opts the entire /workspaces tree out of
// static prerendering.
//
// Both `workspaces/page.tsx` and `workspaces/[slug]/page.tsx` are client
// components that call trpc.useQuery / trpc.useMutation at render time.
// The current root layout wires QueryProvider and SessionProvider but NOT
// a tRPC client provider, so any prerender attempt fails with:
//
//   Error: Unable to find tRPC Context. Did you forget to wrap your App
//   inside `withTRPC` HoC?
//   Error occurred prerendering page "/workspaces"
//
// `export const dynamic = "force-dynamic"` is ignored on a client component
// in Next 16 + Turbopack — only segment-level files (layout.tsx / route.ts)
// honour it. Sitting it on this server-component layout marks every route
// underneath as request-time rendered, which is the correct semantics for
// per-user, session-gated pages anyway.
//
// When the App-Router-style tRPC provider is added at layout.tsx and the
// pages are made provider-safe, this file can be deleted.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default function WorkspacesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
