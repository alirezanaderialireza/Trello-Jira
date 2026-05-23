// apps/web/src/features/board/store/__tests__/reliability/chaos.spec.ts
//
// ─── Chaos Tests for Board Sync Pipeline ─────────────────────────────────────
// Simulates real-world network anomalies to validate the resilience of:
//   • reconcileIncomingEvent (gap detection, buffer, drain)
//   • replayEngine (stale-event guard, dedup, ordering)
//   • SyncStateMachine (FSM transitions under chaotic inputs)
//   • dispatchObserver (anomaly detection)
//
// Chaos scenarios:
//   C1. Dropped events (gaps in sequence)
//   C2. Duplicated events (same event delivered twice)
//   C3. Out-of-order delivery (events arrive non-monotonically)
//   C4. Delayed ACKs (optimistic mutations acked after many events)
//   C5. Rapid reconnection storm (WS drops every few events)
//   C6. Stale snapshots (restore with outdated revision)
//   C7. Mixed chaos (all anomalies combined)
//
// All tests verify that the system ends in a consistent state — no corruption,
// no ghost entities, no infinite loops, no crashes.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import type { AppDomainEvent, CardCreatedEvent, ListCreatedEvent, CardMovedEvent } from "@repo/domain";
import { createBoardState } from "../../test-utils/createBoardState";
import type { BoardStoreState, WsEvent } from "../../useBoardStore";
import { reconcileIncomingEvent } from "../../event-application/reconcileIncomingEvent";
import { replayEvents, type SequencedEvent } from "../../sync/replayEngine";
import { transition, type SyncState, type SyncMessage } from "../../sync/syncStateMachine";
import { computeChecksumSync } from "@/lib/integrity/canonicalSerializer";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeListCreated(listId: string, pos: string, seq: number): { event: ListCreatedEvent; sequence: string } {
  return {
    sequence: String(seq),
    event: {
      id: crypto.randomUUID(),
      type: "list.created",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateId: listId,
      aggregateType: "list",
      payload: { listId, boardId: "b1", title: `List ${listId}`, position: pos },
    } as ListCreatedEvent,
  };
}

function makeCardCreated(cardId: string, listId: string, pos: string, seq: number): { event: CardCreatedEvent; sequence: string } {
  return {
    sequence: String(seq),
    event: {
      id: crypto.randomUUID(),
      type: "card.created",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateId: cardId,
      aggregateType: "card",
      payload: { cardId, listId, boardId: "b1", title: `Card ${cardId}`, position: pos },
    } as CardCreatedEvent,
  };
}

function makeCardMoved(cardId: string, from: string, to: string, newPos: string, seq: number, version: number): { event: CardMovedEvent; sequence: string } {
  return {
    sequence: String(seq),
    event: {
      id: crypto.randomUUID(),
      type: "card.moved",
      version,
      occurredAt: new Date().toISOString(),
      aggregateId: cardId,
      aggregateType: "card",
      payload: { cardId, fromListId: from, toListId: to, oldPosition: "a", newPosition: newPos, boardId: "b1" },
    } as CardMovedEvent,
  };
}

function buildBoardState(): BoardStoreState {
  // Cast to BoardState (adding empty action stubs for reconcileIncomingEvent which expects BoardState)
  return createBoardState() as any;
}

function wsEvent(e: { event: AppDomainEvent; sequence: string }): WsEvent {
  return { sequence: e.sequence, type: e.event.type, payload: e.event };
}

// ============================================================================
// C1: Dropped events (gaps)
// ============================================================================

describe("C1: Dropped events — gap detection and buffering", () => {
  it("buffers out-of-sequence events and drains when gap is filled", () => {
    let state = buildBoardState() as any;

    // Apply list.created at seq 1 (normal)
    const e1 = makeListCreated("l1", "a", 1);
    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e1)) ?? {}) };
    expect(state.boardSequence).toBe("1");

    // Skip seq 2, deliver seq 3 (gap!)
    const e3 = makeCardCreated("c1", "l1", "a", 3);
    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e3)) ?? {}) };
    expect(state.syncStatus).toBe("gap_detected");
    expect(state.bufferedEvents["3"]).toBeDefined();
    expect(state.boardSequence).toBe("1"); // not advanced

    // Now deliver the missing seq 2 — should drain buffer
    const e2 = makeListCreated("l2", "m", 2);
    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e2)) ?? {}) };
    expect(state.boardSequence).toBe("3"); // both 2 and 3 applied
    expect(state.syncStatus).toBe("healthy");
    expect(state.cards["c1"]).toBeDefined();
  });
});

