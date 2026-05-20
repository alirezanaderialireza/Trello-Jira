// apps/outbox-worker/src/rebalance-worker.ts
// LexoRank Rebalance Worker — runs alongside the outbox worker.
// Periodically scans for lists with dense position chains and rebalances them.

import "dotenv/config";
import postgres from "postgres";
import { Redis } from "ioredis";

// ============================================================================
// Config
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL!;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const SCAN_INTERVAL_MS = parseInt(process.env.REBALANCE_SCAN_MS || "60000", 10);
const POSITION_LENGTH_THRESHOLD = 48; // trigger rebalance when any position > this
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length;

if (!DATABASE_URL) { console.error("❌ DATABASE_URL required"); process.exit(1); }

const sql = postgres(DATABASE_URL, { prepare: false, max: 3 });
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

let running = true;

// ============================================================================
// Core rebalance logic
// ============================================================================

/** Generate evenly-spaced positions for `count` items. */
function generateBalancedPositions(count: number): string[] {
  if (count === 0) return [];
  const step = Math.floor(BASE / (count + 1));
  if (step <= 0) {
    // Multi-character needed for very large lists
    const positions: string[] = [];
    for (let i = 0; i < count; i++) {
      const segIdx = Math.floor(i / (BASE - 2));
      const itemIdx = i % (BASE - 2);
      const prefix = ALPHABET[Math.min(segIdx + 1, BASE - 1)];
      const suffix = ALPHABET[Math.min(itemIdx + 1, BASE - 1)];
      positions.push(prefix + suffix);
    }
    return positions;
  }
  return Array.from({ length: count }, (_, i) => ALPHABET[Math.min((i + 1) * step, BASE - 1)]!);
}

async function rebalanceList(listId: string, boardId: string, tenantId: string): Promise<number> {
  // 1. Fetch all cards in the list, ordered by current position
  const cards = await sql`
    SELECT id, position FROM cards
    WHERE list_id = ${listId} AND deleted_at IS NULL
    ORDER BY position ASC, id ASC
  `;

  if (cards.length === 0) return 0;

  // 2. Generate new balanced positions
  const newPositions = generateBalancedPositions(cards.length);

  // 3. Update all positions in a single transaction
  await sql.begin(async (tx) => {
    for (let i = 0; i < cards.length; i++) {
      await tx`
        UPDATE cards SET position = ${newPositions[i]}, updated_at = NOW()
        WHERE id = ${cards[i].id}
      `;
    }

    // 4. Bump board sequence so clients receive the update
    const [seqRow] = await tx`
      UPDATE boards SET current_sequence = current_sequence + 1, updated_at = NOW()
      WHERE id = ${boardId}
      RETURNING current_sequence
    `;

    // 5. Insert outbox event so clients get notified via WS
    await tx`
      INSERT INTO outbox_events (event_id, aggregate_id, aggregate_type, type, sequence, payload, event_version, occurred_at, correlation_id)
      VALUES (
        gen_random_uuid(),
        ${boardId},
        'Board',
        'list.rebalanced',
        ${seqRow.current_sequence},
        ${JSON.stringify({ listId, cardCount: cards.length, positions: Object.fromEntries(cards.map((c, i) => [c.id, newPositions[i]])) })}::jsonb,
        'v1',
        NOW(),
        gen_random_uuid()::text
      )
    `;
  });

  console.log(`[Rebalance] List ${listId}: rebalanced ${cards.length} cards`);
  return cards.length;
}

// ============================================================================
// Scan loop — finds lists with dense positions
// ============================================================================

async function scanOnce(): Promise<number> {
  // Find lists that have at least one card with position length > threshold
  const denseLists = await sql`
    SELECT DISTINCT c.list_id, c.board_id, c.tenant_id
    FROM cards c
    WHERE c.deleted_at IS NULL
      AND LENGTH(c.position) > ${POSITION_LENGTH_THRESHOLD}
    LIMIT 10
  `;

  if (denseLists.length === 0) return 0;

  let totalRebalanced = 0;
  for (const row of denseLists) {
    try {
      const count = await rebalanceList(row.list_id, row.board_id, row.tenant_id);
      totalRebalanced += count;
    } catch (err) {
      console.error(`[Rebalance] Failed for list ${row.list_id}:`, err);
    }
  }

  return totalRebalanced;
}

async function loop() {
  while (running) {
    try {
      const count = await scanOnce();
      if (count > 0) console.log(`[Rebalance] Total rebalanced: ${count} cards`);
    } catch (err) {
      console.error("[Rebalance] Scan error:", err);
    }
    await new Promise<void>((r) => setTimeout(r, SCAN_INTERVAL_MS));
  }
}

// ============================================================================
// Graceful shutdown
// ============================================================================

function shutdown() {
  console.log("[Rebalance] Shutting down...");
  running = false;
  redis.disconnect();
  sql.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ============================================================================
// Start
// ============================================================================

console.log(`[Rebalance Worker] Scanning every ${SCAN_INTERVAL_MS}ms, threshold: ${POSITION_LENGTH_THRESHOLD} chars`);
loop();
