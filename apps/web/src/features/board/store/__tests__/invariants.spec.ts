// apps/web/src/features/board/store/__tests__/invariants.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
// Task #2 — Runtime Invariant Assertion Tests
//
// Verifies that every invariant function:
//   - passes on a valid state
//   - correctly detects all violation scenarios
//   - InvariantError is thrown in dev/test mode
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  assertNoDuplicateCardIds,
  assertCardsBelongToValidLists,
  assertCardsByListConsistency,
  assertListOrderUnique,
  assertListOrderComplete,
  assertNoDuplicatePositions,
  assertRevisionMonotonicity,
  assertNoOrphanCardsByList,
  assertSequenceIsNumericString,
  assertAllInvariants,
  assertCriticalInvariants,
  InvariantError,
  InvariantQuarantine,
} from "../invariants/boardInvariants";
import { createBoardState } from "../test-utils/createBoardState";
import type { BoardStoreState, CardDto, ListDto } from "../useBoardStore";

// ============================================================================
// Fixtures
// ============================================================================

function card(overrides: Partial<CardDto> = {}): CardDto {
  return { id: "c1", boardId: "b1", listId: "l1", title: "T", position: "a", revision: 1, ...overrides };
}
function list(overrides: Partial<ListDto> = {}): ListDto {
  return { id: "l1", boardId: "b1", title: "L", position: "a", revision: 1, ...overrides };
}

const VALID_STATE: BoardStoreState = createBoardState({
  lists: { l1: list(), l2: list({ id: "l2", position: "b" }) },
  cards: {
    c1: card(),
    c2: card({ id: "c2", listId: "l2", position: "b" }),
    c3: card({ id: "c3", listId: "l1", position: "c" }),
  },
  cardsByList: { l1: ["c1", "c3"], l2: ["c2"] },
  listOrder: ["l1", "l2"],
  boardSequence: "42",
});

// ============================================================================
// assertNoDuplicateCardIds
// ============================================================================

describe("assertNoDuplicateCardIds", () => {
  it("passes on valid state", () => {
    expect(assertNoDuplicateCardIds(VALID_STATE)).toEqual([]);
  });

  it("detects card appearing in two lists", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cardsByList: { l1: ["c1", "c2"], l2: ["c2"] }, // c2 in both
    };
    const violations = assertNoDuplicateCardIds(state);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!.invariant).toBe("NoDuplicateCardIds");
    expect(violations[0]!.severity).toBe("critical");
  });

  it("detects card appearing twice within same list", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cardsByList: { l1: ["c1", "c1"], l2: ["c2"] },
    };
    const violations = assertNoDuplicateCardIds(state);
    expect(violations.some((v) => v.data["cardId"] === "c1")).toBe(true);
  });
});

// ============================================================================
// assertCardsBelongToValidLists
// ============================================================================

describe("assertCardsBelongToValidLists", () => {
  it("passes on valid state", () => {
    expect(assertCardsBelongToValidLists(VALID_STATE)).toEqual([]);
  });

  it("detects card referencing non-existent list", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cards: {
        ...VALID_STATE.cards,
        ghost: card({ id: "ghost", listId: "NONEXISTENT" }),
      },
    };
    const violations = assertCardsBelongToValidLists(state);
    expect(violations.length).toBe(1);
    expect(violations[0]!.data["cardId"]).toBe("ghost");
  });
});

// ============================================================================
// assertCardsByListConsistency
// ============================================================================

describe("assertCardsByListConsistency", () => {
  it("passes on valid state", () => {
    expect(assertCardsByListConsistency(VALID_STATE)).toEqual([]);
  });

  it("detects card in cards{} not listed in its cardsByList[]", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cardsByList: { l1: [], l2: ["c2"] }, // c1 and c3 missing from l1
    };
    const violations = assertCardsByListConsistency(state);
    expect(violations.some((v) => v.data["cardId"] === "c1")).toBe(true);
  });

  it("detects id in cardsByList[] not in cards{}", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cardsByList: { l1: ["c1", "c3", "GHOST"], l2: ["c2"] },
    };
    const violations = assertCardsByListConsistency(state);
    expect(violations.some((v) => v.data["cardId"] === "GHOST")).toBe(true);
  });
});

