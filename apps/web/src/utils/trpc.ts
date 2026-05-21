// apps/web/src/utils/trpc.ts
import { httpBatchLink } from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import type { AppRouter } from "@repo/api";
import superjson from "superjson";

export const trpc = createTRPCNext<AppRouter>({
  config() {
    return {
      transformer: superjson,
      links: [
        httpBatchLink({
          url: "/api/trpc", // مسیر استاندارد در Next.js
        }),
      ],
    };
  },
  ssr: false,
});