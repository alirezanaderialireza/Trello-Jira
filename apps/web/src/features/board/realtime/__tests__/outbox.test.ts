// apps/web/src/features/board/realtime/__tests__/outbox.test.ts
//
// Phase-1.1 — OutboxProcessor tests
// Covers: enqueue, ack, nack, retry, backpressure, DLQ, rollback

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutboxProcessor, type OutboxCallbacks } from "../outbox";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeCallbacks(): { send: ReturnType<typeof vi.fn>; rollback: ReturnType<typeof vi.fn>; onPoison: ReturnType<typeof vi.fn> } & OutboxCallbacks {
  return {
    send:     vi.fn(),
    rollback: vi.fn(),
    onPoison: vi.fn(),
  };
}

function makeItem(id = "m1") {
  return {
    mutationId:    id,
    correlationId: `corr-${id}`,
    payload:       { type: "MUTATION", mutationId: id },
    boardId:       "b1",
  };
}

// ============================================================================

describe("OutboxProcessor — enqueue & ack", () => {
  it("enqueues and sends immediately when connected", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb, { maxRetries: 3 });
    ox.setConnected(true);

    const ok = ox.enqueue(makeItem("m1"));
    expect(ok).toBe(true);
    expect(cb.send).toHaveBeenCalledOnce();
    expect(ox.pendingCount).toBe(1);
  });

  it("does not send when not connected", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb);
    // connected = false by default
    ox.enqueue(makeItem("m1"));
    expect(cb.send).not.toHaveBeenCalled();
  });

  it("ack removes item from queue", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb);
    ox.setConnected(true);
    ox.enqueue(makeItem("m1"));
    expect(ox.pendingCount).toBe(1);

    ox.ack("m1");
    expect(ox.pendingCount).toBe(0);
  });

  it("ack for unknown mutationId is a no-op", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb);
    expect(() => ox.ack("ghost")).not.toThrow();
  });
});

describe("OutboxProcessor — nack & retry", () => {
  it("schedules retry on retryable nack", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb, { maxRetries: 3, retryBaseMs: 100 });
    ox.setConnected(true);
    ox.enqueue(makeItem("m1"));

    ox.nack("m1", "server error", true);

    // Item is still queued (with nextRetryAt in future)
    expect(ox.pendingCount).toBe(1);
    expect(ox.dlqItems).toHaveLength(0);
  });

  it("dead-letters on non-retryable nack", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb);
    ox.setConnected(true);
    ox.enqueue({ ...makeItem("m1"), rollbackSnapshot: { cards: {}, lists: {}, cardsByList: {}, listOrder: [] } });

    ox.nack("m1", "invalid_payload", false);

    expect(ox.pendingCount).toBe(0);
    expect(ox.dlqItems).toHaveLength(1);
    expect(cb.rollback).toHaveBeenCalledOnce();
    expect(cb.onPoison).toHaveBeenCalledOnce();
  });

  it("dead-letters after maxRetries exceeded", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb, { maxRetries: 2 });
    ox.setConnected(true);
    ox.enqueue(makeItem("m1"));

    // Exceed retries
    ox.nack("m1", "err", true);   // retryCount = 1
    ox.nack("m1", "err", true);   // retryCount = 2 — now at max
    ox.nack("m1", "err", true);   // should dead-letter

    expect(ox.dlqItems).toHaveLength(1);
    expect(ox.pendingCount).toBe(0);
  });
});

describe("OutboxProcessor — backpressure", () => {
  it("returns false when queue is at capacity", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb, { maxQueueSize: 2 });

    ox.enqueue(makeItem("m1"));
    ox.enqueue(makeItem("m2"));
    const result = ox.enqueue(makeItem("m3")); // should be rejected

    expect(result).toBe(false);
    expect(ox.isBackpressured).toBe(true);
    expect(ox.pendingCount).toBe(2);
  });
});

describe("OutboxProcessor — DLQ capacity", () => {
  it("trims oldest entries when DLQ exceeds maxDlqSize", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb, { maxRetries: 1, maxDlqSize: 2 });
    ox.setConnected(true);

    // Fill DLQ with 3 items — oldest should be trimmed
    for (const id of ["m1", "m2", "m3"]) {
      ox.enqueue(makeItem(id));
      ox.nack(id, "err", false);
    }

    expect(ox.dlqItems).toHaveLength(2);
  });
});

describe("OutboxProcessor — rollback on dead-letter", () => {
  it("calls rollback callback with the snapshot", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb);
    ox.setConnected(true);

    const snapshot = {
      cards: { c1: { id: "c1", boardId: "b1", title: "t", position: "a", listId: "l1", revision: 1 } },
      cardsByList: { l1: ["c1"] },
      lists: {},
      listOrder: [],
    };

    ox.enqueue({ ...makeItem("m1"), rollbackSnapshot: snapshot });
    ox.nack("m1", "perm fail", false);

    expect(cb.rollback).toHaveBeenCalledWith(snapshot, "corr-m1");
  });

  it("does NOT call rollback when no snapshot provided", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb);
    ox.setConnected(true);

    ox.enqueue(makeItem("m1")); // no rollbackSnapshot
    ox.nack("m1", "perm fail", false);

    expect(cb.rollback).not.toHaveBeenCalled();
  });
});

describe("OutboxProcessor — flush on connect", () => {
  it("sends queued items when setConnected(true) is called", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb);

    // Enqueue while disconnected
    ox.enqueue(makeItem("m1"));
    expect(cb.send).not.toHaveBeenCalled();

    // Connect — should flush
    ox.setConnected(true);
    expect(cb.send).toHaveBeenCalledOnce();
  });
});

describe("OutboxProcessor — destroy", () => {
  it("clears the queue on destroy", () => {
    const cb = makeCallbacks();
    const ox = new OutboxProcessor(cb);
    ox.enqueue(makeItem("m1"));
    ox.destroy();
    expect(ox.pendingCount).toBe(0);
  });
});
