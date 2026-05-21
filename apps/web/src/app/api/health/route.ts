// apps/web/src/app/api/health/route.ts
// Next.js health endpoint for K8s probes and monitoring.

import { createContext, appRouter } from "@repo/api";

export async function GET() {
  try {
    const ctx = await createContext({});
    const caller = appRouter.createCaller(ctx);
    const result = await (caller as any).v1.system.health.check();
    const status = result.status === "unhealthy" ? 503 : 200;
    return new Response(JSON.stringify(result), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ status: "unhealthy", error: err.message }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
