// packages/api/src/routers/system/health.router.ts
// Production health check — DB, Redis, outbox lag.

import { router, publicProcedure } from "../../trpc";
import { sql } from "drizzle-orm";

type ServiceStatus = "healthy" | "degraded" | "unhealthy";

interface HealthResult {
  status: ServiceStatus;
  uptime: number;
  timestamp: string;
  checks: {
    database: { status: ServiceStatus; latencyMs: number; error?: string };
    redis: { status: ServiceStatus; latencyMs: number; error?: string };
    outboxLag: { status: ServiceStatus; unprocessedCount: number; oldestAgeSec?: number };
  };
}

const startTime = Date.now();

export const healthRouter = router({
  check: publicProcedure.query(async ({ ctx }): Promise<HealthResult> => {
    const timestamp = new Date().toISOString();
    const uptime = Date.now() - startTime;

    // DB check
    let dbCheck: HealthResult["checks"]["database"];
    try {
      const s = performance.now();
      await ctx.infra.db.execute(sql`SELECT 1`);
      const ms = Math.round(performance.now() - s);
      dbCheck = { status: ms < 500 ? "healthy" : "degraded", latencyMs: ms };
    } catch (e: any) { dbCheck = { status: "unhealthy", latencyMs: -1, error: e.message }; }

    // Redis check
    let redisCheck: HealthResult["checks"]["redis"];
    try {
      const s = performance.now();
      await ctx.infra.rateLimiter?.consume?.({ key: "__hc__", windowMs: 60000, max: 9999 });
      const ms = Math.round(performance.now() - s);
      redisCheck = { status: ms < 200 ? "healthy" : "degraded", latencyMs: ms };
    } catch (e: any) { redisCheck = { status: "unhealthy", latencyMs: -1, error: e.message }; }

    // Outbox lag
    let outboxCheck: HealthResult["checks"]["outboxLag"];
    try {
      const r = await ctx.infra.db.execute(sql`
        SELECT COUNT(*)::int AS cnt, EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at)))::int AS age
        FROM outbox_events WHERE processed_at IS NULL
      `);
      const row = (r as any[])[0] ?? { cnt: 0, age: 0 };
      const cnt = row.cnt ?? 0;
      const age = row.age ?? 0;
      let s: ServiceStatus = "healthy";
      if (cnt > 100 || age > 300) s = "degraded";
      if (cnt > 500 || age > 600) s = "unhealthy";
      outboxCheck = { status: s, unprocessedCount: cnt, oldestAgeSec: age };
    } catch { outboxCheck = { status: "unhealthy", unprocessedCount: -1 }; }

    const all = [dbCheck.status, redisCheck.status, outboxCheck.status];
    let overall: ServiceStatus = "healthy";
    if (all.includes("degraded")) overall = "degraded";
    if (all.includes("unhealthy")) overall = "unhealthy";

    return { status: overall, uptime, timestamp, checks: { database: dbCheck, redis: redisCheck, outboxLag: outboxCheck } };
  }),
});
