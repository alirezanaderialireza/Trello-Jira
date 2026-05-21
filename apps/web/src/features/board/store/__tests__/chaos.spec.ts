// apps/web/src/features/board/store/__tests__/chaos.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
// Task #4 — Chaos & Determinism Tests
//
// Scenarios:
//   C1. DROPPED EVENTS        — stream with gaps (sequences skipped)
//   C2. DUPLICATED EVENTS     — same event applied twice
//   C3. DELAYED ACK           — pending mutation that never receives ACK
//   C4. RECONNECT STORM       — rapid disconnect/reconnect cycles
//   C5. STALE SNAPSHOT CHAOS  — restoreSnapshot called with older-than-current data
//   C6. OUT-OF-ORDER DELIVERY — events arrive in wrong sequence order
//   C7. EMPTY STATE EDGE CASE — all reducers safe on minimal/empty state
//   C8. OVERFLOW BUFFER       — more than 50 buffered events
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyEvent } from "../event-application/dispatcher";
import { reconcileIncomingEvent } from "../event-application/reconcileIncomingEvent";
import { createBoardState } from "../test-utils/createBoardState";
import { generateBoardState, SeededRandom, resetEventSeq } from "../test-utils/generators";
import { assertAllInvariants, InvariantError } from "../invariants/boardInvariants";
import { createSnapshot } from "../mutations/core/createSnapshot";
import type { BoardStoreState, WsEvent } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";

// ============================================================================
// Helpers
// ============================================================================

function makeWsEvent(seq: number, type: string, payload: Record<string, unknown>): WsEvent {
  return {
    sequence: String(seq),
    type,
    payload: {
      id: `evt-${seq}`,
      type,
      version: 2,
      occurredAt: new Date().toISOString(),
      aggregateId: "c1",
      aggregateType: "card",
      correlationId: `corr-${seq}`,
      payload,
    } as any,
  };
}

function applyReconcile(state: BoardStoreState, wsEvent: WsEvent): BoardStoreState {
  const patch = reconcileIncomingEvent(state as any, wsEvent);
  return patch ? { ...state, ...patch } : state;
}

function baseState(): BoardStoreState {
  return createBoardState({
    lists: {
      l1: { id: "l1", boardId: "b1", title: "L1", position: "a", revision: 1 },
      l2: { id: "l2", boardId: "b1", title: "L2", position: "b", revision: 1 },
    },
    cards: {
      c1: { id: "c1", boardId: "b1", listId: "l1", title: "C1", position: "a", revision: 1 },
      c2: { id: "c2", boardId: "b1", listId: "l2", title: "C2", position: "a", revision: 1 },
    },
    cardsByList: { l1: ["c1"], l2: ["c2"] },
    listOrder: ["l1", "l2"],
    boardSequence: "10",
  });
}

// ============================================================================
// C1 — DROPPED EVENTS (gaps in sequence)
// ============================================================================

describe("C1 — Dropped Events (sequence gaps)", () => {
  it("buffers out-of-order event and records gap_detected", () => {
    const state = baseState(); // seq=10
    // Skip seq 11, send seq 12
    const gapEvent = makeWsEvent(12, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "After Gap" },
    });
    const next = applyReconcile(state, gapEvent);

    // Should buffer, not apply
    expect(next.boardSequence).toBe("10");
    expect(next.syncStatus).toBe("catching_up");
    expect(next.bufferedEvents["12"]).toBeDefined();
    expect(next.cards["c1"]?.title).toBe("C1"); // unchanged
  });

  it("drains buffer when gap-filling event arrives", () => {
    let state = baseState();

    // Arrive out-of-order
    state = applyReconcile(state, makeWsEvent(12, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "from-12" },
    }));
    state = applyReconcile(state, makeWsEvent(13, "card.updated", {
      cardId: "c2", boardId: "b1", changes: { title: "from-13" },
    }));

    // Fill the gap
    state = applyReconcile(state, makeWsEvent(11, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "from-11" },
    }));

    // Buffer should be drained, all three applied
    expect(state.boardSequence).toBe("13");
    expect(Object.keys(state.bufferedEvents).length).toBe(0);
    expect(state.syncStatus).toBe("synced");
  });

  it("state satisfies invariants after gap-fill", () => {
    let state = baseState();
    state = applyReconcile(state, makeWsEvent(12, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "T" },
    }));
    state = applyReconcile(state, makeWsEvent(11, "card.updated", {
      cardId: "c2", boardId: "b1", changes: { title: "T" },
    }));
    expect(() => assertAllInvariants(state)).not.toThrow();
  });
});

