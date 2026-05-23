// apps/web/src/features/board/store/invariants/boardInvariants.ts
// ─────────────────────────────────────────────────────────────────────────────
// Runtime Invariant Assertions for BoardStoreState.
//
// Design:
//   - DEV MODE  → throws InvariantError immediately on first violation
//   - PROD MODE → logs via telemetry + quarantines to InvariantQuarantine
//     (does NOT throw — production must never crash due to an assertion)
//
// Each assertion is a pure function:
//   (state: BoardStoreState) => InvariantResult
//
// The orchestrator `assertAllInvariants()` runs all checks and either
// throws (dev) or reports (prod) violations.
//
// Invariants covered:
//   1. assertNoDuplicateCardIds       — no card appears in >1 list
//   2. assertCardsBelongToValidLists  — every card's listId exists in lists{}
//   3. assertCardsByListConsistency   — cards{} ↔ cardsByList{} bidirectional
//   4. assertListOrderUnique          — listOrder has no duplicates
//   5. assertListOrderComplete        — every list in lists{} is in listOrder
//   6. assertNoDuplicatePositions     — no two cards in same list share position
//   7. assertRevisionMonotonicity     — all revisions ≥ 0, no NaN
//   8. assertNoOrphanCardsByList      — cardsByList has no entries for missing lists
//   9. assertSequenceIsNumericString  — boardSequence is a valid non-negative integer string
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardStoreState } from "../useBoardStore";
import { telemetry } from "@/lib/telemetry/logEvent";

// ============================================================================
// Types
// ============================================================================

export interface InvariantViolation {
  invariant: string;
  message: string;
  data: Record<string, unknown>;
  severity: "critical" | "error" | "warning";
}

export interface InvariantResult {
  passed: boolean;
  violations: InvariantViolation[];
}

export class InvariantError extends Error {
  constructor(
    public readonly violations: InvariantViolation[],
  ) {
    super(
      `[BoardInvariants] ${violations.length} violation(s):\n` +
        violations.map((v) => `  • ${v.invariant}: ${v.message}`).join("\n"),
    );
    this.name = "InvariantError";
  }
}

// ============================================================================
// Individual Invariant Checks
// ============================================================================

/**
 * No card ID appears in more than one list's cardsByList array.
 */
export function assertNoDuplicateCardIds(state: BoardStoreState): InvariantViolation[] {
  const seen = new Map<string, string>(); // cardId → listId
  const violations: InvariantViolation[] = [];

  for (const [listId, cardIds] of Object.entries(state.cardsByList)) {
    for (const cardId of cardIds) {
      if (seen.has(cardId)) {
        violations.push({
          invariant: "NoDuplicateCardIds",
          message: `Card "${cardId}" referenced in both list "${seen.get(cardId)}" and "${listId}"`,
          data: { cardId, list1: seen.get(cardId), list2: listId },
          severity: "critical",
        });
      } else {
        seen.set(cardId, listId);
      }
    }
  }

  // Also check for duplicates within a single list
  for (const [listId, cardIds] of Object.entries(state.cardsByList)) {
    const listSeen = new Set<string>();
    for (const cardId of cardIds) {
      if (listSeen.has(cardId)) {
        violations.push({
          invariant: "NoDuplicateCardIds",
          message: `Card "${cardId}" appears multiple times in list "${listId}"`,
          data: { cardId, listId },
          severity: "critical",
        });
      }
      listSeen.add(cardId);
    }
  }

  return violations;
}

/**
 * Every card's listId field points to an existing list.
 */
export function assertCardsBelongToValidLists(state: BoardStoreState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  for (const [cardId, card] of Object.entries(state.cards)) {
    if (!state.lists[card.listId]) {
      violations.push({
        invariant: "CardsBelongToValidLists",
        message: `Card "${cardId}" references non-existent list "${card.listId}"`,
        data: { cardId, listId: card.listId },
        severity: "critical",
      });
    }
  }

  return violations;
}

/**
 * Bidirectional consistency: every card in cards{} is in its list's cardsByList[],
 * and every id in cardsByList[] exists in cards{}.
 */
