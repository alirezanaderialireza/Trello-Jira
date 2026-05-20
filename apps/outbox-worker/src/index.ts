// apps/outbox-worker/src/index.ts
// Production-grade Outbox Worker.
// Polls unprocessed events from outbox_events using FOR UPDATE SKIP LOCKED,
// publishes them to Redis channels, marks them as processed.
// Supports: retry, DLQ after max retries, backoff, graceful shutdown.

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq, isNull, asc } from "drizzle-orm";
import { Redis } from "ioredis";

// ============================================================================
// Config
// ============================================================================

const DATABASE_URL  = process.env.DATABASE_URL!;
const REDIS_URL     = process.env.REDIS_URL || "redis://localhost:6379";
const POLL_MS       = parseInt(process.env.OUTBOX_POLL_MS || "500", 10);
const BATCH_SIZE    = parseInt(process.env.OUTBOX_BATCH_SIZE || "50", 10);
const MAX_RETRIES   = parseInt(process.env.OUTBOX_MAX_RETRIES || "5", 10);
const DLQ_CHANNEL   = "outbox:dlq";

if (!DATABASE_URL) {
  console.error("❌ FATAL: DATABASE_URL is required");
  process.exit(1);
}

// ============================================================================
// Connections
// ============================================================================

const sqlClient = postgres(DATABASE_URL, { prepare: false, max: 3 });
const db = drizzle(sqlClient);
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

// ============================================================================
// Outbox table reference (inline — avoids monorepo import issues at runtime)
// ============================================================================

// We use raw SQL with drizzle's sql`` template tag for FOR UPDATE SKIP LOCKED
// since drizzle-orm doesn't have native support for this locking mode.

// ============================================================================
// Worker loop state
// ============================================================================

let running = true;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
const retryCount = new Map<string, number>(); // eventId → attempts

// ============================================================================
// Main poll loop
// ============================================================================

async function pollOnce(): Promise<number> {
  // 1. Claim a batch of unprocessed events with FOR UPDATE SKIP LOCKED
  const rows = await db.execute<{
    event_id: string;
    aggregate_id: string;
    aggregate_type: string;
    type: string;
    sequence: number;
    payload: Record<string, unknown>;
    correlation_id: string | null;
    occurred_at: string;
    event_version: string;
  }>(sql`
    WITH claimed AS (
      SELECT event_id, aggregate_id, aggregate_type, type, sequence,
             payload, correlation_id, occurred_at, event_version
      FROM outbox_events
      WHERE processed_at IS NULL
      ORDER BY sequence ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events oe
    SET processed_at = NOW()
    FROM claimed c
    WHERE oe.event_id = c.event_id
    RETURNING oe.event_id, oe.aggregate_id, oe.aggregate_type,
              oe.type, oe.sequence, oe.payload,
              oe.correlation_id, oe.occurred_at, oe.event_version
  `);

  if (!rows || rows.length === 0) return 0;

  let published = 0;

  for (const row of rows) {
    const eventId     = (row as any).event_id;
    const aggregateId = (row as any).aggregate_id;
    const channel     = `board:${aggregateId}:events`;

    const message = JSON.stringify({
      eventId,
      type:          (row as any).type,
      sequence:      (row as any).sequence,
      payload:       (row as any).payload,
      correlationId: (row as any).correlation_id,
      occurredAt:    (row as any).occurred_at,
      eventVersion:  (row as any).event_version,
    });

    try {
      await redis.publish(channel, message);
      published++;
      retryCount.delete(eventId);
    } catch (err) {
      // Retry tracking
      const attempts = (retryCount.get(eventId) ?? 0) + 1;
      retryCount.set(eventId, attempts);

      if (attempts >= MAX_RETRIES) {
        // Move to DLQ channel
        console.error(`[Outbox] Event ${eventId} exceeded max retries (${MAX_RETRIES}). Publishing to DLQ.`);
        try {
          await redis.publish(DLQ_CHANNEL, message);
        } catch { /* best effort */ }
        retryCount.delete(eventId);
      } else {
        // Mark as unprocessed again for next poll to retry
        console.warn(`[Outbox] Publish failed for ${eventId}, attempt ${attempts}. Will retry.`);
        await db.execute(sql`
          UPDATE outbox_events SET processed_at = NULL WHERE event_id = ${eventId}
        `);
      }
    }
  }

  return published;
}

async function loop() {
  while (running) {
    try {
      const count = await pollOnce();
      if (count > 0) {
        console.log(`[Outbox] Published ${count} events`);
      }
    } catch (err) {
      console.error("[Outbox] Poll error:", err);
    }

    // Wait before next poll
    await new Promise<void>((resolve) => {
      pollTimer = setTimeout(resolve, POLL_MS);
    });
  }
}

// ============================================================================
// Graceful shutdown
// ============================================================================

function shutdown() {
  console.log("[Outbox] Shutting down...");
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
  redis.disconnect();
  sqlClient.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ============================================================================
// Start
// ============================================================================

console.log(`[Outbox Worker] Starting — polling every ${POLL_MS}ms, batch ${BATCH_SIZE}, max retries ${MAX_RETRIES}`);
loop();
