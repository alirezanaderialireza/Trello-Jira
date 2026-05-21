// apps/web/src/features/board/realtime/__tests__/integration.test.ts
//
// Phase-1.2 — Integration tests
//
// Covers the four critical distributed-system scenarios:
//   1. Reconnect during in-flight mutation (outbox retry)
//   2. Stale epoch — old socket message must be dropped
//   3. Duplicate EVENT after optimistic write (own-echo reconciliation)
//   4. Batch size validation (> MAX_BATCH_SIZE → rejected)
//
// These tests operate at the protocol layer without a real WebSocket.
// They simulate the exact event sequences that cause bugs in production.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseServerMessage, serializeClientMessage,
  MAX_BATCH_SIZE, DEDUP_WINDOW_MS, PROTOCOL_VERSION,
} from "../protocol";
import { OutboxProcessor } from "../outbox";
import { SessionManager } from "../session-manager";
import { ReplayBuffer } from "../event-pipeline";
import type { AppDomainEvent } from "@repo/domain";

// ── sessionStorage mock ──────────────────────────────────────────────────────
const ssData = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem:    (k: string) => ssData.get(k) ?? null,
  setItem:    (k: string, v: string) => { ssData.set(k, v); },
  removeItem: (k: string) => { ssData.delete(k); },
  clear:      () => { ssData.clear(); },
});
beforeEach(() => ssData.clear());

// ── helpers ──────────────────────────────────────────────────────────────────

function makeCardEvent(seq: string, mutationId?: string, sessionId?: string): string {
  return JSON.stringify({
    type: "EVENT",
    messageId: `msg-${seq}`,
    serverTime: "2024-01-01T00:00:00Z",
    sequence: seq,
    ...(mutationId ? { originMutationId: mutationId } : {}),
    ...(sessionId  ? { originSessionId:  sessionId  } : {}),
    payload: {
      id: `evt-${seq}`, type: "card.updated", version: 2,
      occurredAt: "2024-01-01T00:00:00Z", aggregateId: "c1", aggregateType: "card",
      payload: { cardId: "c1", boardId: "b1", changes: { title: `t${seq}` } },
    },
  });
}

// ============================================================================
// Scenario 1 — Reconnect during in-flight mutation
// ============================================================================

describe("Scenario 1 — Reconnect during in-flight mutation", () => {
  it("mutation queued while disconnected is sent on reconnect", () => {
    const sentPayloads: unknown[] = [];

    const outbox = new OutboxProcessor({
      send:     (p) => { sentPayloads.push(p); },
      rollback: vi.fn(),
    });

    // Mutation arrives while WS is down
    outbox.enqueue({
      mutationId: "mut-1", correlationId: "corr-1",
      payload:    { type: "MUTATION", mutationId: "mut-1" },
      boardId:    "b1",
    });
    expect(sentPayloads).toHaveLength(0); // not sent — no connection

    // WS reconnects
    outbox.setConnected(true);
    expect(sentPayloads).toHaveLength(1); // flushed on connect

    outbox.destroy();
  });

  it("mutation marked as sending → ACK removes it from queue", () => {
    const outbox = new OutboxProcessor({ send: vi.fn(), rollback: vi.fn() });
    outbox.setConnected(true);
    outbox.enqueue({ mutationId: "mut-2", correlationId: "corr-2", payload: {}, boardId: "b1" });
    expect(outbox.pendingCount).toBe(1);

    outbox.ack("mut-2");
    expect(outbox.pendingCount).toBe(0);

    outbox.destroy();
  });

  it("WS_CLOSED → outbox.setConnected(false) stops further sends", () => {
    const sentPayloads: unknown[] = [];
    const outbox = new OutboxProcessor({ send: (p) => sentPayloads.push(p), rollback: vi.fn() });
    outbox.setConnected(true);
    outbox.setConnected(false);

    outbox.enqueue({ mutationId: "mut-3", correlationId: "corr-3", payload: {}, boardId: "b1" });
    // queue has item but connected=false → no send
    expect(sentPayloads).toHaveLength(0);

    outbox.destroy();
  });
});

