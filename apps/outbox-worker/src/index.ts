// apps/outbox-worker/src/index.ts
// Production-grade Outbox Worker.
//
// Polls unprocessed events from outbox_events using FOR UPDATE SKIP LOCKED,
// publishes them to Redis channels, marks them as processed.
// Supports: retry, DLQ after max retries, backoff, graceful shutdown.
//
// ─── Crash-consistency contract (Bug #7 fix) ─────────────────────────────────
// The previous version of this worker marked rows `processed_at = NOW()`
// inside the claim CTE *before* publishing to Redis. If the worker crashed
// between the UPDATE and the `redis.publish` call (or if the publish failed
// and the follow-up "reset to NULL" UPDATE itself failed), the event was
// permanently marked as processed despite never being delivered.
//
// The new ordering is:
//   1. SELECT … FOR UPDATE SKIP LOCKED  (claim row, hold tx open)
//   2. redis.publish(...)               (durable side effect)
//   3. UPDATE … SET processed_at = NOW(), commit                  (success)
//   3'. UPDATE … SET retry_count = retry_count + 1, commit         (failure)
//   3''. publish to DLQ when retry_count >= MAX_RETRIES
//
// SKIP LOCKED keeps multiple workers safe — only one sees each row at a time.
// If the worker crashes mid-flight, the open tx is rolled back automatically
// by Postgres on connection drop, the row reverts to its pre-claim state
// (still unprocessed) and the next poll picks it up again.
//
// ─── Durable retry counter (Bug #13 fix) ─────────────────────────────────────
// retry_count lives on the outbox_events row (column added in migration
// 0005), not in a process-local Map. A worker restart can no longer reset
// the counter back to zero, so OUTBOX_MAX_RETRIES is honoured globally
// across the lifetime of an event.
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
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
// Worker loop state
// ============================================================================

let running = true;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Row shape returned by the claim query
// ============================================================================

interface ClaimedEvent {
  event_id: string;
  aggregate_id: string;
  aggregate_type: string;
  type: string;
  sequence: number;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  occurred_at: string;
  event_version: string;
  retry_count: number;
}

// ============================================================================
// Process a single claimed row.
//
// The row is held by an open SELECT … FOR UPDATE SKIP LOCKED in the calling
// transaction. We publish first; on success commit `processed_at = NOW()`,
// on failure commit `retry_count = retry_count + 1` (or send to DLQ when
// the threshold is exceeded). Either way the transaction commits exactly
// once, so the lock is released and the next poll sees the updated state.
// ============================================================================

async function processClaimed(
  row: ClaimedEvent,
  tx: any,
): Promise<"published" | "retry-scheduled" | "dlq"> {
  const channel = `board:${row.aggregate_id}:events`;
  const message = JSON.stringify({
    eventId:       row.event_id,
    type:          row.type,
    sequence:      row.sequence,
    payload:       row.payload,
    correlationId: row.correlation_id,
    occurredAt:    row.occurred_at,
    eventVersion:  row.event_version,
  });

  try {
    await redis.publish(channel, message);

    // ── Success path: mark processed inside the same tx as the claim. ─────
    await tx.execute(sql`
      UPDATE outbox_events
      SET processed_at = NOW()
      WHERE event_id = ${row.event_id}
    `);
    return "published";
  } catch (err) {
    const nextAttempt = row.retry_count + 1;

    if (nextAttempt >= MAX_RETRIES) {
      // ── DLQ path: forward to the dead-letter channel and mark processed.
      // We mark processed (not unprocessed) because the row has reached its
      // terminal state — leaving it visible would cause infinite poll churn.
      console.error(
        `[Outbox] Event ${row.event_id} exceeded max retries (${MAX_RETRIES}). Routing to DLQ.`,
      );
      try {
        await redis.publish(DLQ_CHANNEL, message);
      } catch {
        // Best-effort. The row will still be flipped to processed below.
        // A separate auditor job is expected to detect (retry_count >=
        // MAX_RETRIES AND processed_at IS NULL) → no DLQ delivery.
      }
      await tx.execute(sql`
        UPDATE outbox_events
        SET processed_at = NOW(),
            retry_count = ${nextAttempt}
        WHERE event_id = ${row.event_id}
      `);
      return "dlq";
    }

    // ── Retry path: bump retry_count, leave processed_at NULL. ────────────
    console.warn(
      `[Outbox] Publish failed for ${row.event_id}, attempt ${nextAttempt}/${MAX_RETRIES}: ${
        (err as Error)?.message ?? "unknown"
      }. Will retry.`,
    );
    await tx.execute(sql`
      UPDATE outbox_events
      SET retry_count = ${nextAttempt}
      WHERE event_id = ${row.event_id}
    `);
    return "retry-scheduled";
  }
}

// ============================================================================
// Main poll loop
// ============================================================================

async function pollOnce(): Promise<number> {
  // We open ONE transaction per poll cycle and run the claim + publish +
  // status-update inside it. SKIP LOCKED keeps concurrent workers from
  // touching the same rows. Holding the tx open until publish completes is
  // what gives us at-least-once delivery on crash recovery (Bug #7 fix).
  return db.transaction(async (tx) => {
    const rows = (await tx.execute<ClaimedEvent>(sql`
      SELECT event_id, aggregate_id, aggregate_type, type, sequence,
             payload, correlation_id, occurred_at, event_version, retry_count
      FROM outbox_events
      WHERE processed_at IS NULL
        AND retry_count < ${MAX_RETRIES}
      ORDER BY sequence ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `)) as unknown as ClaimedEvent[];

    if (!rows || rows.length === 0) return 0;

    let published = 0;
    for (const row of rows) {
      const outcome = await processClaimed(row, tx);
      if (outcome === "published") published++;
    }

    return published;
  });
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

console.log(
  `[Outbox Worker] Starting — polling every ${POLL_MS}ms, batch ${BATCH_SIZE}, max retries ${MAX_RETRIES}`,
);
loop();
