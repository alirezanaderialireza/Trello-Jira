// apps/web/src/app/(auth)/signup/layout.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Server-component layout that opts /signup out of static prerendering.
//
// `signup/page.tsx` is a client component that calls
// `trpc.v1.public.user.signup.useMutation()` at render time. The current
// root layout wires QueryProvider and SessionProvider but NOT a tRPC client
// provider, so any prerender attempt fails with:
//
//   Error: Unable to find tRPC Context. Did you forget to wrap your App
//   inside `withTRPC` HoC?
//
// `export const dynamic = "force-dynamic"` is ignored on a client component
// in Next 16 + Turbopack — only segment-level files (layout.tsx / route.ts)
// honour it. Sitting it on this server-component layout marks /signup as
// request-time rendered.
//
// Other pages in the (auth) group (login, forgot-password, reset-password,
// verify-email) do NOT use tRPC, so they keep their per-page Suspense
// wrapper and stay prerenderable. That's why this layout is scoped to
// /signup specifically rather than the whole (auth) route group.
//
// When the App-Router-style tRPC provider is added at the root layout, this
// file can be deleted.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