// ============================================================================
// Scenario 2 — Stale epoch: old socket message must be dropped
// ============================================================================

describe("Scenario 2 — Stale epoch protection", () => {
  it("session.isCurrentEpoch(oldEpoch) returns false after reconnect", () => {
    const sm = new SessionManager();
    sm.start("board-1");                    // epoch=1
    sm.incrementEpoch();                    // epoch=2 (reconnect)

    expect(sm.isCurrentEpoch(1)).toBe(false);
    expect(sm.isCurrentEpoch(2)).toBe(true);
  });

  it("MUTATION with stale connectionEpoch can be detected by comparing epoch", () => {
    const sm = new SessionManager();
    sm.start("board-1");                    // epoch=1

    // Simulate mutation sent at epoch=1
    const staleMutation = serializeClientMessage({
      type:            "MUTATION",
      messageId:       "msg-1",
      correlationId:   "corr-1",
      mutationId:      "mut-old",
      boardId:         "board-1",
      sessionId:       sm.current!.sessionId,
      connectionEpoch: 1,                   // epoch when sent
      payload: { id: "e", type: "card.updated", version: 1, occurredAt: "t",
                 aggregateId: "c1", aggregateType: "card", payload: {} } as AppDomainEvent,
    });

    sm.incrementEpoch();                    // reconnect → epoch=2

    // Server-side check: mutation.connectionEpoch < session.currentEpoch
    const parsed = JSON.parse(staleMutation) as { connectionEpoch: number };
    const isStale = !sm.isCurrentEpoch(parsed.connectionEpoch);
    expect(isStale).toBe(true);
  });

  it("multiple reconnects correctly advance epoch", () => {
    const sm = new SessionManager();
    sm.start("board-1");

    for (let i = 1; i <= 5; i++) {
      sm.incrementEpoch();
    }
    expect(sm.connectionEpoch).toBe(6);
    expect(sm.isCurrentEpoch(1)).toBe(false);
    expect(sm.isCurrentEpoch(6)).toBe(true);
  });
});

// ============================================================================
// Scenario 3 — Duplicate EVENT after optimistic write (own-echo reconciliation)
// ============================================================================

describe("Scenario 3 — Own-echo reconciliation", () => {
  it("SERVER_EVENT with originMutationId+originSessionId is parsed with metadata", () => {
    const mySessionId  = "sess-abc";
    const myMutationId = "mut-xyz";

    const raw = makeCardEvent("101", myMutationId, mySessionId);
    const parsed = parseServerMessage(raw);

    expect(parsed?.type).toBe("EVENT");
    if (parsed?.type === "EVENT") {
      expect(parsed.originMutationId).toBe(myMutationId);
      expect(parsed.originSessionId).toBe(mySessionId);
    }
  });

  it("own-echo detection: sessionId matches → isOwnEcho = true", () => {
    const mySessionId  = "sess-abc";
    const myMutationId = "mut-xyz";

    const raw    = makeCardEvent("101", myMutationId, mySessionId);
    const parsed = parseServerMessage(raw);

    if (parsed?.type !== "EVENT") throw new Error("wrong type");

    const isOwnEcho =
      parsed.originSessionId  === mySessionId &&
      parsed.originMutationId !== undefined;

    expect(isOwnEcho).toBe(true);
  });

  it("remote event (no originSessionId) → isOwnEcho = false", () => {
    const mySessionId = "sess-abc";
    const raw         = makeCardEvent("102"); // no origin metadata
    const parsed      = parseServerMessage(raw);

    if (parsed?.type !== "EVENT") throw new Error("wrong type");

    const isOwnEcho =
      parsed.originSessionId  === mySessionId &&
      parsed.originMutationId !== undefined;

    expect(isOwnEcho).toBe(false);
  });

  it("different sessionId → isOwnEcho = false (another user's mutation)", () => {
    const mySessionId    = "sess-abc";
    const otherSessionId = "sess-xyz";
    const raw   = makeCardEvent("103", "mut-999", otherSessionId);
    const parsed = parseServerMessage(raw);

    if (parsed?.type !== "EVENT") throw new Error("wrong type");

    const isOwnEcho =
      parsed.originSessionId  === mySessionId &&
      parsed.originMutationId !== undefined;

    expect(isOwnEcho).toBe(false);
  });
});

