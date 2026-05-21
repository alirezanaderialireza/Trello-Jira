// apps/web/src/features/board/store/__tests__/phase0/invariants.test.ts
//
// Phase-0 invariant test suite.
// Covers all four invariants + edge cases.

import { describe, it, expect } from "vitest";
import {
  checkCardInValidList,
  checkNoDuplicateIds,
  checkListOrderUnique,
  checkCardsByListSync,
  validateStoreInvariants,
} from "../../invariants";
import { createBoardState } from "../../test-utils/createBoardState";

// ============================================================================
// Helpers
// ============================================================================

function card(id: string, listId: string, pos = "a", rev = 1) {
  return { id, boardId: "b1", title: id, listId, position: pos, revision: rev };
}

function list(id: string, pos = "a", rev = 1) {
  return { id, title: id, position: pos, revision: rev };
}

// ============================================================================
// INV-1 — card-in-valid-list
// ============================================================================

describe("INV-1 — card-in-valid-list", () => {
  it("passes when all cards reference existing lists and appear in buckets", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       { c1: card("c1", "l1") },
      cardsByList: { l1: ["c1"] },
      listOrder:   ["l1"],
    });
    expect(checkCardInValidList(state)).toHaveLength(0);
  });

  it("detects card whose listId does not exist", () => {
    const state = createBoardState({
      lists:       {},
      cards:       { c1: card("c1", "ghost-list") },
      cardsByList: {},
      listOrder:   [],
    });
    const violations = checkCardInValidList(state);
    expect(violations).toHaveLength(1);
    expect(violations[0].invariant).toBe("INV-1");
    expect(violations[0].message).toContain("ghost-list");
  });

  it("detects card present in cards map but missing from its list bucket", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       { c1: card("c1", "l1") },
      cardsByList: { l1: [] }, // c1 absent from bucket
      listOrder:   ["l1"],
    });
    const violations = checkCardInValidList(state);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("missing from cardsByList");
  });

  it("returns multiple violations when multiple cards are broken", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       { c1: card("c1", "missing"), c2: card("c2", "l1") },
      cardsByList: { l1: [] },
      listOrder:   ["l1"],
    });
    expect(checkCardInValidList(state).length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// INV-2 — no-duplicate-ids
// ============================================================================

describe("INV-2 — no-duplicate-ids", () => {
  it("passes when no duplicate card ids across buckets", () => {
    const state = createBoardState({
      lists:       { l1: list("l1"), l2: list("l2") },
      cards:       { c1: card("c1", "l1"), c2: card("c2", "l2") },
      cardsByList: { l1: ["c1"], l2: ["c2"] },
      listOrder:   ["l1", "l2"],
    });
    expect(checkNoDuplicateIds(state)).toHaveLength(0);
  });

  it("detects same cardId in two different buckets", () => {
    const state = createBoardState({
      lists:       { l1: list("l1"), l2: list("l2") },
      cards:       { c1: card("c1", "l1") },
      cardsByList: { l1: ["c1"], l2: ["c1"] }, // duplicate!
      listOrder:   ["l1", "l2"],
    });
    const v = checkNoDuplicateIds(state);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0].invariant).toBe("INV-2");
    expect(v[0].message).toContain("c1");
  });

  it("detects duplicate cardId within the same bucket", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       { c1: card("c1", "l1") },
      cardsByList: { l1: ["c1", "c1"] }, // same id twice
      listOrder:   ["l1"],
    });
    const v = checkNoDuplicateIds(state);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0].message).toContain("Duplicate cardId");
  });

  it("detects duplicate listId in listOrder", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       {},
      cardsByList: { l1: [] },
      listOrder:   ["l1", "l1"], // duplicate
    });
    const v = checkNoDuplicateIds(state);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0].message).toContain("Duplicate listId");
  });
});

// ============================================================================
// INV-3 — listOrder-unique
// ============================================================================

describe("INV-3 — listOrder-unique", () => {
  it("passes when listOrder exactly matches lists map", () => {
    const state = createBoardState({
      lists:       { l1: list("l1"), l2: list("l2") },
      cards:       {},
      cardsByList: { l1: [], l2: [] },
      listOrder:   ["l1", "l2"],
    });
    expect(checkListOrderUnique(state)).toHaveLength(0);
  });

  it("detects listOrder entry missing from lists map", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       {},
      cardsByList: {},
      listOrder:   ["l1", "ghost-l2"],
    });
    const v = checkListOrderUnique(state);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0].message).toContain("ghost-l2");
  });

  it("detects list in map that is missing from listOrder (ghost list)", () => {
    const state = createBoardState({
      lists:       { l1: list("l1"), l2: list("l2") },
      cards:       {},
      cardsByList: { l1: [], l2: [] },
      listOrder:   ["l1"], // l2 missing from listOrder
    });
    const v = checkListOrderUnique(state);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0].message).toContain("l2");
  });
});

// ============================================================================
// INV-4 — cardsByList-sync
// ============================================================================

describe("INV-4 — cardsByList-sync", () => {
  it("passes when cards map and cardsByList are perfectly in sync", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       { c1: card("c1", "l1") },
      cardsByList: { l1: ["c1"] },
      listOrder:   ["l1"],
    });
    expect(checkCardsByListSync(state)).toHaveLength(0);
  });

  it("detects cardsByList bucket for a non-existent list", () => {
    const state = createBoardState({
      lists:       {},
      cards:       {},
      cardsByList: { "ghost-l": [] },
      listOrder:   [],
    });
    const v = checkCardsByListSync(state);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0].message).toContain("ghost-l");
  });

  it("detects bucket referencing a card that does not exist in cards map", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       {},
      cardsByList: { l1: ["ghost-c"] },
      listOrder:   ["l1"],
    });
    const v = checkCardsByListSync(state);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v[0].message).toContain("ghost-c");
  });

  it("detects card in cards map that does not appear in any bucket (orphan)", () => {
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       { c1: card("c1", "l1"), orphan: card("orphan", "l1") },
      cardsByList: { l1: ["c1"] }, // orphan not in bucket
      listOrder:   ["l1"],
    });
    const v = checkCardsByListSync(state);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v.some((x) => x.message.includes("orphan"))).toBe(true);
  });
});

// ============================================================================
// Composite — validateStoreInvariants
// ============================================================================

describe("validateStoreInvariants — composite", () => {
  it("returns valid:true for a clean state", () => {
    const state = createBoardState({
      lists:       { l1: list("l1"), l2: list("l2") },
      cards:       {
        c1: card("c1", "l1", "a"),
        c2: card("c2", "l1", "b"),
        c3: card("c3", "l2", "a"),
      },
      cardsByList: { l1: ["c1", "c2"], l2: ["c3"] },
      listOrder:   ["l1", "l2"],
    });
    const result = validateStoreInvariants(state);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("returns valid:false and collects all violations from all invariants", () => {
    // This state violates INV-1 (card with bad listId), INV-3 (ghost in listOrder),
    // and INV-4 (orphan card in map).
    const state = createBoardState({
      lists:       { l1: list("l1") },
      cards:       {
        c1: card("c1", "l1"),
        c2: card("c2", "missing-list"), // INV-1 violation
        orphan: card("orphan", "l1"),   // INV-4: not in any bucket
      },
      cardsByList: { l1: ["c1"] },
      listOrder:   ["l1", "ghost-l"],    // INV-3: ghost-l not in lists map
    });
    const result = validateStoreInvariants(state);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
});
