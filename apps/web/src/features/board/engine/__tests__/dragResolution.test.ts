// apps/web/src/features/board/engine/__tests__/dragResolution.test.ts
//
// Phase 1.3 (F1.3.2) — pure drop-resolution helpers.

import { describe, it, expect } from "vitest";

import {
  resolveOverListId,
  indexOfCard,
  computeOverIndex,
  needsVisualMove,
  computeListMoveIndices,
} from "../dragResolution";

const cardsByList = { l1: ["c1", "c2", "c3"], l2: ["c4"] };

describe("resolveOverListId", () => {
  it("prefers the sortable container id", () => {
    expect(resolveOverListId("l2", "c4")).toBe("l2");
  });
  it("falls back to the over id when no container (hovering empty list)", () => {
    expect(resolveOverListId(undefined, "l2")).toBe("l2");
    expect(resolveOverListId(null, "l2")).toBe("l2");
  });
  it("returns null when nothing is known", () => {
    expect(resolveOverListId(null, null)).toBeNull();
  });
});

describe("indexOfCard", () => {
  it("finds the index", () => {
    expect(indexOfCard(cardsByList, "l1", "c2")).toBe(1);
  });
  it("returns -1 for absent card or unknown list", () => {
    expect(indexOfCard(cardsByList, "l1", "zzz")).toBe(-1);
    expect(indexOfCard(cardsByList, "ghost", "c1")).toBe(-1);
  });
});

describe("computeOverIndex", () => {
  it("returns the index of the hovered card", () => {
    expect(computeOverIndex(cardsByList, "l1", "c3")).toBe(2);
  });
  it("appends (length) when hovering the empty drop zone (overId is the list)", () => {
    expect(computeOverIndex(cardsByList, "l2", "l2")).toBe(1);
  });
  it("appends when the list is unknown", () => {
    expect(computeOverIndex(cardsByList, "ghost", "x")).toBe(0);
  });
});

describe("needsVisualMove", () => {
  it("true when list changed", () => {
    expect(needsVisualMove("l1", "l2", 0, 0)).toBe(true);
  });
  it("true when index changed in same list", () => {
    expect(needsVisualMove("l1", "l1", 0, 2)).toBe(true);
  });
  it("false when nothing changed", () => {
    expect(needsVisualMove("l1", "l1", 1, 1)).toBe(false);
  });
});

describe("computeListMoveIndices", () => {
  const order = ["l1", "l2", "l3"];
  it("computes from/to and changed=true", () => {
    expect(computeListMoveIndices(order, "l1", "l3")).toEqual({ fromIndex: 0, toIndex: 2, changed: true });
  });
  it("changed=false for same slot", () => {
    expect(computeListMoveIndices(order, "l2", "l2")).toEqual({ fromIndex: 1, toIndex: 1, changed: false });
  });
  it("changed=false when an id is missing", () => {
    expect(computeListMoveIndices(order, "l1", "ghost").changed).toBe(false);
  });
});