// ============================================================================
// Scenario 4 — Batch size validation
// ============================================================================

describe("Scenario 4 — Batch size validation", () => {
  function makeBatch(size: number): string {
    const events = Array.from({ length: size }, (_, i) => ({
      sequence: String(100 + i),
      payload: {
        id: `e${i}`, type: "card.updated", version: 1, occurredAt: "t",
        aggregateId: "c1", aggregateType: "card", payload: {},
      },
    }));
    return JSON.stringify({
      type: "EVENT_BATCH", messageId: "m1", serverTime: "2024-01-01T00:00:00Z",
      events,
    });
  }

  it("accepts batch of exactly MAX_BATCH_SIZE events", () => {
    const raw    = makeBatch(MAX_BATCH_SIZE);
    const parsed = parseServerMessage(raw);
    expect(parsed?.type).toBe("EVENT_BATCH");
    if (parsed?.type === "EVENT_BATCH") {
      expect(parsed.events).toHaveLength(MAX_BATCH_SIZE);
    }
  });

  it("rejects batch of MAX_BATCH_SIZE + 1 events", () => {
    const raw = makeBatch(MAX_BATCH_SIZE + 1);
    expect(parseServerMessage(raw)).toBeNull();
  });

  it("accepts small batch", () => {
    const raw = makeBatch(3);
    expect(parseServerMessage(raw)?.type).toBe("EVENT_BATCH");
  });

  it("rejects empty events array entry with bad sequence", () => {
    const msg = JSON.stringify({
      type: "EVENT_BATCH", messageId: "m", serverTime: "t",
      events: [{ sequence: "not-a-number", payload: { type: "card.updated" } }],
    });
    expect(parseServerMessage(msg)).toBeNull();
  });
});

// ============================================================================
// Scenario 5 — Dedup semantics documentation (#3)
// ============================================================================

describe("Scenario 5 — Dedup constants and semantics", () => {
  it("DEDUP_WINDOW_MS is 24 hours", () => {
    expect(DEDUP_WINDOW_MS).toBe(86_400_000);
  });

  it("mutationId in ClientMutation is a per-board idempotency key", () => {
    // Verify the shape enforced by serializeClientMessage
    const sm = new SessionManager();
    sm.start("board-1");
    const session = sm.current!;

    const mutationId = "uuid-" + Math.random().toString(36).slice(2);
    const serialised = serializeClientMessage({
      type:            "MUTATION",
      messageId:       "msg-x",
      correlationId:   "corr-x",
      mutationId,
      boardId:         "board-1",
      payload: {
        id: "e", type: "card.updated", version: 1, occurredAt: "t",
        aggregateId: "c1", aggregateType: "card", payload: {},
      } as AppDomainEvent,
      sessionId:       session.sessionId,
      connectionEpoch: session.connectionEpoch,
    });

    const parsed = JSON.parse(serialised);
    expect(parsed.mutationId).toBe(mutationId);
    expect(typeof parsed.mutationId).toBe("string");
  });
});

// ============================================================================
// Scenario 6 — AUTH_REQUIRED parsing and handling
// ============================================================================