// ============================================================================
// assertListOrderUnique
// ============================================================================

describe("assertListOrderUnique", () => {
  it("passes on valid state", () => {
    expect(assertListOrderUnique(VALID_STATE)).toEqual([]);
  });

  it("detects duplicate in listOrder", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      listOrder: ["l1", "l2", "l1"],
    };
    const violations = assertListOrderUnique(state);
    expect(violations.length).toBe(1);
    expect(violations[0]!.invariant).toBe("ListOrderUnique");
  });
});

// ============================================================================
// assertListOrderComplete
// ============================================================================

describe("assertListOrderComplete", () => {
  it("passes on valid state", () => {
    expect(assertListOrderComplete(VALID_STATE)).toEqual([]);
  });

  it("detects list in lists{} missing from listOrder", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      listOrder: ["l1"], // l2 missing
    };
    const violations = assertListOrderComplete(state);
    expect(violations.some((v) => v.data["listId"] === "l2")).toBe(true);
  });

  it("detects non-existent list in listOrder", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      listOrder: ["l1", "l2", "GHOST"],
    };
    const violations = assertListOrderComplete(state);
    expect(violations.some((v) => v.data["listId"] === "GHOST")).toBe(true);
  });
});

// ============================================================================
// assertNoDuplicatePositions
// ============================================================================

describe("assertNoDuplicatePositions", () => {
  it("passes on valid state", () => {
    expect(assertNoDuplicatePositions(VALID_STATE)).toEqual([]);
  });

  it("detects two cards with same position in same list", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cards: {
        c1: card({ id: "c1", listId: "l1", position: "a" }),
        c3: card({ id: "c3", listId: "l1", position: "a" }), // same position as c1
        c2: card({ id: "c2", listId: "l2", position: "b" }),
      },
    };
    const violations = assertNoDuplicatePositions(state);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!.invariant).toBe("NoDuplicatePositions");
  });

  it("allows same position in different lists", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cards: {
        c1: card({ id: "c1", listId: "l1", position: "a" }),
        c3: card({ id: "c3", listId: "l1", position: "c" }),
        c2: card({ id: "c2", listId: "l2", position: "a" }), // same as c1 but different list — OK
      },
    };
    expect(assertNoDuplicatePositions(state)).toEqual([]);
  });
});

// ============================================================================
// assertRevisionMonotonicity
// ============================================================================

describe("assertRevisionMonotonicity", () => {
  it("passes on valid state", () => {
    expect(assertRevisionMonotonicity(VALID_STATE)).toEqual([]);
  });

  it("detects negative card revision", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cards: { ...VALID_STATE.cards, c1: card({ revision: -1 }) },
    };
    const violations = assertRevisionMonotonicity(state);
    expect(violations.some((v) => v.data["cardId"] === "c1")).toBe(true);
  });

  it("detects NaN list revision", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      lists: { ...VALID_STATE.lists, l1: { ...list(), revision: NaN } },
    };
    const violations = assertRevisionMonotonicity(state);
    expect(violations.some((v) => v.data["listId"] === "l1")).toBe(true);
  });
});

// ============================================================================
// assertNoOrphanCardsByList
// ============================================================================

describe("assertNoOrphanCardsByList", () => {
  it("passes on valid state", () => {
    expect(assertNoOrphanCardsByList(VALID_STATE)).toEqual([]);
  });

  it("detects cardsByList entry for non-existent list", () => {
    const state: BoardStoreState = {
      ...VALID_STATE,
      cardsByList: { ...VALID_STATE.cardsByList, ORPHAN: [] },
    };
    const violations = assertNoOrphanCardsByList(state);
    expect(violations.some((v) => v.data["listId"] === "ORPHAN")).toBe(true);
  });
});