// ============================================================================
// C2 — DUPLICATED EVENTS
// ============================================================================

describe("C2 — Duplicated Events", () => {
  it("applying same WS event twice does not change state the second time", () => {
    let state = baseState();
    const event = makeWsEvent(11, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "Once" },
    });

    state = applyReconcile(state, event);
    const after1 = { ...state };

    // Apply same event again (duplicate)
    state = applyReconcile(state, event);
    const after2 = { ...state };

    // State must not change on duplicate
    expect(after1.boardSequence).toBe(after2.boardSequence);
    expect(after1.cards["c1"]?.title).toBe(after2.cards["c1"]?.title);
  });

  it("applying same reducer envelope twice is idempotent for card.created", () => {
    const { applyCardCreated } = require("../event-application/applyCardCreated");
    const state = baseState();
    const envelope: ClientEventEnvelope = {
      event: {
        id: "dup-1", type: "card.created", version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: "c3", aggregateType: "card", correlationId: "corr",
        payload: { cardId: "c3", listId: "l1", boardId: "b1", title: "Dup", position: "z" },
      } as any,
      optimistic: false, acknowledged: true,
    };

    const r1 = applyCardCreated({ ...state }, envelope, { mode: "live" });
    const s1 = { ...state, ...r1 };
    const r2 = applyCardCreated({ ...s1 }, envelope, { mode: "live" });
    const s2 = { ...s1, ...r2 };

    // c3 must appear exactly once in l1
    const count = s2.cardsByList["l1"]!.filter((id: string) => id === "c3").length;
    expect(count).toBe(1);
  });

  it("state satisfies invariants after duplicate application", () => {
    let state = baseState();
    const event = makeWsEvent(11, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "D" },
    });
    state = applyReconcile(state, event);
    state = applyReconcile(state, event); // duplicate
    expect(() => assertAllInvariants(state)).not.toThrow();
  });
});

// ============================================================================
// C3 — DELAYED ACK (pending mutation that never gets ACK)
// ============================================================================

describe("C3 — Delayed ACK / Never-ACK'd mutation", () => {
  it("pendingMutations does not grow unbounded with gcPendingMutations", () => {
    const { useBoardStore } = require("../useBoardStore");
    const store = useBoardStore.getState();

    // Register old pending mutations (older than 5 minutes)
    const OLD = Date.now() - 10 * 60 * 1000;
    store.initBoard(
      [{ id: "l1", title: "L", position: "a", revision: 1, cards: [] }],
      "0",
    );

    // Inject stale mutations directly
    useBoardStore.setState({
      pendingMutations: {
        "stale-1": { correlationId: "stale-1", type: "card.moved", createdAt: OLD, aggregateId: "x", retryCount: 0, status: "acked" },
        "stale-2": { correlationId: "stale-2", type: "card.created", createdAt: OLD, aggregateId: "y", retryCount: 0, status: "failed" },
        "active-3": { correlationId: "active-3", type: "card.updated", createdAt: Date.now(), aggregateId: "z", retryCount: 0, status: "pending" },
      },
    });

    useBoardStore.getState().gcPendingMutations();

    const remaining = Object.keys(useBoardStore.getState().pendingMutations);
    expect(remaining).not.toContain("stale-1");
    expect(remaining).not.toContain("stale-2");
    expect(remaining).toContain("active-3"); // still active — not GC'd
  });

  it("GC does not remove pending-status mutations even if old", () => {
    const { useBoardStore } = require("../useBoardStore");
    const OLD = Date.now() - 10 * 60 * 1000;

    useBoardStore.setState({
      pendingMutations: {
        "stuck": { correlationId: "stuck", type: "card.moved", createdAt: OLD, aggregateId: "x", retryCount: 0, status: "pending" },
      },
    });

    useBoardStore.getState().gcPendingMutations();
    // status=pending must NOT be GC'd (in-flight, no server response yet)
    expect(useBoardStore.getState().pendingMutations["stuck"]).toBeDefined();
  });
});

// ============================================================================
// C4 — RECONNECT STORM (rapid state resets)
// ============================================================================

