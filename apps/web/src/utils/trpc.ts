// apps/web/src/utils/trpc.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Client-side tRPC entry point — App Router edition (Phase 1.1.5).
//
// Why createTRPCReact (not createTRPCNext):
//   `createTRPCNext` is the Pages Router API. It returns a `withTRPC()`
//   HOC that callers wrap around their `_app.tsx` default export — but
//   App Router has no `_app.tsx`, so the HOC is never applied. Every
//   client component that calls `trpc.X.Y.useQuery()` then crashes with
//   "Unable to find tRPC Context. Did you forget to wrap your App
//   inside `withTRPC` HoC?".
//
//   The App Router replacement is `createTRPCReact` from
//   `@trpc/react-query`. It returns a Provider component
//   (`trpc.Provider`) that wraps the tree the same way React Query's
//   `QueryClientProvider` does — purely runtime, no HOC dance. The
//   Provider lives in `src/providers/TRPCProvider.tsx`, mounted by the
//   root layout (`src/app/layout.tsx`).
//
// Type compatibility:
//   The hook surface (`trpc.v1.public.X.Y.useQuery / useMutation`) is
//   identical to what `createTRPCNext` exposed — both come from
//   `@trpc/react-query` under the hood. None of the ~10 call sites
//   (Sidebar, BoardLink, NotificationsBell, …) need to change.
//
// Transformer (superjson) and link (httpBatchLink → /api/trpc) move to
// `TRPCProvider.tsx`; this file is pure type wiring.
// ─────────────────────────────────────────────────────────────────────────────

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@repo/api";

export const trpc = createTRPCReact<AppRouter>();
