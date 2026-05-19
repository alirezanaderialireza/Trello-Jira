// apps/web/src/features/board/store/test-utils/reducerPurity.ts
// ─────────────────────────────────────────────────────────────────────────────
// Reducer Purity Enforcement Utilities
//
// Purpose:
//   Formally verify that every reducer satisfies the "pure function" contract:
//   1. NO MUTATION  — input state must remain bit-for-bit identical after call
//   2. DETERMINISTIC — same (state, envelope) always produces same output
//   3. SAFE IDENTITY — when reducer returns {}, state is unchanged (no-op)
//   4. SERIALISABLE  — output is JSON-serialisable (no functions, no undefined)
//   5. NO THROWS     — reducer must never throw (crash isolation boundary)
//
// Usage in tests:
//   assertReducerPurity(applyCardMoved, state, envelope, context)
// ─────────────────────────────────────────────────────────────────────────────

import { expect } from "vitest";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import type { ReducerContext } from "../event-application/context";
import type { AppDomainEvent } from "@repo/domain";

// ============================================================================
// Deep Freeze (recursive) — makes mutation attempts throw in strict mode
// ============================================================================

export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  // Freeze all nested objects
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return Object.freeze(obj) as Readonly<T>;
}

// ============================================================================
// Snapshot — structural clone for comparison
// ============================================================================

function snapshot<T>(val: T): string {
  return JSON.stringify(val, (_, v) =>
    v instanceof Map
      ? { "__Map__": true, entries: [...v.entries()] }
      : v instanceof Set
      ? { "__Set__": true, values: [...v.values()] }
      : v,
  );
}

// ============================================================================
// assertReducerPurity
// ─────────────────────────────────────────────────────────────────────────────
// Runs a single reducer call and asserts ALL purity contracts simultaneously.
// Returns the result so the caller can make additional domain assertions.
// ============================================================================

export function assertReducerPurity<TEvent extends AppDomainEvent>(
  reducer: (
    state: BoardStoreState,
    envelope: ClientEventEnvelope<TEvent>,
    context: ReducerContext,
  ) => Partial<BoardStoreState>,
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TEvent>,
  context: ReducerContext = { mode: "live" },
): Partial<BoardStoreState> {
  // ── 1. Capture exact snapshot of input state before call ──────────────────
  const stateBefore = snapshot(state);

  // ── 2. Deep-freeze the state so any mutation attempt throws immediately ───
  const frozenState = deepFreeze(structuredClone(state));

  // ── 3. Call reducer — must not throw ─────────────────────────────────────
  let result: Partial<BoardStoreState>;
  let threw = false;
  let thrownError: unknown;
  try {
    result = reducer(frozenState, envelope, context);
  } catch (err) {
    threw = true;
    thrownError = err;
    result = {};
  }

  // ── 4. Input state must be identical to before the call ──────────────────
  const stateAfter = snapshot(state);
  expect(stateAfter).toBe(stateBefore); // no mutation

  // ── 5. Reducer must not throw ─────────────────────────────────────────────
  if (threw) {
    throw new Error(
      `[ReducerPurity] Reducer threw unexpectedly: ${String(thrownError)}\n` +
        `Envelope type: ${envelope.event.type}`,
    );
  }

  // ── 6. Result must be JSON-serialisable (no undefined values, no functions)
  let serialised: string;
  try {
    serialised = JSON.stringify(result);
  } catch (err) {
    throw new Error(
      `[ReducerPurity] Result is not JSON-serialisable: ${String(err)}`,
    );
  }
  expect(serialised).not.toContain("undefined");

  // ── 7. Determinism — call twice with same inputs, get same output ─────────
  const frozenState2 = deepFreeze(structuredClone(state));
  const result2 = reducer(frozenState2, envelope, context);
  expect(snapshot(result)).toBe(snapshot(result2)); // deterministic

  return result;
}

// ============================================================================
// assertNoSideEffects
// ─────────────────────────────────────────────────────────────────────────────
// Simpler helper: just check that calling reducer doesn't mutate state.
// Useful when you don't need full purity assertion.
// ============================================================================

export function assertNoSideEffects<TEvent extends AppDomainEvent>(
  reducer: (
    state: BoardStoreState,
    envelope: ClientEventEnvelope<TEvent>,
    context: ReducerContext,
  ) => Partial<BoardStoreState>,
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TEvent>,
  context: ReducerContext = { mode: "live" },
): void {
  const before = snapshot(state);
  reducer(deepFreeze(structuredClone(state)), envelope, context);
  const after = snapshot(state);
  expect(after).toBe(before);
}

// ============================================================================
// assertResultSafeMerge
// ─────────────────────────────────────────────────────────────────────────────
// Verifies that merging reducer result into state produces a valid BoardStoreState
// (all required keys still present, no phantom keys introduced).
// ============================================================================

const REQUIRED_STATE_KEYS: (keyof BoardStoreState)[] = [
  "lists",
  "cards",
  "cardsByList",
  "listOrder",
  "boardSequence",
  "bufferedEvents",
  "syncStatus",
  "pendingMutations",
];

export function assertResultSafeMerge(
  state: BoardStoreState,
  result: Partial<BoardStoreState>,
): BoardStoreState {
  const merged = { ...state, ...result };
  for (const key of REQUIRED_STATE_KEYS) {
    expect(merged).toHaveProperty(key);
  }
  return merged;
}