describe("C4 — Reconnect Storm", () => {
  it("multiple rapid initBoard calls produce a valid final state", () => {
    const { useBoardStore } = require("../useBoardStore");

    const listData = [
      { id: "l1", title: "L1", position: "a", revision: 1, cards: [
        { id: "c1", boardId: "b1", listId: "l1", title: "C1", position: "a", revision: 1 },
      ]},
    ];

    // Simulate rapid reconnects
    for (let i = 0; i < 20; i++) {
      useBoardStore.getState().initBoard(listData, String(i * 10));
    }

    const final = useBoardStore.getState();
    expect(() => assertAllInvariants(final)).not.toThrow();
    expect(final.boardSequence).toBe("190"); // last initBoard call
    expect(final.cards["c1"]).toBeDefined();
  });

  it("bufferedEvents are cleared on initBoard (no stale buffer after reconnect)", () => {
    const { useBoardStore } = require("../useBoardStore");

    // Add some buffered events
    useBoardStore.setState({
      bufferedEvents: { "500": { sequence: "500", type: "X", payload: {} as any } },
      syncStatus: "catching_up",
    });

    useBoardStore.getState().initBoard([], "0");

    const s = useBoardStore.getState();
    expect(Object.keys(s.bufferedEvents).length).toBe(0);
    expect(s.syncStatus).toBe("synced");
  });
});

// ============================================================================
// C5 — STALE SNAPSHOT CHAOS
// ============================================================================

describe("C5 — Stale Snapshot Chaos", () => {
  it("restoreSnapshot with stale snapshot (lower revision) skips the entity", () => {
    const { useBoardStore } = require("../useBoardStore");

    useBoardStore.getState().initBoard(
      [{ id: "l1", title: "L1", position: "a", revision: 5, cards: [
        { id: "c1", boardId: "b1", listId: "l1", title: "Current", position: "a", revision: 5 },
      ]}],
      "100",
    );

    // Take a snapshot when revision=1 (older than current revision=5)
    const staleSnapshot = {
      cards: { c1: { id: "c1", boardId: "b1", listId: "l1", title: "Old Title", position: "a", revision: 1 } },
    };

    useBoardStore.getState().restoreSnapshot(staleSnapshot);

    // Card should NOT be rolled back (current revision > snapshot revision)
    expect(useBoardStore.getState().cards["c1"]?.title).toBe("Current");
    expect(useBoardStore.getState().cards["c1"]?.revision).toBe(5);
  });

  it("restoreSnapshot with newer snapshot replaces entity", () => {
    const { useBoardStore } = require("../useBoardStore");

    useBoardStore.getState().initBoard(
      [{ id: "l1", title: "L1", position: "a", revision: 2, cards: [
        { id: "c1", boardId: "b1", listId: "l1", title: "Before Rollback", position: "a", revision: 2 },
      ]}],
      "50",
    );

    const freshSnapshot = {
      cards: { c1: { id: "c1", boardId: "b1", listId: "l1", title: "Rolled Back", position: "a", revision: 2 } },
    };

    useBoardStore.getState().restoreSnapshot(freshSnapshot);
    expect(useBoardStore.getState().cards["c1"]?.title).toBe("Rolled Back");
  });

  it("state satisfies invariants after snapshot restore", () => {
    const state = generateBoardState({ seed: 11, cardCount: { min: 2, max: 4 } });
    const snapshot = createSnapshot(state, {
      cards: Object.keys(state.cards),
      lists: Object.keys(state.lists),
      includeListOrder: true,
    });

    // Simulate restoreSnapshot on the state itself (idempotent case)
    const nextCards = { ...state.cards };
    if (snapshot.cards) {
      for (const [id, snapCard] of Object.entries(snapshot.cards)) {
        nextCards[id] = snapCard;
      }
    }
    const restored: BoardStoreState = { ...state, cards: nextCards };
    expect(() => assertAllInvariants(restored)).not.toThrow();
  });
});

// ============================================================================
// C6 — OUT-OF-ORDER DELIVERY
// ============================================================================

describe("C6 — Out-of-Order Delivery", () => {
  it("applies events in correct sequence order despite arrival order", () => {
    let state = baseState(); // seq=10

    // Arrive: 14, 12, 13, 11 — fill from 11 onwards
    state = applyReconcile(state, makeWsEvent(14, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "T14" },
    }));
    state = applyReconcile(state, makeWsEvent(12, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "T12" },
    }));
    state = applyReconcile(state, makeWsEvent(13, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "T13" },
    }));

    // None applied yet — still at 10
    expect(state.boardSequence).toBe("10");
    expect(Object.keys(state.bufferedEvents).length).toBe(3);

    // Gap-fill: 11 arrives
    state = applyReconcile(state, makeWsEvent(11, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "T11" },
    }));

    // Now all should drain in order
    expect(state.boardSequence).toBe("14");
    expect(Object.keys(state.bufferedEvents).length).toBe(0);
    expect(() => assertAllInvariants(state)).not.toThrow();
  });
});

