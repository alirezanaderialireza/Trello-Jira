// packages/domain/src/ordering/position.midpoint.ts

import type { Position } from "./position";

import {
  POSITION_ALPHABET,
  POSITION_BASE,
  POSITION_CHAR_TO_INDEX,
  POSITION_MAX_LENGTH,
  POSITION_MAX_MIDPOINT_DEPTH,
  POSITION_MIN_CHAR,
} from "./position.constants";

import { PositionCollisionError } from "./position.errors";

function getPositionIndex(
  char: string,
): number {
  const index =
    POSITION_CHAR_TO_INDEX[char];

  if (index === undefined) {
    throw new PositionCollisionError(
      `Invalid position character: "${char}"`,
    );
  }

  return index;
}

/**
 * Deterministic midpoint generator
 *
 * Guarantees:
 * - Replay-safe
 * - Prefix-safe
 * - Stable across runtimes
 * - Collision-aware
 */
export function midpoint(
  left: Position,
  right: Position,
): Position {
  let depth = 0;

  let result = "";

  while (
    depth <
    POSITION_MAX_MIDPOINT_DEPTH
  ) {
    const rawLeft =
      left[depth];

    const rawRight =
      right[depth];

    const leftChar =
      rawLeft ??
      POSITION_MIN_CHAR;

    const leftIndex =
      getPositionIndex(leftChar);

    /**
     * اگر right در این depth تمام شده باشد،
     * از انتهای alphabet قرض می‌گیریم.
     */
    const rightIndex =
      rawRight === undefined
        ? POSITION_BASE
        : getPositionIndex(
            rawRight,
          );

    /**
     * Space found
     */
    if (
      rightIndex - leftIndex >
      1
    ) {
      const middleIndex =
        Math.floor(
          (leftIndex +
            rightIndex) /
            2,
        );

      const candidate =
        result +
        POSITION_ALPHABET[
          middleIndex
        ];

      if (
        candidate.length >
        POSITION_MAX_LENGTH
      ) {
        throw new PositionCollisionError();
      }

      return candidate;
    }

    /**
     * Need deeper precision
     */
    result += leftChar;

    depth++;
  }

  /**
   * Density explosion
   */
  throw new PositionCollisionError(
    "POSITION_COLLISION_RESOLVING",
  );
}