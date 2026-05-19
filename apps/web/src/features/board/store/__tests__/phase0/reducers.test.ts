// apps/web/src/features/board/store/__tests__/phase0/reducers.test.ts
//
// Phase-0 reducer correctness suite.
// Verifies: stale-safe, idempotent, deterministic, optimistic-aware.

import { describe, it, expect } from "vitest";
import { createBoardState }     from "../../test-utils/createBoardState";
import { applyCardMoved }       from "../../event-application/applyCardMoved";
import { applyCardCreated }     from "../../event-application/applyCardCreated";
import { applyCardUpdated }     from "../../event-application/applyCardUpdated";
import { applyCardDeleted }     from "../../event-application/applyCardDeleted";
import { applyListCreated }     from "../../event-application/applyListCreated";
import { applyListMoved }       from "../../event-application/applyListMoved";
import { applyListUpdated }     from "../../event-application/applyListUpdated";
import { applyListDeleted }     from "../../event-application/applyListDeleted";
import type { ClientEventEnvelope } from "../../event-application/types";
import type {
  CardMovedEvent, CardCreatedEvent, CardUpdatedEvent, CardDeletedEvent,
  ListCreatedEvent, ListMovedEvent, ListUpdatedEvent, ListDeletedEvent,
} from "@repo/domain";

// ── shared context ────────────────────────────────────────────────────────────
const CTX = { mode: "live" as const };

// ── helpers ───────────────────────────────────────────────────────────────────

function baseState() {
  return createBoardState({
    lists: {
      l1: { id: "l1", title: "Todo",    position: "a", revision: 1 },
      l2: { id: "l2", title: "Doing",   position: "b", revision: 1 },
    },
    cards: {
      c1: { id: "c1", boardId: "b1", listId: "l1", title: "Card 1", position: "a", revision: 1 },
      c2: { id: "c2", boardId: "b1", listId: "l1", title: "Card 2", position: "b", revision: 1 },
      c3: { id: "c3", boardId: "b1", listId: "l2", title: "Card 3", position: "a", revision: 1 },
    },
    cardsByList: { l1: ["c1", "c2"], l2: ["c3"] },
    listOrder:   ["l1", "l2"],
  });
}

function makeEnvelope<T extends { type: string }>(
  event: Omit<T, never>,
  optimistic = false,
): ClientEventEnvelope<T> {
  return { event: event as T, optimistic };
}

// ============================================================================
// applyCardMoved
// ============================================================================

describe("applyCardMoved", () => {
  const movedEvent = (version = 2): ClientEventEnvelope<CardMovedEvent> =>
    makeEnvelope({
      id: "e1", type: "card.moved", version,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "c1", aggregateType: "card",
      payload: { cardId: "c1", fromListId: "l1", toListId: "l2", newPosition: "z", boardId: "b1" },
    });

  it("moves card to target list", () => {
    const r = applyCardMoved(baseState(), movedEvent(), CTX);
    expect(r.cards!["c1"].listId).toBe("l2");
    expect(r.cardsByList!["l1"]).not.toContain("c1");
    expect(r.cardsByList!["l2"]).toContain("c1");
  });

  it("✅ stale-safe: drops event when revision <= current", () => {
    const r = applyCardMoved(baseState(), movedEvent(1), CTX); // version 1 == current
    expect(r).toEqual({});
  });

  it("✅ idempotent: applying twice gives same result", () => {
    const s  = baseState();
    const r1 = applyCardMoved(s,  movedEvent(), CTX);
    const s2 = { ...s, ...r1 } as typeof s;
    const r2 = applyCardMoved(s2, movedEvent(), CTX);
    // second apply is stale → {}; state unchanged
    expect(r2).toEqual({});
  });

  it("✅ replay-safe: missing card returns empty", () => {
    const r = applyCardMoved(baseState(),
      makeEnvelope({
        id: "e2", type: "card.moved", version: 2,
        occurredAt: "2024-01-01T00:00:00Z",
        aggregateId: "missing", aggregateType: "card",
        payload: { cardId: "missing", fromListId: "l1", toListId: "l2", newPosition: "z", boardId: "b1" },
      }),
      CTX,
    );
    expect(r).toEqual({});
  });

  it("✅ deterministic: sort by position then id", () => {
    // c3 is already in l2 at position "a"; moving c1 to l2 at position "a" → tie → c1 < c3
    const r = applyCardMoved(baseState(), movedEvent(), CTX);
    // c1 moved to "z", c3 stays at "a" → order: c3, c1
    expect(r.cardsByList!["l2"]).toEqual(["c3", "c1"]);
  });

  it("✅ does not mutate original state", () => {
    const s = baseState();
    const frozen = structuredClone(s);
    applyCardMoved(s, movedEvent(), CTX);
    expect(s).toEqual(frozen);
  });
});