export function assertCardsByListConsistency(state: BoardStoreState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // Forward: every card must appear in cardsByList[card.listId]
  for (const [cardId, card] of Object.entries(state.cards)) {
    const listCards = state.cardsByList[card.listId] ?? [];
    if (!listCards.includes(cardId)) {
      violations.push({
        invariant: "CardsByListConsistency",
        message: `Card "${cardId}" (listId="${card.listId}") not found in cardsByList["${card.listId}"]`,
        data: { cardId, listId: card.listId, cardsByListEntry: listCards },
        severity: "critical",
      });
    }
  }

  // Reverse: every id in cardsByList[] must exist in cards{}
  for (const [listId, cardIds] of Object.entries(state.cardsByList)) {
    for (const cardId of cardIds) {
      if (!state.cards[cardId]) {
        violations.push({
          invariant: "CardsByListConsistency",
          message: `cardsByList["${listId}"] references non-existent card "${cardId}"`,
          data: { cardId, listId },
          severity: "critical",
        });
      }
    }
  }

  return violations;
}

/**
 * listOrder must have no duplicate entries.
 */
export function assertListOrderUnique(state: BoardStoreState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const seen = new Set<string>();

  for (const listId of state.listOrder) {
    if (seen.has(listId)) {
      violations.push({
        invariant: "ListOrderUnique",
        message: `List "${listId}" appears multiple times in listOrder`,
        data: { listId, listOrder: state.listOrder },
        severity: "error",
      });
    }
    seen.add(listId);
  }

  return violations;
}

/**
 * Every list in lists{} must appear in listOrder, and every entry in
 * listOrder must exist in lists{}.
 */
export function assertListOrderComplete(state: BoardStoreState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const listOrderSet = new Set(state.listOrder);

  // lists{} → listOrder
  for (const listId of Object.keys(state.lists)) {
    if (!listOrderSet.has(listId)) {
      violations.push({
        invariant: "ListOrderComplete",
        message: `List "${listId}" exists in lists{} but not in listOrder`,
        data: { listId },
        severity: "warning",
      });
    }
  }

  // listOrder → lists{}
  for (const listId of state.listOrder) {
    if (!state.lists[listId]) {
      violations.push({
        invariant: "ListOrderComplete",
        message: `listOrder references non-existent list "${listId}"`,
        data: { listId },
        severity: "error",
      });
    }
  }

  return violations;
}

/**
 * No two cards in the same list should share an identical position string.
 * (LexoRank guarantees uniqueness; this detects corruption.)
 */
export function assertNoDuplicatePositions(state: BoardStoreState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  for (const [listId, cardIds] of Object.entries(state.cardsByList)) {
    const positions = new Map<string, string>(); // position → cardId

    for (const cardId of cardIds) {
      const card = state.cards[cardId];
      if (!card) continue; // orphan — caught by other invariant

      if (positions.has(card.position)) {
        violations.push({
          invariant: "NoDuplicatePositions",
          message:
            `Cards "${positions.get(card.position)}" and "${cardId}" ` +
            `share position "${card.position}" in list "${listId}"`,
          data: { listId, position: card.position, card1: positions.get(card.position), card2: cardId },
          severity: "error",
        });
      } else {
        positions.set(card.position, cardId);
      }
    }
  }

  return violations;
}

/**
 * All revision numbers must be ≥ 0 and must be finite numbers (not NaN/Infinity).
 */
export function assertRevisionMonotonicity(state: BoardStoreState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  for (const [cardId, card] of Object.entries(state.cards)) {
    if (!Number.isFinite(card.revision) || card.revision < 0) {
      violations.push({
        invariant: "RevisionMonotonicity",
        message: `Card "${cardId}" has invalid revision: ${card.revision}`,
        data: { cardId, revision: card.revision },
        severity: "error",
      });
    }
  }

  for (const [listId, list] of Object.entries(state.lists)) {
    if (!Number.isFinite(list.revision) || list.revision < 0) {
      violations.push({
        invariant: "RevisionMonotonicity",
        message: `List "${listId}" has invalid revision: ${list.revision}`,
        data: { listId, revision: list.revision },
        severity: "error",
      });
    }
  }

  return violations;
}

