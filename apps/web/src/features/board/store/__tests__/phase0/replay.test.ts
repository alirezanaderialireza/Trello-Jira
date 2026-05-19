// apps/web/src/features/board/store/__tests__/phase0/replay.test.ts
//
// Phase-0 determinism gate.
//
// Guarantee: same snapshot + same events replayed N times = identical state.
// This is the prerequisite for Phase 1 realtime recovery.

import { describe, it, expect } from "vitest";
import { createBoardState }  from "../../test-utils/createBoardState";
import { replayEvents }      from "../../test-utils/replayEvents";
import type { ClientEventEnvelope } from "../../event-application/types";
import type {
  CardMovedEvent, CardCreatedEvent, CardUpdatedEvent,
  CardDeletedEvent, ListCreatedEvent,
} from "@repo/domain";

// ============================================================================
// Helpers
// ============================================================================

function card(id: string, listId: string, pos: string, rev = 1) {
  return { id, boardId: "b1", title: id, listId, position: pos, revision: rev };
}
function list(id: string, pos: string, rev = 1) {
  return { id, title: id, position: pos, revision: rev };
}
function env<T extends { type: string }>(event: T, optimistic = false): ClientEventEnvelope<T> {
  return { event: event as T, optimistic };
}

// ============================================================================
// Base snapshot
// ============================================================================

function makeSnapshot() {
  return createBoardState({
    lists:       { l1: list("l1", "a"), l2: list("l2", "b") },
    cards:       {
      c1: card("c1", "l1", "a"),
      c2: card("c2", "l1", "b"),
      c3: card("c3", "l2", "a"),
    },
    cardsByList: { l1: ["c1", "c2"], l2: ["c3"] },
    listOrder:   ["l1", "l2"],
  });
}

// ============================================================================
// Test suite
// ============================================================================

describe("replayEvents — determinism gate", () => {

  it("single event replayed 100x produces identical state", () => {
    const snap = makeSnapshot();
    const events: ClientEventEnvelope<CardMovedEvent>[] = [
      env({
        id: "e1", type: "card.moved", version: 2,
        occurredAt: "2024-01-01T00:00:00Z",
        aggregateId: "c1", aggregateType: "card",
        payload: { cardId: "c1", fromListId: "l1", toListId: "l2", newPosition: "z", boardId: "b1" },
      }),
    ];

    // Should not throw
    const r = replayEvents(snap, events, 100);
    expect(r.finalState.cards["c1"].listId).toBe("l2");
    expect(r.violations).toHaveLength(0);
  });

  it("sequence of 5 mixed events replayed 50x produces identical state", () => {
    const snap = makeSnapshot();

    const events = [
      // 1. move c1 from l1 to l2
      env<CardMovedEvent>({
        id: "e1", type: "card.moved", version: 2,
        occurredAt: "2024-01-01T00:00:00Z",
        aggregateId: "c1", aggregateType: "card",
        payload: { cardId: "c1", fromListId: "l1", toListId: "l2", newPosition: "m", boardId: "b1" },
      }),
      // 2. update c2 title
      env<CardUpdatedEvent>({
        id: "e2", type: "card.updated", version: 2,
        occurredAt: "2024-01-01T00:00:01Z",
        aggregateId: "c2", aggregateType: "card",
        payload: { cardId: "c2", boardId: "b1", changes: { title: "Updated" } },
      }),
      // 3. create new list
      env<ListCreatedEvent>({
        id: "e3", type: "list.created", version: 1,
        occurredAt: "2024-01-01T00:00:02Z",
        aggregateId: "l3", aggregateType: "list",
        payload: { listId: "l3", boardId: "b1", title: "Done", position: "c" },
      }),
      // 4. create new card in l3
      env<CardCreatedEvent>({
        id: "e4", type: "card.created", version: 1,
        occurredAt: "2024-01-01T00:00:03Z",
        aggregateId: "c4", aggregateType: "card",
        payload: { cardId: "c4", listId: "l3", boardId: "b1", title: "New Task", position: "a" },
      }),
      // 5. delete c3
      env<CardDeletedEvent>({
        id: "e5", type: "card.deleted", version: 2,
        occurredAt: "2024-01-01T00:00:04Z",
        aggregateId: "c3", aggregateType: "card",
        payload: { cardId: "c3", boardId: "b1" },
      }),
    ];

    const r = replayEvents(snap, events, 50);

    // Invariants clean throughout
    expect(r.violations).toHaveLength(0);

    // Correct final state
    expect(r.finalState.cards["c1"].listId).toBe("l2");
    expect(r.finalState.cards["c2"].title).toBe("Updated");
    expect(r.finalState.lists["l3"]).toBeDefined();
    expect(r.finalState.cards["c4"]).toBeDefined();
    expect(r.finalState.cards["c3"]).toBeUndefined();
  });

  it("stale events replayed are harmless (idempotency under replay)", () => {
    const snap = makeSnapshot();

    // Apply c1 move first
    const moveEvent = env<CardMovedEvent>({
      id: "e1", type: "card.moved", version: 2,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "c1", aggregateType: "card",
      payload: { cardId: "c1", fromListId: "l1", toListId: "l2", newPosition: "z", boardId: "b1" },
    });

    const r1 = replayEvents(snap, [moveEvent]);
    const advanced = r1.finalState;

    // Now replay the same event against the already-advanced state
    // It should be a no-op (stale)
    const r2 = replayEvents(advanced, [moveEvent]);
    expect(r2.finalState).toEqual(advanced);
    expect(r2.violations).toHaveLength(0);
  });

  it("replay preserves all invariants at every intermediate step", () => {
    const snap = makeSnapshot();

    const events = [
      env<CardCreatedEvent>({
        id: "e1", type: "card.created", version: 1,
        occurredAt: "2024-01-01T00:00:00Z",
        aggregateId: "c-new", aggregateType: "card",
        payload: { cardId: "c-new", listId: "l1", boardId: "b1", title: "X", position: "c" },
      }),
      env<CardMovedEvent>({
        id: "e2", type: "card.moved", version: 2,
        occurredAt: "2024-01-01T00:00:01Z",
        aggregateId: "c-new", aggregateType: "card",
        payload: { cardId: "c-new", fromListId: "l1", toListId: "l2", newPosition: "z", boardId: "b1" },
      }),
      env<CardDeletedEvent>({
        id: "e3", type: "card.deleted", version: 3,
        occurredAt: "2024-01-01T00:00:02Z",
        aggregateId: "c-new", aggregateType: "card",
        payload: { cardId: "c-new", boardId: "b1" },
      }),
    ];

    const r = replayEvents(snap, events);

    // 4 snapshots: initial + 3 events
    expect(r.snapshots).toHaveLength(4);

    // No invariant violations at any snapshot
    expect(r.violations).toHaveLength(0);

    // Card was created, moved, then deleted — not in final state
    expect(r.finalState.cards["c-new"]).toBeUndefined();
  });

  it("empty event list returns clone of original snapshot", () => {
    const snap = makeSnapshot();
    const r    = replayEvents(snap, []);
    expect(r.finalState).toEqual(snap);
    expect(r.violations).toHaveLength(0);
  });
});