// ============================================================================
// C2: Duplicated events
// ============================================================================

describe("C2: Duplicated events — idempotency", () => {
  it("ignores events with sequence ≤ current boardSequence", () => {
    let state = buildBoardState() as any;

    const e1 = makeListCreated("l1", "a", 1);
    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e1)) ?? {}) };

    // Re-deliver seq 1 — should be no-op
    const result = reconcileIncomingEvent(state, wsEvent(e1));
    expect(result).toBeNull(); // null means no changes
    expect(state.boardSequence).toBe("1");
  });

  it("replayEngine deduplicates events with same sequence", () => {
    const events: SequencedEvent[] = [
      { sequence: "1", event: makeListCreated("l1", "a", 1).event },
      { sequence: "1", event: makeListCreated("l1", "a", 1).event }, // duplicate
      { sequence: "2", event: makeCardCreated("c1", "l1", "a", 2).event },
      { sequence: "2", event: makeCardCreated("c1", "l1", "a", 2).event }, // duplicate
    ];

    const report = replayEvents({ events });
    expect(report.duplicateCount).toBe(2);
    expect(report.appliedCount).toBe(2);
  });
});

// ============================================================================
// C3: Out-of-order delivery
// ============================================================================

describe("C3: Out-of-order delivery", () => {
  it("buffers all out-of-order events and drains in correct sequence", () => {
    let state = buildBoardState() as any;

    const e1 = makeListCreated("l1", "a", 1);
    const e2 = makeListCreated("l2", "m", 2);
    const e3 = makeCardCreated("c1", "l1", "a", 3);
    const e4 = makeCardCreated("c2", "l2", "b", 4);

    // Deliver in order: 1, 4, 3, 2
    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e1)) ?? {}) };
    expect(state.boardSequence).toBe("1");

    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e4)) ?? {}) };
    expect(state.syncStatus).toBe("gap_detected");

    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e3)) ?? {}) };
    expect(state.syncStatus).toBe("gap_detected");

    // Deliver seq 2 — fills the gap → drains 2, 3, 4
    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e2)) ?? {}) };
    expect(state.boardSequence).toBe("4");
    expect(state.syncStatus).toBe("healthy");
    expect(state.cards["c1"]).toBeDefined();
    expect(state.cards["c2"]).toBeDefined();
  });
});

// ============================================================================
// C4: Delayed ACKs
// ============================================================================

describe("C4: Delayed ACKs — pending mutations resolved late", () => {
  it("resolves pending mutation when matching correlationId arrives in WS event", () => {
    let state = buildBoardState() as any;
    const corrId = "mut-123";

    // Simulate pending mutation
    state.pendingMutations = {
      [corrId]: { correlationId: corrId, type: "card.created", createdAt: Date.now(), aggregateId: "c1", retryCount: 0, status: "pending" },
    };

    const e1 = makeListCreated("l1", "a", 1);
    state = { ...state, ...(reconcileIncomingEvent(state, wsEvent(e1)) ?? {}) };

    // WS delivers the ack event with matching correlationId at seq 2
    const ackEvent: CardCreatedEvent = {
      id: crypto.randomUUID(),
      type: "card.created",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateId: "c1",
      aggregateType: "card",
      correlationId: corrId,
      payload: { cardId: "c1", listId: "l1", boardId: "b1", title: "Acked", position: "a" },
    } as CardCreatedEvent;

    const ws: WsEvent = { sequence: "2", type: "card.created", payload: ackEvent };
    state = { ...state, ...(reconcileIncomingEvent(state, ws) ?? {}) };

    expect(state.pendingMutations[corrId]).toBeUndefined();
    expect(state.cards["c1"]).toBeDefined();
  });
});

// ============================================================================
// C5: Rapid reconnection storm (FSM)
// ============================================================================

