// apps/ws-server/src/__tests__/e2e-smoke.test.ts
//
// ─── E2E Smoke Test ──────────────────────────────────────────────────────────
// Validates the full realtime pipeline:
//   1. Insert event into outbox_events (simulates tRPC mutation writing to outbox)
//   2. Outbox Worker polls and publishes to Redis
//   3. WS Server receives Redis message and fans out to subscribed client
//   4. Client receives the event with correct sequence + payload
//
// Requirements to run:
//   - PostgreSQL running with DATABASE_URL set
//   - Redis running with REDIS_URL set (default: redis://localhost:6379)
//   - WS Server running on port 3001 (or WS_PORT)
//   - Outbox Worker running
//
// Run: pnpm vitest run apps/ws-server/src/__tests__/e2e-smoke.test.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { Redis } from "ioredis";
import postgres from "postgres";

// ============================================================================
// Config
// ============================================================================

const WS_URL      = process.env.WS_URL || "ws://localhost:3001";
const REDIS_URL   = process.env.REDIS_URL || "redis://localhost:6379";
const DB_URL      = process.env.DATABASE_URL!;
const TEST_BOARD  = "00000000-0000-0000-0000-000000000001";
const TIMEOUT_MS  = 10_000;

// ============================================================================
// Helpers
// ============================================================================

function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS message")), timeoutMs);

    const handler = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener("message", handler);
          resolve(msg);
        }
      } catch { /* ignore non-JSON */ }
    };

    ws.on("message", handler);
  });
}

function sendWs(ws: WebSocket, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify(payload));
}

// ============================================================================
// Test Suite
// ============================================================================