/**
 * cardsByList must not have entries for lists that don't exist in lists{}.
 */
export function assertNoOrphanCardsByList(state: BoardStoreState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  for (const listId of Object.keys(state.cardsByList)) {
    if (!state.lists[listId]) {
      violations.push({
        invariant: "NoOrphanCardsByList",
        message: `cardsByList has entry for non-existent list "${listId}"`,
        data: { listId, cardCount: state.cardsByList[listId]?.length ?? 0 },
        severity: "warning",
      });
    }
  }

  return violations;
}

/**
 * boardSequence must be a string representing a non-negative integer.
 */
export function assertSequenceIsNumericString(state: BoardStoreState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const seq = state.boardSequence;

  if (typeof seq !== "string" || !/^\d+$/.test(seq) || BigInt(seq) < 0n) {
    violations.push({
      invariant: "SequenceIsNumericString",
      message: `boardSequence "${seq}" is not a valid non-negative integer string`,
      data: { boardSequence: seq },
      severity: "error",
    });
  }

  return violations;
}

// ============================================================================
// Orchestrator
// ============================================================================

const ALL_INVARIANTS = [
  assertNoDuplicateCardIds,
  assertCardsBelongToValidLists,
  assertCardsByListConsistency,
  assertListOrderUnique,
  assertListOrderComplete,
  assertNoDuplicatePositions,
  assertRevisionMonotonicity,
  assertNoOrphanCardsByList,
  assertSequenceIsNumericString,
] as const;

/**
 * Run all invariant checks against the given state.
 *
 * DEV  → throws InvariantError on first batch of violations
 * PROD → fires telemetry per violation, returns result (never throws)
 */
export function assertAllInvariants(state: BoardStoreState): InvariantResult {
  const allViolations: InvariantViolation[] = [];

  for (const check of ALL_INVARIANTS) {
    allViolations.push(...check(state));
  }

  const result: InvariantResult = {
    passed: allViolations.length === 0,
    violations: allViolations,
  };

  if (!result.passed) {
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
      throw new InvariantError(allViolations);
    }

    // Production: report each violation via telemetry, quarantine state
    for (const v of allViolations) {
      try {
        telemetry.log(
          "STORE",
          `INVARIANT_VIOLATION_${v.severity.toUpperCase()}`,
          {
            invariant: v.invariant,
            message: v.message,
            ...v.data,
          },
        );
      } catch {
        // telemetry must not crash the app
      }
    }

    // Quarantine: mark state as desynced so FSM triggers resync
    InvariantQuarantine.record(allViolations, state.boardSequence);
  }

  return result;
}

/**
 * Lightweight, non-throwing version for post-event assertions in production.
 * Runs only "critical" severity checks (fast path).
 */
export function assertCriticalInvariants(state: BoardStoreState): InvariantResult {
  const violations: InvariantViolation[] = [
    ...assertNoDuplicateCardIds(state),
    ...assertCardsByListConsistency(state),
    ...assertCardsBelongToValidLists(state),
  ].filter((v) => v.severity === "critical");

  return { passed: violations.length === 0, violations };
}

// ============================================================================
// Quarantine Registry
// ─────────────────────────────────────────────────────────────────────────────
// Records invariant violations in prod so they can be inspected / reported
// without crashing the application.
// ============================================================================

export const InvariantQuarantine = {
  _records: [] as Array<{
    timestamp: number;
    sequence: string;
    violations: InvariantViolation[];
  }>,

  record(violations: InvariantViolation[], sequence: string): void {
    this._records.push({ timestamp: Date.now(), sequence, violations });
    // Keep only last 20 to prevent unbounded memory growth
    if (this._records.length > 20) {
      this._records.shift();
    }
  },

  getAll() {
    return this._records.slice();
  },

  clear() {
    this._records = [];
  },

  hasViolations(): boolean {
    return this._records.length > 0;
  },
};