// ============================================================================
// C7 — EMPTY STATE EDGE CASES
// ============================================================================

describe("C7 — Empty State Edge Cases", () => {
  const empty = createBoardState({ boardSequence: "0" });

  it("applyCardMoved on empty state returns {}", () => {
    const { applyCardMoved } = require("../event-application/applyCardMoved");
    const env: ClientEventEnvelope = {
      event: {
        id: "e1", type: "card.moved", version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: "c1", aggregateType: "card",
        payload: { cardId: "c1", fromListId: "l1", toListId: "l2", boardId: "b1", oldPosition: "a", newPosition: "b" },
      } as any,
      optimistic: false,
    };
    expect(() => applyCardMoved(empty, env, { mode: "live" })).not.toThrow();
    expect(applyCardMoved(empty, env, { mode: "live" })).toEqual({});
  });

  it("applyCardDeleted on empty state returns {}", () => {
    const { applyCardDeleted } = require("../event-application/applyCardDeleted");
    const env: ClientEventEnvelope = {
      event: {
        id: "e2", type: "card.deleted", version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: "c1", aggregateType: "card",
        payload: { cardId: "c1", boardId: "b1" },
      } as any,
      optimistic: false,
    };
    expect(() => applyCardDeleted(empty, env, { mode: "live" })).not.toThrow();
    expect(applyCardDeleted(empty, env, { mode: "live" })).toEqual({});
  });

  it("reconcileIncomingEvent on empty state buffers future events", () => {
    const result = reconcileIncomingEvent(empty as any, makeWsEvent(5, "card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "T" },
    }));
    // seq 5 > seq 0+1=1 → buffered
    expect(result?.bufferedEvents?.["5"]).toBeDefined();
  });

  it("all invariants pass on empty state", () => {
    expect(() => assertAllInvariants(empty)).not.toThrow();
  });
});

// ============================================================================
// C8 — BUFFER OVERFLOW (> 50 buffered events)
// ============================================================================

describe("C8 — Buffer Overflow", () => {
  it("syncStatus becomes offline when buffer exceeds 50 events", () => {
    let state = baseState(); // seq=10

    // Send 55 events with gaps (11 is never sent)
    for (let seq = 12; seq < 68; seq++) {
      state = applyReconcile(state, makeWsEvent(seq, "card.updated", {
        cardId: "c1", boardId: "b1", changes: { title: `T${seq}` },
      }));
    }

    // After 50+ events buffered, syncStatus should be offline (= desynced)
    expect(Object.keys(state.bufferedEvents).length).toBeGreaterThan(50);
    expect(state.syncStatus).toBe("offline");
  });
});

// ============================================================================
// Cross-cutting: invariants survive ALL chaos scenarios
// ============================================================================

describe("Cross-cutting — invariants survive chaos", () => {
  it("random chaos sequence (seed=99) produces invariant-valid final state", () => {
    const { useBoardStore } = require("../useBoardStore");
    const rng = new SeededRandom(99);

    useBoardStore.getState().initBoard(
      [
        { id: "l1", title: "L1", position: "a", revision: 1, cards: [
          { id: "c1", boardId: "b1", listId: "l1", title: "C1", position: "a", revision: 1 },
          { id: "c2", boardId: "b1", listId: "l1", title: "C2", position: "b", revision: 1 },
        ]},
        { id: "l2", title: "L2", position: "b", revision: 1, cards: [] },
      ],
      "0",
    );

    let seq = 1;
    const operations = [
      () => useBoardStore.getState().moveCard("c1", "l1", "l2", 0, 0),
      () => useBoardStore.getState().updateCard("c2", { title: "Updated" }),
      () => useBoardStore.getState().addCard({ id: "c3", boardId: "b1", listId: "l1", title: "New", position: "c", revision: 0 }),
      () => useBoardStore.getState().initBoard(
        [{ id: "l1", title: "L1", position: "a", revision: 2, cards: [] }],
        String(seq * 10),
      ),
    ];

    for (let i = 0; i < 30; i++) {
      const op = rng.pick(operations);
      try { op(); } catch { /* chaos — ignore individual failures */ }
      seq++;
    }

    const final = useBoardStore.getState();
    expect(() => assertAllInvariants(final)).not.toThrow();
  });
});
