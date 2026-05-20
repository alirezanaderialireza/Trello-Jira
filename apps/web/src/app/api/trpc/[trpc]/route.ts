// apps/web/src/app/api/trpc/[trpc]/route.ts
// Next.js App Router tRPC handler — passes the real Request to createContext
// so that session is extracted from cookies/headers automatically.

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "@repo/api";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async ({ req: fetchReq }) => {
      return createContext({
        req: fetchReq,
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      });
    },
  });

export { handler as GET, handler as POST };