// ============================================================================
// assertSequenceIsNumericString
// ============================================================================

describe("assertSequenceIsNumericString", () => {
  it("passes on valid numeric strings", () => {
    const good = ["0", "1", "42", "999999"];
    for (const seq of good) {
      expect(assertSequenceIsNumericString({ ...VALID_STATE, boardSequence: seq })).toEqual([]);
    }
  });

  it("rejects non-numeric strings", () => {
    const bad = ["abc", "-1", "1.5", "", "NaN"];
    for (const seq of bad) {
      const violations = assertSequenceIsNumericString({ ...VALID_STATE, boardSequence: seq });
      expect(violations.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// assertAllInvariants (orchestrator)
// ============================================================================

describe("assertAllInvariants", () => {
  it("passes on a valid state without throwing", () => {
    expect(() => assertAllInvariants(VALID_STATE)).not.toThrow();
    const result = assertAllInvariants(VALID_STATE);
    expect(result.passed).toBe(true);
  });

  it("throws InvariantError in test/dev mode for corrupted state", () => {
    const corruptState: BoardStoreState = {
      ...VALID_STATE,
      cards: {
        ...VALID_STATE.cards,
        c1: card({ revision: -1 }),           // bad revision
        ghost: card({ id: "ghost", listId: "NONEXISTENT" }), // orphan card
      },
    };
    expect(() => assertAllInvariants(corruptState)).toThrow(InvariantError);
  });

  it("InvariantError message lists all violations", () => {
    const corruptState: BoardStoreState = {
      ...VALID_STATE,
      listOrder: ["l1", "l1", "l2"], // duplicate
      boardSequence: "NOT_A_NUMBER",  // bad seq
    };
    let err: InvariantError | null = null;
    try {
      assertAllInvariants(corruptState);
    } catch (e) {
      err = e as InvariantError;
    }
    expect(err).toBeInstanceOf(InvariantError);
    expect(err!.violations.length).toBeGreaterThanOrEqual(2);
    expect(err!.message).toContain("ListOrderUnique");
    expect(err!.message).toContain("SequenceIsNumericString");
  });
});

// ============================================================================
// assertCriticalInvariants (fast path)
// ============================================================================

describe("assertCriticalInvariants", () => {
  it("passes on valid state", () => {
    const result = assertCriticalInvariants(VALID_STATE);
    expect(result.passed).toBe(true);
  });

  it("only returns critical violations", () => {
    const stateWithWarning: BoardStoreState = {
      ...VALID_STATE,
      // warning: list in lists{} not in listOrder
      listOrder: ["l1"], // l2 missing → warning, not critical
    };
    const result = assertCriticalInvariants(stateWithWarning);
    // No critical violations from this particular corruption
    expect(result.violations.every((v) => v.severity === "critical")).toBe(true);
  });
});

// ============================================================================
// InvariantQuarantine
// ============================================================================

describe("InvariantQuarantine", () => {
  it("records violations without throwing", () => {
    InvariantQuarantine.clear();
    InvariantQuarantine.record(
      [{ invariant: "Test", message: "msg", data: {}, severity: "error" }],
      "99",
    );
    expect(InvariantQuarantine.hasViolations()).toBe(true);
    expect(InvariantQuarantine.getAll()[0]!.sequence).toBe("99");
    InvariantQuarantine.clear();
  });

  it("keeps only last 20 records", () => {
    InvariantQuarantine.clear();
    for (let i = 0; i < 25; i++) {
      InvariantQuarantine.record(
        [{ invariant: "T", message: "m", data: {}, severity: "warning" }],
        String(i),
      );
    }
    expect(InvariantQuarantine.getAll().length).toBe(20);
    InvariantQuarantine.clear();
  });
});