// ============================================================================
// applyCardCreated
// ============================================================================

describe("applyCardCreated", () => {
  const createdEnv = (version = 1): ClientEventEnvelope<CardCreatedEvent> =>
    makeEnvelope({
      id: "e3", type: "card.created", version,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "c-new", aggregateType: "card",
      payload: { cardId: "c-new", listId: "l1", boardId: "b1", title: "New", position: "aa" },
    });

  it("inserts card into list and cards map", () => {
    const r = applyCardCreated(baseState(), createdEnv(), CTX);
    expect(r.cards!["c-new"]).toBeDefined();
    expect(r.cardsByList!["l1"]).toContain("c-new");
  });

  it("✅ stale-safe: drops when card already exists with same or higher revision", () => {
    const s = { ...baseState(), cards: { ...baseState().cards, "c-new": { id: "c-new", boardId: "b1", listId: "l1", title: "X", position: "aa", revision: 2 } } };
    const r = applyCardCreated(s, createdEnv(1), CTX); // event.version = 1 < 2
    expect(r).toEqual({});
  });

  it("✅ idempotent: duplicate insert does not add card twice", () => {
    const s  = baseState();
    const r1 = applyCardCreated(s,  createdEnv(), CTX);
    const s2 = { ...s, ...r1 } as typeof s;
    const r2 = applyCardCreated(s2, createdEnv(), CTX);
    expect(r2).toEqual({}); // stale → no-op
  });

  it("✅ optimistic flag propagated", () => {
    const r = applyCardCreated(
      baseState(),
      { ...createdEnv(), optimistic: true },
      CTX,
    );
    expect(r.cards!["c-new"].isOptimistic).toBe(true);
  });
});

// ============================================================================
// applyCardUpdated
// ============================================================================

describe("applyCardUpdated", () => {
  const updatedEnv = (version = 2): ClientEventEnvelope<CardUpdatedEvent> =>
    makeEnvelope({
      id: "e4", type: "card.updated", version,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "c1", aggregateType: "card",
      payload: { cardId: "c1", boardId: "b1", changes: { title: "Updated Title" } },
    });

  it("updates card title", () => {
    const r = applyCardUpdated(baseState(), updatedEnv(), CTX);
    expect(r.cards!["c1"].title).toBe("Updated Title");
    expect(r.cards!["c1"].revision).toBe(2);
  });

  it("✅ stale-safe: drops when version < current revision", () => {
    const r = applyCardUpdated(baseState(), updatedEnv(0), CTX);
    expect(r).toEqual({});
  });

  it("✅ stale-safe: accepts when version == current (optimistic write)", () => {
    // optimistic event carries same version as current entity (version=1, revision=1)
    const r = applyCardUpdated(baseState(), updatedEnv(1), CTX);
    expect(r.cards!["c1"].title).toBe("Updated Title");
  });

  it("✅ id cannot be overwritten by payload changes", () => {
    const env: ClientEventEnvelope<CardUpdatedEvent> = makeEnvelope({
      id: "e4", type: "card.updated", version: 2,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "c1", aggregateType: "card",
      payload: { cardId: "c1", boardId: "b1", changes: { id: "hijacked" } as any },
    });
    const r = applyCardUpdated(baseState(), env, CTX);
    expect(r.cards!["c1"].id).toBe("c1");
  });
});

// ============================================================================
// applyCardDeleted
// ============================================================================

describe("applyCardDeleted", () => {
  const deletedEnv = (version = 2): ClientEventEnvelope<CardDeletedEvent> =>
    makeEnvelope({
      id: "e5", type: "card.deleted", version,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "c1", aggregateType: "card",
      payload: { cardId: "c1", boardId: "b1" },
    });

  it("removes card from cards map and bucket", () => {
    const r = applyCardDeleted(baseState(), deletedEnv(), CTX);
    expect(r.cards!["c1"]).toBeUndefined();
    expect(r.cardsByList!["l1"]).not.toContain("c1");
  });

  it("✅ idempotent: card already deleted returns {}", () => {
    const s = baseState();
    const { c1: _, ...noC1 } = s.cards;
    const s2 = { ...s, cards: noC1 };
    const r  = applyCardDeleted(s2, deletedEnv(), CTX);
    expect(r).toEqual({});
  });

  it("✅ stale-safe: skips if card has higher revision (was recreated)", () => {
    const s = { ...baseState(), cards: { ...baseState().cards, c1: { ...baseState().cards.c1!, revision: 5 } } };
    const r = applyCardDeleted(s, deletedEnv(2), CTX); // event version 2 < 5
    expect(r).toEqual({});
  });
});

// ============================================================================
// applyListCreated
// ============================================================================