describe("E2E Smoke: mutation → outbox → Redis → WS → client", () => {
  let ws: WebSocket;
  let sql: ReturnType<typeof postgres>;
  let redis: Redis;

  beforeAll(async () => {
    if (!DB_URL) throw new Error("DATABASE_URL required for E2E test");

    sql = postgres(DB_URL, { prepare: false, max: 1 });
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

    // Connect WS client
    ws = await connectWs();
  });

  afterAll(async () => {
    ws?.close();
    await redis?.quit();
    await sql?.end();
  });

  // ==========================================================================
  // Test 1: Subscribe and receive SYSTEM/SUBSCRIBED ack
  // ==========================================================================

  it("receives SUBSCRIBED ack after subscribe", async () => {
    const ackPromise = waitForMessage(ws, (msg) => msg.type === "SYSTEM" && msg.meta?.reason === "SUBSCRIBED");

    sendWs(ws, { action: "subscribe", boardId: TEST_BOARD, lastSequence: "0" });

    const ack = await ackPromise;
    expect(ack.type).toBe("SYSTEM");
    expect(ack.meta.reason).toBe("SUBSCRIBED");
    expect(ack.meta.connectionId).toBeDefined();
  });

  // ==========================================================================
  // Test 2: Full pipeline — insert outbox event → WS delivers it
  // ==========================================================================

  it("delivers event from outbox_events through Redis to WS client", async () => {
    const eventId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const testSequence = 999_001; // high sequence to avoid collision

    // ── Step 1: Insert an unprocessed outbox event (simulates BoardService) ──
    await sql`
      INSERT INTO outbox_events (event_id, aggregate_id, aggregate_type, type, sequence, payload, correlation_id, event_version, occurred_at)
      VALUES (
        ${eventId},
        ${TEST_BOARD},
        'Board',
        'card.created',
        ${testSequence},
        ${JSON.stringify({ cardId: "test-card-1", listId: "test-list-1", boardId: TEST_BOARD, title: "Smoke Test Card", position: "U" })}::jsonb,
        ${correlationId},
        'v2',
        NOW()
      )
    `;

    // ── Step 2: Wait for the event to arrive via WebSocket ───────────────────
    // The outbox-worker will pick it up, publish to Redis, WS server fans out.
    const eventMsg = await waitForMessage(
      ws,
      (msg) => msg.type === "EVENT" && msg.sequence === String(testSequence),
      TIMEOUT_MS,
    );

    // ── Step 3: Validate the received event matches what we inserted ─────────
    expect(eventMsg.type).toBe("EVENT");
    expect(eventMsg.sequence).toBe(String(testSequence));
    expect(eventMsg.payload).toBeDefined();
    expect(eventMsg.payload.type).toBe("card.created");
    expect(eventMsg.payload.correlationId).toBe(correlationId);
    expect(eventMsg.payload.payload.cardId).toBe("test-card-1");
    expect(eventMsg.payload.payload.title).toBe("Smoke Test Card");

    // ── Step 4: Verify outbox event was marked as processed ──────────────────
    const [row] = await sql`
      SELECT processed_at FROM outbox_events WHERE event_id = ${eventId}
    `;
    expect(row?.processed_at).not.toBeNull();
  });

  // ==========================================================================
  // Test 3: Sequence filtering — old events are NOT delivered
  // ==========================================================================

  it("does NOT deliver events with sequence <= client lastSequence", async () => {
    // Client is subscribed with lastSequence updated to 999_001 from Test 2.
    // Insert an event with a LOWER sequence — it should never arrive.
    const oldEventId = crypto.randomUUID();
    const oldSequence = 100; // way below client's watermark

    await sql`
      INSERT INTO outbox_events (event_id, aggregate_id, aggregate_type, type, sequence, payload, event_version, occurred_at)
      VALUES (
        ${oldEventId},
        ${TEST_BOARD},
        'Board',
        'card.updated',
        ${oldSequence},
        ${JSON.stringify({ cardId: "old-card", changes: {} })}::jsonb,
        'v2',
        NOW()
      )
    `;

    // Wait briefly — if the event arrives, the test fails.
    const received = await Promise.race([
      waitForMessage(ws, (msg) => msg.type === "EVENT" && msg.sequence === String(oldSequence), 3000)
        .then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);

    expect(received).toBe(false);

    // Cleanup
    await sql`DELETE FROM outbox_events WHERE event_id = ${oldEventId}`;
  });

  // ==========================================================================
  // Test 4: Heartbeat — ping/pong keeps connection alive
  // ==========================================================================

  it("responds to ping with HEARTBEAT message", async () => {
    const heartbeatPromise = waitForMessage(ws, (msg) => msg.type === "HEARTBEAT", 5000);

    sendWs(ws, { action: "ping", boardId: TEST_BOARD });

    const hb = await heartbeatPromise;
    expect(hb.type).toBe("HEARTBEAT");
    expect(hb.meta.timestamp).toBeDefined();
  });

  // ==========================================================================
  // Test 5: Direct Redis publish (bypass outbox-worker) — validates WS fanout
  // ==========================================================================

  it("WS server forwards events published directly to Redis channel", async () => {
    const directSequence = 999_999;
    const directEventId = crypto.randomUUID();

    const eventPromise = waitForMessage(
      ws,
      (msg) => msg.type === "EVENT" && msg.sequence === String(directSequence),
      5000,
    );

    // Publish directly to Redis (simulates outbox-worker or any publisher)
    const channel = `board:${TEST_BOARD}:events`;
    await redis.publish(channel, JSON.stringify({
      eventId: directEventId,
      type: "list.created",
      sequence: directSequence,
      payload: { listId: "direct-list", boardId: TEST_BOARD, title: "Direct Test", position: "M" },
      correlationId: "direct-corr-1",
      occurredAt: new Date().toISOString(),
    }));

    const msg = await eventPromise;
    expect(msg.type).toBe("EVENT");
    expect(msg.sequence).toBe(String(directSequence));
    expect(msg.payload.type).toBe("list.created");
    expect(msg.payload.payload.listId).toBe("direct-list");
  });

  // ==========================================================================
  // Test 6: Unsubscribe stops event delivery
  // ==========================================================================

  it("stops delivering events after unsubscribe", async () => {
    // Unsubscribe
    sendWs(ws, { action: "unsubscribe", boardId: TEST_BOARD });

    // Wait a moment for the unsubscribe to be processed
    await new Promise((r) => setTimeout(r, 200));

    // Publish an event — should NOT arrive
    const channel = `board:${TEST_BOARD}:events`;
    await redis.publish(channel, JSON.stringify({
      eventId: crypto.randomUUID(),
      type: "card.deleted",
      sequence: 1_000_000,
      payload: { cardId: "should-not-arrive" },
      occurredAt: new Date().toISOString(),
    }));

    const received = await Promise.race([
      waitForMessage(ws, (msg) => msg.type === "EVENT" && msg.payload?.payload?.cardId === "should-not-arrive", 2000)
        .then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);

    expect(received).toBe(false);
  });
});
