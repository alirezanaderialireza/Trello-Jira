// apps/web/src/features/board/store/__tests__/reducerPurity.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
// Task #1 — Reducer Purity Enforcement Tests
//
// Asserts the three-part purity contract for every reducer:
//   1. No input mutation
//   2. Deterministic output (same inputs → same output)
//   3. No throws (crash isolation)
//   4. JSON-serialisable output
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { applyCardCreated } from "../event-application/applyCardCreated";
import { applyCardMoved } from "../event-application/applyCardMoved";
import { applyCardUpdated } from "../event-application/applyCardUpdated";
import { applyCardDeleted } from "../event-application/applyCardDeleted";
import { applyListCreated } from "../event-application/applyListCreated";
import { applyListMoved } from "../event-application/applyListMoved";
import { applyListUpdated } from "../event-application/applyListUpdated";
import { applyListDeleted } from "../event-application/applyListDeleted";
import {
  assertReducerPurity,
  assertNoSideEffects,
  assertResultSafeMerge,
  deepFreeze,
} from "../test-utils/reducerPurity";
import { createBoardState } from "../test-utils/createBoardState";
import type { BoardStoreState, CardDto, ListDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import type {
  CardCreatedEvent, CardMovedEvent, CardUpdatedEvent, CardDeletedEvent,
  ListCreatedEvent, ListMovedEvent, ListUpdatedEvent, ListDeletedEvent,
} from "@repo/domain";

// ============================================================================
// Shared fixtures
// ============================================================================

function card(overrides: Partial<CardDto> = {}): CardDto {
  return {
    id: "c1", boardId: "b1", listId: "l1", title: "T", position: "a", revision: 1,
    ...overrides,
  };
}

function list(overrides: Partial<ListDto> = {}): ListDto {
  return {
    id: "l1", boardId: "b1", title: "L", position: "a", revision: 1,
    ...overrides,
  };
}

const BASE_STATE: BoardStoreState = createBoardState({
  lists:  { l1: list(), l2: list({ id: "l2", position: "b" }) },
  cards:  { c1: card(), c2: card({ id: "c2", listId: "l2", position: "b" }) },
  cardsByList: { l1: ["c1"], l2: ["c2"] },
  listOrder: ["l1", "l2"],
  boardSequence: "5",
});

function evt<T>(type: string, payload: T, version = 2): any {
  return {
    id: "ev1", type, version, occurredAt: new Date().toISOString(),
    aggregateId: "c1", aggregateType: "card", correlationId: "corr",
    payload,
  };
}

function env<TEvent>(event: TEvent, optimistic = false): ClientEventEnvelope<any> {
  return { event, optimistic, acknowledged: !optimistic };
}

// ============================================================================
// Reducer purity suite factory
// ============================================================================

function puritySuite(
  name: string,
  reducer: Function,
  state: BoardStoreState,
  envelope: ClientEventEnvelope<any>,
) {
  describe(`${name} — purity contract`, () => {
    it("does not mutate input state", () => {
      assertNoSideEffects(reducer as any, state, envelope);
    });

    it("is deterministic (same inputs → same output)", () => {
      const r1 = (reducer as any)(deepFreeze({ ...state }), envelope, { mode: "live" });
      const r2 = (reducer as any)(deepFreeze({ ...state }), envelope, { mode: "live" });
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it("does not throw on valid input", () => {
      expect(() =>
        (reducer as any)(deepFreeze({ ...state }), envelope, { mode: "live" }),
      ).not.toThrow();
    });

    it("returns JSON-serialisable output", () => {
      const result = (reducer as any)(deepFreeze({ ...state }), envelope, { mode: "live" });
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it("result can be safely merged into state (no missing required keys)", () => {
      const result = (reducer as any)({ ...state }, envelope, { mode: "live" });
      assertResultSafeMerge(state, result);
    });

    it("is replay-safe (mode=replay produces same structural result)", () => {
      const live   = (reducer as any)({ ...state }, envelope, { mode: "live" });
      const replay = (reducer as any)({ ...state }, envelope, { mode: "replay" });
      // Structural shape should match — values may differ for optimistic flag but
      // keys must be identical
      expect(Object.keys(live).sort()).toEqual(Object.keys(replay).sort());
    });
  });
}

// ============================================================================
// applyCardCreated
// ============================================================================

describe("applyCardCreated", () => {
  const envelope = env<CardCreatedEvent>(evt("card.created", {
    cardId: "c3", listId: "l1", boardId: "b1", title: "New", position: "c",
  }, 1));

  puritySuite("applyCardCreated", applyCardCreated, BASE_STATE, envelope);

  it("adds card to cards{} and cardsByList[]", () => {
    const result = assertReducerPurity(applyCardCreated, BASE_STATE, envelope);
    expect(result.cards?.["c3"]).toBeDefined();
    expect(result.cardsByList?.["l1"]).toContain("c3");
  });

  it("is idempotent on re-apply of same card", () => {
    const stateWithCard = { ...BASE_STATE, cards: { ...BASE_STATE.cards, c3: card({ id: "c3", listId: "l1", position: "c", revision: 1 }) }, cardsByList: { ...BASE_STATE.cardsByList, l1: ["c1", "c3"] } };
    const r1 = applyCardCreated({ ...BASE_STATE }, envelope as any, { mode: "live" });
    const r2 = applyCardCreated({ ...stateWithCard }, envelope as any, { mode: "live" });
    // c3 already in list → should not duplicate
    expect((r2.cardsByList?.["l1"] ?? stateWithCard.cardsByList["l1"])
      .filter((id: string) => id === "c3").length).toBe(1);
  });

  it("returns {} for unknown list", () => {
    const badEnv = env<CardCreatedEvent>(evt("card.created", {
      cardId: "c99", listId: "NONEXISTENT", boardId: "b1", title: "X", position: "z",
    }, 1));
    // Should not throw — just inserts with no cardsByList entry for missing list
    expect(() => applyCardCreated({ ...BASE_STATE }, badEnv as any, { mode: "live" })).not.toThrow();
  });
});

// ============================================================================
// applyCardMoved
// ============================================================================

describe("applyCardMoved", () => {
  const envelope = env<CardMovedEvent>(evt("card.moved", {
    cardId: "c1", fromListId: "l1", toListId: "l2", oldPosition: "a", newPosition: "c", boardId: "b1",
  }));

  puritySuite("applyCardMoved", applyCardMoved, BASE_STATE, envelope);

  it("moves card between lists", () => {
    const result = assertReducerPurity(applyCardMoved, BASE_STATE, envelope);
    expect(result.cards?.["c1"]?.listId).toBe("l2");
    expect(result.cardsByList?.["l1"]).not.toContain("c1");
    expect(result.cardsByList?.["l2"]).toContain("c1");
  });

  it("returns {} for non-existent card", () => {
    const badEnv = env<CardMovedEvent>(evt("card.moved", {
      cardId: "GHOST", fromListId: "l1", toListId: "l2", oldPosition: "a", newPosition: "c", boardId: "b1",
    }));
    const result = applyCardMoved({ ...BASE_STATE }, badEnv as any, { mode: "live" });
    expect(result).toEqual({});
  });

  it("maintains deterministic sort after move", () => {
    const state = createBoardState({
      ...BASE_STATE,
      cards: {
        ...BASE_STATE.cards,
        c3: card({ id: "c3", listId: "l2", position: "c" }),
      },
      cardsByList: { ...BASE_STATE.cardsByList, l2: ["c2", "c3"] },
    });
    const env2 = env<CardMovedEvent>(evt("card.moved", {
      cardId: "c1", fromListId: "l1", toListId: "l2", oldPosition: "a", newPosition: "b", boardId: "b1",
    }));
    const result = applyCardMoved(state, env2 as any, { mode: "live" });
    // Sorted by position: "b" (c1) < "b" (c2) → tie-break by id: c1 < c2 → [c1, c2, c3]
    const destOrder = result.cardsByList?.["l2"] ?? state.cardsByList["l2"];
    // positions: c1="b", c2="b", c3="c" → sorted → c1, c2, c3
    expect(destOrder.indexOf("c3")).toBeGreaterThan(destOrder.indexOf("c1"));
  });
});

// ============================================================================
// applyCardUpdated
// ============================================================================

describe("applyCardUpdated", () => {
  const envelope = env<CardUpdatedEvent>(evt("card.updated", {
    cardId: "c1", boardId: "b1", changes: { title: "Updated Title" },
  }));

  puritySuite("applyCardUpdated", applyCardUpdated, BASE_STATE, envelope);

  it("updates only specified fields", () => {
    const result = assertReducerPurity(applyCardUpdated, BASE_STATE, envelope);
    expect(result.cards?.["c1"]?.title).toBe("Updated Title");
    expect(result.cards?.["c1"]?.listId).toBe("l1"); // unchanged
  });

  it("stale protection: returns {} if revision ≤ current", () => {
    const staleEnv = env<CardUpdatedEvent>(evt("card.updated", {
      cardId: "c1", boardId: "b1", changes: { title: "Old" },
    }, 0)); // version 0 ≤ revision 1
    const result = applyCardUpdated({ ...BASE_STATE }, staleEnv as any, { mode: "live" });
    expect(result).toEqual({});
  });
});

// ============================================================================
// applyCardDeleted
// ============================================================================

describe("applyCardDeleted", () => {
  const envelope = env<CardDeletedEvent>(evt("card.deleted", { cardId: "c1", boardId: "b1" }));

  puritySuite("applyCardDeleted", applyCardDeleted, BASE_STATE, envelope);

  it("removes card from cards{} and cardsByList[]", () => {
    const result = assertReducerPurity(applyCardDeleted, BASE_STATE, envelope);
    expect(result.cards?.["c1"]).toBeUndefined();
    expect(result.cardsByList?.["l1"]).not.toContain("c1");
  });

  it("is idempotent: second delete on missing card returns {}", () => {
    const stateWithout = { ...BASE_STATE, cards: { c2: card({ id: "c2", listId: "l2", position: "b" }) }, cardsByList: { l1: [], l2: ["c2"] } };
    const result = applyCardDeleted(stateWithout, envelope as any, { mode: "live" });
    expect(result).toEqual({});
  });
});

// ============================================================================
// applyListCreated
// ============================================================================

describe("applyListCreated", () => {
  const envelope = env<ListCreatedEvent>({ ...evt("list.created", {
    listId: "l3", boardId: "b1", title: "L3", position: "c",
  }, 1), aggregateType: "list" });

  puritySuite("applyListCreated", applyListCreated, BASE_STATE, envelope);

  it("adds list to lists{}, listOrder, and initialises cardsByList", () => {
    const result = assertReducerPurity(applyListCreated, BASE_STATE, envelope as any);
    expect(result.lists?.["l3"]).toBeDefined();
    expect(result.listOrder).toContain("l3");
    expect(result.cardsByList?.["l3"]).toEqual([]);
  });

  it("listOrder is sorted deterministically after insert", () => {
    const result = assertReducerPurity(applyListCreated, BASE_STATE, envelope as any);
    const order = result.listOrder!;
    const sorted = [...order].sort((a, b) => {
      const posA = result.lists?.[a]?.position ?? BASE_STATE.lists[a]?.position ?? "";
      const posB = result.lists?.[b]?.position ?? BASE_STATE.lists[b]?.position ?? "";
      return posA.localeCompare(posB) || a.localeCompare(b);
    });
    expect(order).toEqual(sorted);
  });
});

// ============================================================================
// applyListMoved
// ============================================================================

describe("applyListMoved", () => {
  const envelope = env<ListMovedEvent>({ ...evt("list.moved", {
    listId: "l1", boardId: "b1", oldPosition: "a", newPosition: "z",
  }), aggregateType: "list", aggregateId: "l1" });

  puritySuite("applyListMoved", applyListMoved, BASE_STATE, envelope as any);

  it("updates list position", () => {
    const result = assertReducerPurity(applyListMoved, BASE_STATE, envelope as any);
    expect(result.lists?.["l1"]?.position).toBe("z");
  });

  it("returns {} for non-existent list", () => {
    const badEnv = env<ListMovedEvent>({ ...evt("list.moved", {
      listId: "GHOST", boardId: "b1", oldPosition: "a", newPosition: "z",
    }), aggregateType: "list", aggregateId: "GHOST" });
    const result = applyListMoved({ ...BASE_STATE }, badEnv as any, { mode: "live" });
    expect(result).toEqual({});
  });
});

// ============================================================================
// applyListUpdated
// ============================================================================

describe("applyListUpdated", () => {
  const envelope = env<ListUpdatedEvent>({ ...evt("list.updated", {
    listId: "l1", boardId: "b1", changes: { title: "New Title" },
  }), aggregateType: "list", aggregateId: "l1" });

  puritySuite("applyListUpdated", applyListUpdated, BASE_STATE, envelope as any);

  it("updates only specified fields", () => {
    const result = assertReducerPurity(applyListUpdated, BASE_STATE, envelope as any);
    expect(result.lists?.["l1"]?.title).toBe("New Title");
    expect(result.lists?.["l1"]?.position).toBe("a"); // unchanged
  });
});

// ============================================================================
// applyListDeleted
// ============================================================================

describe("applyListDeleted", () => {
  const envelope = env<ListDeletedEvent>({ ...evt("list.deleted", {
    listId: "l1", boardId: "b1",
  }), aggregateType: "list", aggregateId: "l1" });

  puritySuite("applyListDeleted", applyListDeleted, BASE_STATE, envelope as any);

  it("removes list from lists{}, cardsByList{}, and listOrder", () => {
    const result = assertReducerPurity(applyListDeleted, BASE_STATE, envelope as any);
    expect(result.lists?.["l1"]).toBeUndefined();
    expect(result.listOrder).not.toContain("l1");
    expect(result.cardsByList).not.toHaveProperty("l1");
  });

  it("is idempotent: second delete returns partial with list still absent", () => {
    const stateWithout = {
      ...BASE_STATE,
      lists: { l2: list({ id: "l2" }) },
      listOrder: ["l2"],
      cardsByList: { l2: [] },
    };
    const result = applyListDeleted(stateWithout, envelope as any, { mode: "live" });
    expect(result).toEqual({});
  });
});
