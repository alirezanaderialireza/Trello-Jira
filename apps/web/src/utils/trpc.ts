// apps/web/src/utils/trpc.ts
import { httpBatchLink } from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import type { AppRouter } from "@repo/api";
import superjson from "superjson";

// tRPC v11: `transformer` moved out of the `config()` return value.
// At the @trpc/next layer it is now a sibling of `config`/`ssr` (used for SSR
// state hydration), and each network link must also receive it.
// See https://trpc.io/docs/migrate-from-v10-to-v11#transformer-moved-to-links
export const trpc = createTRPCNext<AppRouter>({
  config() {
    return {
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    };
  },
  transformer: superjson,
  ssr: false,
});