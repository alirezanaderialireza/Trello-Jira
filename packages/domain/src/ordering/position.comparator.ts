// packages/domain/src/ordering/position.comparator.ts

import type { Position } from "./position";

import {
  POSITION_CHAR_TO_INDEX,
  POSITION_MIN_CHAR,
} from "./position.constants";

import { validatePosition } from "./position.validators";

function getPositionIndex(
  char: string,
): number {
  const index =
    POSITION_CHAR_TO_INDEX[char];

  if (index === undefined) {
    throw new Error(
      `Invalid position character: "${char}"`,
    );
  }

  return index;
}

/**
 * Deterministic lexicographic comparator
 *
 * Guarantees:
 * - Runtime-stable
 * - Locale-independent
 * - Prefix-safe
 * - Replay-safe
 */
export function comparePositions(
  left: Position,
  right: Position,
): number {
  validatePosition(left);
  validatePosition(right);

  const maxLength = Math.max(
    left.length,
    right.length,
  );

  for (
    let index = 0;
    index < maxLength;
    index++
  ) {
    const leftChar =
      left[index] ??
      POSITION_MIN_CHAR;

    const rightChar =
      right[index] ??
      POSITION_MIN_CHAR;

    const diff =
      getPositionIndex(leftChar) -
      getPositionIndex(rightChar);

    if (diff !== 0) {
      return diff;
    }
  }

  /**
   * Prefix-safe ordering:
   *
   * U < U0
   */
  return left.length - right.length;
}