describe("applyListCreated", () => {
  const listEnv = (version = 1): ClientEventEnvelope<ListCreatedEvent> =>
    makeEnvelope({
      id: "e6", type: "list.created", version,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "l-new", aggregateType: "list",
      payload: { listId: "l-new", boardId: "b1", title: "New List", position: "c" },
    });

  it("adds list to lists map, listOrder and initialises empty bucket", () => {
    const r = applyListCreated(baseState(), listEnv(), CTX);
    expect(r.lists!["l-new"]).toBeDefined();
    expect(r.listOrder).toContain("l-new");
    expect(r.cardsByList!["l-new"]).toEqual([]);
  });

  it("✅ stale-safe: drops when list already exists with same revision", () => {
    const s = { ...baseState(), lists: { ...baseState().lists, "l-new": { id: "l-new", title: "X", position: "c", revision: 1 } } };
    const r = applyListCreated(s, listEnv(1), CTX);
    expect(r).toEqual({});
  });

  it("✅ deterministic: new list sorted by position", () => {
    const r = applyListCreated(baseState(), listEnv(), CTX); // position "c" > "b" > "a"
    expect(r.listOrder).toEqual(["l1", "l2", "l-new"]);
  });
});

// ============================================================================
// applyListMoved
// ============================================================================

describe("applyListMoved", () => {
  const listMovedEnv = (version = 2): ClientEventEnvelope<ListMovedEvent> =>
    makeEnvelope({
      id: "e7", type: "list.moved", version,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "l1", aggregateType: "list",
      payload: { listId: "l1", boardId: "b1", newPosition: "c" },
    });

  it("updates list position and re-sorts listOrder", () => {
    const r = applyListMoved(baseState(), listMovedEnv(), CTX);
    expect(r.lists!["l1"].position).toBe("c");
    // l2 is at "b", l1 moved to "c" → l2 first, l1 second
    expect(r.listOrder).toEqual(["l2", "l1"]);
  });

  it("✅ stale-safe: drops when revision >= event.version", () => {
    const r = applyListMoved(baseState(), listMovedEnv(1), CTX); // version 1 == revision 1
    expect(r).toEqual({});
  });
});

// ============================================================================
// applyListUpdated
// ============================================================================

describe("applyListUpdated", () => {
  const listUpdatedEnv = (version = 2): ClientEventEnvelope<ListUpdatedEvent> =>
    makeEnvelope({
      id: "e8", type: "list.updated", version,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "l1", aggregateType: "list",
      payload: { listId: "l1", boardId: "b1", changes: { title: "Renamed" } },
    });

  it("updates list title", () => {
    const r = applyListUpdated(baseState(), listUpdatedEnv(), CTX);
    expect(r.lists!["l1"].title).toBe("Renamed");
  });

  it("✅ accepts optimistic update with same version", () => {
    const r = applyListUpdated(baseState(), listUpdatedEnv(1), CTX);
    expect(r.lists!["l1"].title).toBe("Renamed");
  });

  it("✅ stale-safe: drops version < current revision", () => {
    const r = applyListUpdated(baseState(), listUpdatedEnv(0), CTX);
    expect(r).toEqual({});
  });
});

// ============================================================================
// applyListDeleted
// ============================================================================

describe("applyListDeleted", () => {
  const listDeletedEnv = (version = 2): ClientEventEnvelope<ListDeletedEvent> =>
    makeEnvelope({
      id: "e9", type: "list.deleted", version,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "l1", aggregateType: "list",
      payload: { listId: "l1", boardId: "b1" },
    });

  it("removes list, updates listOrder, cascades card deletion", () => {
    const r = applyListDeleted(baseState(), listDeletedEnv(), CTX);
    expect(r.lists!["l1"]).toBeUndefined();
    expect(r.listOrder).not.toContain("l1");
    expect(r.cardsByList!["l1"]).toBeUndefined();
    // c1 and c2 belonged to l1 — must be purged
    expect(r.cards!["c1"]).toBeUndefined();
    expect(r.cards!["c2"]).toBeUndefined();
    // c3 in l2 must survive
    expect(r.cards!["c3"]).toBeDefined();
  });

  it("✅ idempotent: already-deleted list returns {}", () => {
    const s    = baseState();
    const { l1: _, ...noL1 } = s.lists;
    const s2   = { ...s, lists: noL1 };
    const r    = applyListDeleted(s2, listDeletedEnv(), CTX);
    expect(r).toEqual({});
  });

  it("✅ stale-safe: drops when revision higher than event", () => {
    const s = { ...baseState(), lists: { ...baseState().lists, l1: { ...baseState().lists.l1!, revision: 5 } } };
    const r = applyListDeleted(s, listDeletedEnv(2), CTX);
    expect(r).toEqual({});
  });
});
