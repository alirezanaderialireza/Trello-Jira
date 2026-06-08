// apps/web/src/features/board/engine/__tests__/boardSelectors.test.ts
//
// Phase 1.3 (F1.3.1) — selector stability + correctness for the pure board
// selector factories. These are dependency-free, so the test needs neither a
// React tree nor a Zustand instance.

import { describe, it, expect } from "vitest";

import {
  EMPTY_CARD_IDS,
  selectListOrder,
  selectCardIds,
  selectCard,
  selectList,
  selectCardTitle,
  deriveOrderedLists,
} from "../boardSelectors";
import type { BoardStoreState, CardDto, ListDto } from "../../store/useBoardStore";

function card(overrides: Partial<CardDto> = {}): CardDto {
  return { id: "c1", boardId: "b1", listId: "l1", title: "T", position: "a", revision: 1, ...overrides };
}
function list(overrides: Partial<ListDto> = {}): ListDto {
  return { id: "l1", boardId: "b1", title: "L", position: "a", revision: 1, ...overrides };
}

// A minimal state stub — only the slices the selectors touch.
function state(): BoardStoreState {
  return {
    lists: { l1: list(), l2: list({ id: "l2", title: "L2", position: "b" }) },
    cards: { c1: card(), c2: card({ id: "c2", listId: "l2", title: "T2", position: "b" }) },
    cardsByList: { l1: ["c1"], l2: ["c2"] },
    listOrder: ["l1", "l2"],
  } as unknown as BoardStoreState;
}

describe("boardSelectors — correctness", () => {
  it("selectListOrder returns the order array", () => {
    expect(selectListOrder(state())).toEqual(["l1", "l2"]);
  });

  it("selectCardIds returns the list's card ids", () => {
    expect(selectCardIds("l1")(state())).toEqual(["c1"]);
  });

  it("selectCard / selectList return the DTOs", () => {
    expect(selectCard("c2")(state())?.title).toBe("T2");
    expect(selectList("l2")(state())?.title).toBe("L2");
  });

  it("selectCardTitle returns just the title", () => {
    expect(selectCardTitle("c1")(state())).toBe("T");
  });

  it("returns undefined for unknown ids", () => {
    expect(selectCard("nope")(state())).toBeUndefined();
    expect(selectList("nope")(state())).toBeUndefined();
    expect(selectCardTitle("nope")(state())).toBeUndefined();
  });
});

describe("boardSelectors — stability", () => {
  it("selectCardIds hands back the SAME frozen empty for a missing list", () => {
    const s = state();
    const a = selectCardIds("ghost")(s);
    const b = selectCardIds("ghost")(s);
    expect(a).toBe(EMPTY_CARD_IDS);
    expect(b).toBe(EMPTY_CARD_IDS);
    expect(a).toBe(b); // referential equality → no render loop
  });

  it("selectCardIds returns the identical array reference across calls for the same state", () => {
    const s = state();
    expect(selectCardIds("l1")(s)).toBe(selectCardIds("l1")(s));
  });

  it("EMPTY_CARD_IDS is frozen", () => {
    expect(Object.isFrozen(EMPTY_CARD_IDS)).toBe(true);
  });
});

describe("deriveOrderedLists", () => {
  it("orders lists by listOrder and drops unknown ids", () => {
    const s = state();
    const out = deriveOrderedLists(s.listOrder, s.lists);
    expect(out.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("filters out missing lists without throwing", () => {
    const s = state();
    const out = deriveOrderedLists(["l2", "missing", "l1"], s.lists);
    expect(out.map((l) => l.id)).toEqual(["l2", "l1"]);
  });

  it("preserves a custom order", () => {
    const s = state();
    const out = deriveOrderedLists(["l2", "l1"], s.lists);
    expect(out.map((l) => l.id)).toEqual(["l2", "l1"]);
  });
});
