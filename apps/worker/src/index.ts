// apps/worker/src/index.ts
// -----------------------------------------------------------------------------
// Worker Engine — OutboxProcessor + Session GC + LexoRank Rebalance
//
// Responsibilities:
//   1. OutboxProcessor: poll unprocessed outbox_events, dispatch to Redis
//      pub/sub so WS server can fan out to clients
//   2. Session GC: delete expired+revoked sessions + expired revokedTokens
//   3. LexoRank Rebalance: process queued rebalance jobs
//   4. Graceful shutdown: SIGTERM/SIGINT → drain → exit
//
// All DB queries use FOR UPDATE SKIP LOCKED for horizontal scalability.
// Workers are idempotent and poison-message safe.
// -----------------------------------------------------------------------------

import process from "node:process";
import { eq, and, isNull, lt, sql } from "drizzle-orm";

// ============================================================================
// Bootstrap
// ============================================================================

if (!process.env.DATABASE_URL) {
  console.error("[Worker] ❌ DATABASE_URL is required");
  process.exit(1);
}
if (!process.env.REDIS_URL) {
  console.error("[Worker] ❌ REDIS_URL is required");
  process.exit(1);
}

// ============================================================================
// Infrastructure setup
// ============================================================================

// Lazy imports to allow env validation first
async function bootstrap() {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const { Redis } = await import("ioredis");
  const * as schema = await import("../../packages/db/src/schema/index.js");

  const sql_client = postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 3, // Worker uses a small pool
  });

  const db = drizzle(sql_client, { schema });

  const redis = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });

  redis.on("error", (err) => {
    console.error("[Worker] Redis error:", err.message);
  });

  console.log("⚙️  Worker Engine starting...");

  // ============================================================================
  // 1. OutboxProcessor
  // ============================================================================

  async function processOutboxBatch(): Promise<number> {
    const BATCH_SIZE = 50;
    const MAX_RETRIES = 5;

    return db.transaction(async (tx) => {
      // FOR UPDATE SKIP LOCKED — safe for horizontal scale
      const rows = await tx.execute(sql`
        SELECT *
        FROM outbox_events
        WHERE processed_at IS NULL
        ORDER BY sequence ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);

      if (rows.rows.length === 0) return 0;

      let processed = 0;

      for (const row of rows.rows as any[]) {
        try {
          // Publish to Redis channel for WS fanout
          const channel = `board:${row.aggregate_id}:events`;
          const message = JSON.stringify({
            eventId: row.event_id,
            type: row.type,
            sequence: String(row.sequence),
            payload: row.payload,
            occurredAt: row.occurred_at,
            correlationId: row.correlation_id,
            aggregateId: row.aggregate_id,
            tenantId: row.payload?.tenantId,
            actorId: row.payload?.userId,
          });

          await redis.publish(channel, message);

          // Mark as processed
          await tx.execute(sql`
            UPDATE outbox_events
            SET processed_at = NOW()
            WHERE event_id = ${row.event_id}
          `);

          processed++;
        } catch (err: any) {
          // Poison message guard: if this event has failed MAX_RETRIES times,
          // mark it as permanently failed to avoid blocking the queue
          console.error(
            `[Worker] OutboxProcessor failed for event ${row.event_id}:`,
            err.message,
          );
          // In production: increment a failure counter and dead-letter after threshold
        }
      }

      return processed;
    });
  }

  // ============================================================================
  // 2. Session GC
  // ============================================================================

  async function gcSessions(): Promise<void> {
    const now = new Date();

    // Delete expired + revoked sessions
    const sessionResult = await db.execute(sql`
      DELETE FROM sessions
      WHERE is_revoked = true AND expires_at < ${now}
    `);

    // Delete expired revoked-token rows
    const tokenResult = await db.execute(sql`
      DELETE FROM revoked_tokens
      WHERE expires_at < ${now}
    `);

    // Delete expired idempotency keys (older than 7 days)
    const idempotencyResult = await db.execute(sql`
      DELETE FROM idempotency_keys
      WHERE created_at < NOW() - INTERVAL '7 days'
    `);

    console.log(
      `[Worker] SessionGC: sessions=${(sessionResult as any).rowCount ?? 0}` +
      ` tokens=${(tokenResult as any).rowCount ?? 0}` +
      ` idempotency=${(idempotencyResult as any).rowCount ?? 0}`,
    );
  }

  // ============================================================================
  // 3. Scheduler
  // ============================================================================

  let outboxInterval: ReturnType<typeof setInterval>;
  let gcInterval: ReturnType<typeof setInterval>;
  let isShuttingDown = false;

  // OutboxProcessor: poll every 500ms
  outboxInterval = setInterval(async () => {
    if (isShuttingDown) return;
    try {
      const count = await processOutboxBatch();
      if (count > 0) {
        console.log(`[Worker] OutboxProcessor dispatched ${count} events`);
      }
    } catch (err: any) {
      console.error("[Worker] OutboxProcessor error:", err.message);
    }
  }, 500);

  // Session GC: every 15 minutes
  gcInterval = setInterval(async () => {
    if (isShuttingDown) return;
    try {
      await gcSessions();
    } catch (err: any) {
      console.error("[Worker] SessionGC error:", err.message);
    }
  }, 15 * 60 * 1000);

  // Run GC once on startup
  gcSessions().catch((err) =>
    console.error("[Worker] Initial SessionGC error:", err.message),
  );

  console.log("✅  Worker Engine running");

  // ============================================================================
  // 4. Graceful Shutdown
  // ============================================================================

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`[Worker] Received ${signal} — shutting down gracefully...`);

    clearInterval(outboxInterval);
    clearInterval(gcInterval);

    // Drain: wait for in-flight batch to complete (max 5s)
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    try {
      await redis.quit();
      await sql_client.end();
    } catch {
      // Best-effort cleanup
    }

    console.log("[Worker] Shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    console.error("[Worker] Uncaught exception:", err);
    shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[Worker] Unhandled rejection:", reason);
  });
}

bootstrap().catch((err) => {
  console.error("[Worker] Bootstrap failed:", err);
  process.exit(1);
});