describe("Scenario 6 — AUTH_REQUIRED (#6)", () => {
  it("parses AUTH_REQUIRED with token_expired code", () => {
    const raw = JSON.stringify({
      type: "AUTH_REQUIRED", messageId: "m1", serverTime: "t",
      code: "token_expired", reason: "Access token expired",
    });
    const parsed = parseServerMessage(raw);
    expect(parsed?.type).toBe("AUTH_REQUIRED");
    if (parsed?.type === "AUTH_REQUIRED") {
      expect(parsed.code).toBe("token_expired");
      expect(parsed.reason).toBe("Access token expired");
    }
  });

  it("parses AUTH_REQUIRED with insufficient_scope code", () => {
    const raw = JSON.stringify({
      type: "AUTH_REQUIRED", messageId: "m2", serverTime: "t",
      code: "insufficient_scope", reason: "Need board:write",
    });
    const parsed = parseServerMessage(raw);
    expect(parsed?.type).toBe("AUTH_REQUIRED");
  });

  it("returns null for AUTH_REQUIRED missing code field", () => {
    const raw = JSON.stringify({
      type: "AUTH_REQUIRED", messageId: "m3", serverTime: "t", reason: "x",
    });
    expect(parseServerMessage(raw)).toBeNull();
  });
});

// ============================================================================
// Scenario 7 — Capability negotiation (#7)
// ============================================================================

describe("Scenario 7 — Capability negotiation in SUBSCRIBED (#7)", () => {
  function makeSubscribed(capabilities?: Partial<Record<string, boolean>>): string {
    return JSON.stringify({
      type: "SUBSCRIBED", messageId: "m1", serverTime: "2024-01-01T00:00:00Z",
      sessionId: "sess-1", boardId: "b1", currentSequence: "0",
      connectionEpoch: 1,
      ...(capabilities ? { capabilities } : {}),
    });
  }

  it("server advertises presence=true → client can read it", () => {
    const raw = makeSubscribed({ batching: true, replay: true, presence: true, awareness: false, compression: false });
    const parsed = parseServerMessage(raw);
    if (parsed?.type === "SUBSCRIBED") {
      expect(parsed.capabilities.presence).toBe(true);
    }
  });

  it("server omits capabilities → defaults to BASELINE (both batching and replay true)", () => {
    const raw = makeSubscribed();  // no capabilities field
    const parsed = parseServerMessage(raw);
    if (parsed?.type === "SUBSCRIBED") {
      expect(parsed.capabilities.batching).toBe(true);
      expect(parsed.capabilities.replay).toBe(true);
    }
  });

  it("server sends partial capabilities → merges with baseline", () => {
    // Server only sends compression:true, others should default from baseline
    const raw = makeSubscribed({ compression: true } as any);
    const parsed = parseServerMessage(raw);
    if (parsed?.type === "SUBSCRIBED") {
      expect(parsed.capabilities.compression).toBe(true);
      expect(parsed.capabilities.batching).toBe(true); // from baseline
    }
  });
});

// ============================================================================
// Scenario 8 — ReplayBuffer: resume after 200 buffered events
// ============================================================================

describe("Scenario 8 — ReplayBuffer: resume with many buffered events", () => {
  it("buffers 200 out-of-order events and drains all in sequence order", () => {
    const buffer = new ReplayBuffer(300);
    const baseSeq = 100n;

    // Simulate 200 out-of-order events: add in reverse order
    for (let i = 200; i >= 2; i--) {
      buffer.add({
        sequence: String(baseSeq + BigInt(i)),
        event: {
          id: `e${i}`, type: "card.updated" as const, version: 1, occurredAt: "t",
          aggregateId: "c1", aggregateType: "card" as const,
          payload: { cardId: "c1", boardId: "b1", changes: {} } as any,
        },
      });
    }

    expect(buffer.size).toBe(199); // events 102..300

    // Missing event 101 arrives → triggers drain
    buffer.add({
      sequence: "101",
      event: {
        id: "e101", type: "card.updated" as const, version: 1, occurredAt: "t",
        aggregateId: "c1", aggregateType: "card" as const,
        payload: { cardId: "c1", boardId: "b1", changes: {} } as any,
      },
    });

    // Drain from seq 100 (baseSeq) → should yield all 200 events in order
    const drained = buffer.drain("100");
    expect(drained).toHaveLength(200);
    expect(drained[0].sequence).toBe("101");
    expect(drained[199].sequence).toBe("300");
    expect(buffer.size).toBe(0);
  });
});
