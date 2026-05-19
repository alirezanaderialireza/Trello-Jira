// apps/web/src/features/board/store/event-application/sequence.ts
//
// Phase-0 #2 — Sequence type correctness.
//
// Root problem:
//   boardSequence is stored as a decimal string ("1042") so it survives
//   JSON serialisation without losing precision (JS Number loses precision
//   above 2^53-1 ≈ 9 quadrillion; a production board will never reach that,
//   but storing as string and converting to BigInt for comparison is the
//   standard safe pattern).
//
//   The bug was: callers did BigInt(state.boardSequence) everywhere inline,
//   but if boardSequence ever contained a non-integer string (e.g. "" after
//   a bad SSR response, or "0.5" from a float sequence), BigInt() throws a
//   SyntaxError which crashes the reconciler silently swallowed by the
//   dispatcher catch().
//
// Fix:
//   • parseSequence(s) — safe parse; returns 0n on invalid input.
//   • sequenceToString(n) — canonical serialisation.
//   • compareSequences(a, b) — type-safe comparator.
//   • isContiguous(current, incoming) — the only check the reconciler needs.

// ============================================================================
// Core helpers
// ============================================================================

const SEQ_REGEX = /^\d+$/;

/**
 * Safely parse a sequence string to BigInt.
 * Returns 0n for any invalid input (empty string, float, NaN, undefined).
 */
export function parseSequence(s: string | undefined | null): bigint {
  if (!s) return 0n;
  const trimmed = s.trim();
  if (!SEQ_REGEX.test(trimmed)) return 0n;
  try {
    // BigInt("00042") === 42n — handles leading zeros correctly
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

/**
 * Serialise a BigInt sequence back to its canonical decimal string.
 */
export function sequenceToString(n: bigint): string {
  return n.toString();
}

/**
 * Numeric comparator for two sequence strings.
 * Returns negative / 0 / positive (same contract as Array.sort compareFn).
 */
export function compareSequences(a: string, b: string): number {
  const diff = parseSequence(a) - parseSequence(b);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}

/**
 * True when `incoming` is exactly one step ahead of `current`.
 * This is the only condition under which the reconciler should apply
 * an event immediately (no gap, no duplicate).
 */
export function isContiguous(current: string, incoming: string): boolean {
  return parseSequence(incoming) === parseSequence(current) + 1n;
}

/**
 * True when `incoming` is strictly newer than `current`.
 * Used for stale-event detection.
 */
export function isNewer(current: string, incoming: string): boolean {
  return parseSequence(incoming) > parseSequence(current);
}

/**
 * True when `incoming` is a duplicate or stale event.
 */
export function isStaleOrDuplicate(current: string, incoming: string): boolean {
  return parseSequence(incoming) <= parseSequence(current);
}
