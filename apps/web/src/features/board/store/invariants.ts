// apps/web/src/features/board/store/invariants.ts
//
// Phase-0 #5 — Store invariant validators.
//
// These functions assert the four core invariants that must hold at ALL times:
//
//   INV-1  card-in-valid-list   Every card.listId points to a list that exists
//                               AND the card appears in that list's bucket.
//
//   INV-2  no-duplicate-ids     No cardId appears more than once across all
//                               cardsByList buckets. No listId appears more
//                               than once in listOrder.
//
//   INV-3  listOrder-unique     listOrder contains only ids that exist in
//                               lists map, with no duplicates.
//
//   INV-4  cardsByList-sync     cardsByList keys are a subset of lists keys.
//                               Every id in every bucket exists in cards map.
//                               cards map and cardsByList buckets are the same
//                               set of card ids (no ghost, no orphan).
//
// Each validator returns a list of human-readable violation strings.
// An empty array means the invariant holds.
//
// Usage:
//   import { assertStoreInvariants } from "./invariants";
//   assertStoreInvariants(useBoardStore.getState()); // throws in dev, logs in prod

import type { BoardStoreState } from "./useBoardStore";

// ============================================================================
// Types
// ============================================================================

export interface InvariantViolation {
  invariant: "INV-1" | "INV-2" | "INV-3" | "INV-4";
  message:   string;
}

export interface InvariantResult {
  valid:      boolean;
  violations: InvariantViolation[];
}

// ============================================================================
// INV-1 — card-in-valid-list
// ============================================================================

export function checkCardInValidList(
  state: Pick<BoardStoreState, "cards" | "lists" | "cardsByList">,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  for (const [cardId, card] of Object.entries(state.cards)) {
    const listId = card.listId;

    // The list must exist
    if (!state.lists[listId]) {
      violations.push({
        invariant: "INV-1",
        message:   `Card "${cardId}" has listId "${listId}" which does not exist in lists map.`,
      });
      continue;
    }

    // The card must appear in its list's bucket
    const bucket = state.cardsByList[listId] ?? [];
    if (!bucket.includes(cardId)) {
      violations.push({
        invariant: "INV-1",
        message:   `Card "${cardId}" has listId "${listId}" but is missing from cardsByList["${listId}"].`,
      });
    }
  }

  return violations;
}

// ============================================================================
// INV-2 — no-duplicate-ids
// ============================================================================

export function checkNoDuplicateIds(
  state: Pick<BoardStoreState, "cardsByList" | "listOrder">,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // Check card id duplicates across buckets
  const seenCardIds = new Map<string, string>(); // cardId → listId

  for (const [listId, bucket] of Object.entries(state.cardsByList)) {
    const seenInBucket = new Set<string>();

    for (const cardId of bucket) {
      // Duplicate within same bucket
      if (seenInBucket.has(cardId)) {
        violations.push({
          invariant: "INV-2",
          message:   `Duplicate cardId "${cardId}" within cardsByList["${listId}"].`,
        });
      }
      seenInBucket.add(cardId);

      // Duplicate across buckets
      const prevList = seenCardIds.get(cardId);
      if (prevList !== undefined && prevList !== listId) {
        violations.push({
          invariant: "INV-2",
          message:   `CardId "${cardId}" appears in both cardsByList["${prevList}"] and cardsByList["${listId}"].`,
        });
      } else {
        seenCardIds.set(cardId, listId);
      }
    }
  }

  // Check list id duplicates in listOrder
  const seenListIds = new Set<string>();
  for (const listId of state.listOrder) {
    if (seenListIds.has(listId)) {
      violations.push({
        invariant: "INV-2",
        message:   `Duplicate listId "${listId}" in listOrder.`,
      });
    }
    seenListIds.add(listId);
  }

  return violations;
}

// ============================================================================
// INV-3 — listOrder-unique
// ============================================================================

export function checkListOrderUnique(
  state: Pick<BoardStoreState, "lists" | "listOrder">,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // Every id in listOrder must exist in lists map
  for (const listId of state.listOrder) {
    if (!state.lists[listId]) {
      violations.push({
        invariant: "INV-3",
        message:   `listOrder contains "${listId}" which does not exist in lists map.`,
      });
    }
  }

  // Every list in lists map must appear in listOrder (no ghost lists)
  const orderSet = new Set(state.listOrder);
  for (const listId of Object.keys(state.lists)) {
    if (!orderSet.has(listId)) {
      violations.push({
        invariant: "INV-3",
        message:   `List "${listId}" exists in lists map but is missing from listOrder.`,
      });
    }
  }

  return violations;
}

// ============================================================================
// INV-4 — cardsByList-sync
// ============================================================================

export function checkCardsByListSync(
  state: Pick<BoardStoreState, "cards" | "lists" | "cardsByList">,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // Every key in cardsByList must correspond to an existing list
  for (const listId of Object.keys(state.cardsByList)) {
    if (!state.lists[listId]) {
      violations.push({
        invariant: "INV-4",
        message:   `cardsByList has bucket for "${listId}" but that list does not exist.`,
      });
    }
  }

  // Every card id in every bucket must exist in the cards map
  for (const [listId, bucket] of Object.entries(state.cardsByList)) {
    for (const cardId of bucket) {
      if (!state.cards[cardId]) {
        violations.push({
          invariant: "INV-4",
          message:   `cardsByList["${listId}"] references cardId "${cardId}" which does not exist in cards map.`,
        });
      }
    }
  }

  // Every card in the cards map must appear in exactly one bucket
  const allBucketCardIds = new Set(
    Object.values(state.cardsByList).flat(),
  );
  for (const cardId of Object.keys(state.cards)) {
    if (!allBucketCardIds.has(cardId)) {
      violations.push({
        invariant: "INV-4",
        message:   `Card "${cardId}" exists in cards map but does not appear in any cardsByList bucket.`,
      });
    }
  }

  return violations;
}

// ============================================================================
// Composite validator
// ============================================================================

export function validateStoreInvariants(
  state: BoardStoreState,
): InvariantResult {
  const violations: InvariantViolation[] = [
    ...checkCardInValidList(state),
    ...checkNoDuplicateIds(state),
    ...checkListOrderUnique(state),
    ...checkCardsByListSync(state),
  ];

  return { valid: violations.length === 0, violations };
}

/**
 * assertStoreInvariants — throws in development, logs in production.
 * Call this at strategic points (after every WS event, after reducer runs)
 * to catch state corruption immediately rather than hours later.
 */
export function assertStoreInvariants(state: BoardStoreState): void {
  const result = validateStoreInvariants(state);
  if (result.valid) return;

  const summary = result.violations
    .map((v) => `  [${v.invariant}] ${v.message}`)
    .join("\n");

  const message = `Store invariant violations detected:\n${summary}`;

  if (process.env.NODE_ENV === "development") {
    throw new Error(message);
  } else {
    console.error("[StoreInvariant]", message);
  }
}
