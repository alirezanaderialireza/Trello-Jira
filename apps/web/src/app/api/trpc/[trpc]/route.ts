// apps/web/src/app/api/trpc/[trpc]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Next.js App Router tRPC handler.
//
// Two-phase session resolution:
//   1. Try Auth.js v5 (database session) — this is the path used by the
//      browser. We then enrich the bare { user.id } with tenantId/roles via
//      getWebSession(), so tRPC's protectedProcedure can rely on a complete
//      Session.
//   2. Fall back to createContext's built-in JWT extraction
//      (getSessionFromRequest) — kept for stateless clients (WebSocket,
//      external API clients) that ship a "trello_session" cookie / Bearer.
//
// tenantId resolution: callers can pass `x-workspace-id` header or `tenantId`
// query string. Otherwise getWebSession falls back to the user's personal
// workspace.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "@repo/api";
import { getWebSession, tenantHintFromRequest } from "@/auth/getServerSession";

const handler = async (req: Request) => {
  const tenantHint = tenantHintFromRequest(req);
  const webSession = await getWebSession(tenantHint);

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async ({ req: fetchReq }) =>
      createContext({
        req: fetchReq,
        // If Auth.js produced a session, hand it through directly.
        // Otherwise let createContext attempt JWT/Bearer fallback.
        session: webSession ?? undefined,
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      }),
  });
};

export { handler as GET, handler as POST };