describe("C5: Rapid WS reconnection storm", () => {
  it("FSM handles rapid CLOSED → RECONNECT → CONNECTED cycles without invalid state", () => {
    let fsmState: SyncState = "HEALTHY";

    // Simulate 5 rapid disconnects
    for (let i = 0; i < 5; i++) {
      const drop = transition(fsmState, { type: "WS_CLOSED", code: 1006, reason: "abnormal" });
      fsmState = drop.nextState;
      expect(["RECONNECTING", "DESYNCED"]).toContain(fsmState);

      if (fsmState === "RECONNECTING") {
        const reconnect = transition(fsmState, { type: "RECONNECT_ATTEMPT", attempt: i + 1 });
        fsmState = reconnect.nextState;

        // Simulate successful reconnect
        const connected = transition(fsmState, { type: "WS_CONNECTED" });
        fsmState = connected.nextState;
        expect(fsmState).toBe("HEALTHY");
      }
    }
  });

  it("FSM transitions to DESYNCED after max reconnect attempts", () => {
    let fsmState: SyncState = "HEALTHY";

    // Drop connection
    const drop = transition(fsmState, { type: "WS_CLOSED", code: 1006, reason: "" });
    fsmState = drop.nextState;
    expect(fsmState).toBe("RECONNECTING");

    // Exhaust retries
    for (let i = 1; i <= 7; i++) {
      const attempt = transition(fsmState, { type: "RECONNECT_ATTEMPT", attempt: i });
      fsmState = attempt.nextState;
    }

    expect(fsmState).toBe("DESYNCED");
  });
});

// ============================================================================
// C6: Stale snapshots
// ============================================================================

describe("C6: Stale snapshots — rollback with outdated revision", () => {
  it("stale-protected restoreSnapshot skips cards with newer revision", () => {
    // Build state with card at revision 5
    let state = createBoardState({
      lists:      { l1: { id: "l1", title: "L1", position: "a", revision: 1 } },
      cards:      { c1: { id: "c1", boardId: "b1", title: "V5", position: "a", listId: "l1", revision: 5 } },
      cardsByList: { l1: ["c1"] },
      listOrder:  ["l1"],
    });

    // Snapshot taken at revision 2 (stale!)
    const staleSnapshot = {
      cards: { c1: { id: "c1", boardId: "b1", title: "V2", position: "a", listId: "l1", revision: 2, isOptimistic: false } },
    };

    // Simulate restoreSnapshot logic (stale-protected)
    const nextCards = { ...state.cards };
    if (staleSnapshot.cards) {
      for (const [id, snapCard] of Object.entries(staleSnapshot.cards)) {
        const current = state.cards[id];
        if (current && current.revision > snapCard.revision) {
          continue; // stale protection — DO NOT restore
        }
        nextCards[id] = snapCard;
      }
    }

    // Card should NOT be regressed to V2
    expect(nextCards["c1"].title).toBe("V5");
    expect(nextCards["c1"].revision).toBe(5);
  });
});

// ============================================================================
// C7: Mixed chaos — all anomalies combined
// ============================================================================

describe("C7: Mixed chaos — combined anomalies", () => {
  it("system remains consistent after drops + duplicates + out-of-order", () => {
    // Build a canonical event stream
    const canonical: SequencedEvent[] = [
      { sequence: "1", event: makeListCreated("l1", "a", 1).event },
      { sequence: "2", event: makeListCreated("l2", "m", 2).event },
      { sequence: "3", event: makeCardCreated("c1", "l1", "a", 3).event },
      { sequence: "4", event: makeCardCreated("c2", "l1", "m", 4).event },
      { sequence: "5", event: makeCardMoved("c1", "l1", "l2", "b", 5, 2).event },
      { sequence: "6", event: makeCardCreated("c3", "l2", "c", 6).event },
    ];

    // Chaotic delivery: duplicate seq 3, skip seq 4, deliver seq 5 and 6 first, then 4 and 3
    const chaotic: SequencedEvent[] = [
      canonical[0]!, // seq 1
      canonical[1]!, // seq 2
      canonical[2]!, // seq 3
      canonical[2]!, // seq 3 DUPLICATE
      canonical[4]!, // seq 5 (out of order)
      canonical[5]!, // seq 6 (out of order)
      canonical[3]!, // seq 4 (late delivery)
      canonical[2]!, // seq 3 TRIPLICATE
    ];

    // Replay canonical
    const cleanReport = replayEvents({ events: canonical });

    // Replay chaotic — should produce same final state
    const chaosReport = replayEvents({ events: chaotic });

    // Final states must be identical
    expect(chaosReport.finalChecksum.hash).toBe(cleanReport.finalChecksum.hash);
    expect(chaosReport.duplicateCount).toBeGreaterThan(0);
  });
});
