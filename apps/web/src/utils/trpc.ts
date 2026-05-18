// apps/web/src/utils/trpc.ts
//
// Fixes applied:
// ✅ #14: Replaced `createTRPCNext` (Next.js Pages Router only) with the
//         framework-agnostic `createTRPCClient` + `httpBatchLink`.
//
//         `createTRPCNext` wraps every procedure in React Query hooks
//         (trpc.x.y.useQuery / trpc.x.y.useMutation). We never use those hooks
//         directly — mutation hooks use `useMutation` from @tanstack/react-query
//         and call `boardApi.*` which calls `trpc.v1.public.*.mutate()`.
//         The plain vanilla client is the right tool for App Router.
//
//         The `trpc` object exported here is a typed proxy that mirrors the
//         AppRouter procedure tree and exposes `.query()` / `.mutate()` methods.

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@repo/api";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
    }),
  ],
});
