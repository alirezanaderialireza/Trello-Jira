"use client";

// apps/web/src/providers/TRPCProvider.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// App Router tRPC + React Query bootstrap (Phase 1.1.5).
//
// What this Provider does (in order of mount):
//   1. Creates a single `QueryClient` per browser session via `useState`
//      so client-side React tree gets a stable cache while still letting
//      multiple SSR requests have their own clients.
//   2. Creates a tRPC client wired to `/api/trpc` with superjson and
//      cookie-based credentials so Auth.js's session cookie reaches the
//      route handler (without `credentials: "include"` Next-internal
//      fetches still work, but explicit is clearer for cross-origin
//      future cases).
//   3. Wraps `children` in `<trpc.Provider>` *and* the underlying
//      `<QueryClientProvider>`. Both are required: the React Query
//      provider for `useQuery`/`useMutation` infrastructure, and the
//      tRPC provider for the typed proxy lookup.
//
// Replaces the old `QueryProvider`:
//   The previous `QueryProvider` only set up React Query (no tRPC), so
//   it left every `trpc.X.useQuery()` call without context — the
//   "Unable to find tRPC Context" crash that PR #58 surfaced. We fold
//   its options here verbatim (refetchOnWindowFocus, gcTime, retry
//   policy, mutations retry) so behavioural defaults don't drift.
//
// Provider order in root layout:
//   <RootErrorBoundary>
//     <GlobalErrorListener />
//     <SessionProvider>           — outer-most for any tRPC mutation
//                                   that wants `getSession()` (kept
//                                   identical to the prior layout).
//       <TRPCProvider>            — tRPC + React Query (this file)
//         {children}
//         <DevtoolsClient />
//       </TRPCProvider>
//     </SessionProvider>
//   </RootErrorBoundary>
//
//   Wrap order matters: SessionProvider stays outside so Server-Action
//   sub-trees can read the session even before tRPC links are
//   constructed. The previous layout had this exact order (just with
//   QueryProvider where TRPCProvider now lives), so dropping the
//   replacement in is a one-line swap.
// ─────────────────────────────────────────────────────────────────────────────

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { useState, type ReactNode } from "react";

import { trpc } from "../utils/trpc";

export function TRPCProvider({ children }: { children: ReactNode }) {
  // QueryClient — defaults preserved from the legacy QueryProvider
  // verbatim (it lived at apps/web/src/providers/QueryProvider.tsx
  // before this PR).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // We rely on WebSocket pushes for realtime; tab-focus
            // refetch would race with realtime patches.
            refetchOnWindowFocus: false,
            // Refetch when the network reconnects so a tab that was
            // briefly offline catches up.
            refetchOnReconnect: "always",
            // 5 min "fresh" — bootstrap-style queries (sidebar,
            // workspaces) revalidate cheaply and the WS feed pushes
            // anything time-sensitive.
            staleTime: 5 * 60 * 1000,
            // 10 min retention — covers a casual back/forward without
            // a re-fetch.
            gcTime: 10 * 60 * 1000,
            // Don't retry permission/not-found errors; both are
            // intentional terminal states.
            retry: (failureCount, error: any) => {
              const status = error?.data?.httpStatus;
              if (status === 404 || status === 401) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            // One retry for transient network blips. Two would amplify
            // duplicate-write risk on idempotency-key-less mutations.
            retry: 1,
            retryDelay: 1000,
          },
        },
      }),
  );

  // tRPC client — same single-instance contract via useState.
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          // Forward cookies (Auth.js session) on same-origin calls.
          // `credentials: "same-origin"` is the browser default; we
          // call it out so the intent is searchable later.
          fetch(input, init) {
            return fetch(input, { ...init, credentials: "same-origin" });
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
