// packages/domain/src/ordering/position.generator.ts

import type { Position } from "./position";

import {
  POSITION_DEFAULT_MID_CHAR,
  POSITION_MAX_CHAR,
  POSITION_MIN_CHAR,
} from "./position.constants";

import { comparePositions } from "./position.comparator";

import { PositionCollisionError } from "./position.errors";

import { midpoint } from "./position.midpoint";

import { validatePosition } from "./position.validators";

/**
 * Deterministic position generator
 *
 * Supported modes:
 * - Empty list
 * - Insert at top
 * - Insert at bottom
 * - Insert between
 */
export function generatePosition(
  prev?: Position,
  next?: Position,
): Position {
  if (prev !== undefined) {
    validatePosition(prev);
  }

  if (next !== undefined) {
    validatePosition(next);
  }

  /**
   * Integrity guard
   */
  if (
    prev &&
    next &&
    comparePositions(prev, next) >= 0
  ) {
    throw new PositionCollisionError(
      "POSITION_COLLISION_RESOLVING",
    );
  }

  /**
   * Empty list
   */
  if (!prev && !next) {
    return POSITION_DEFAULT_MID_CHAR;
  }

  /**
   * Insert at top
   */
  if (!prev && next) {
    if (
      next === POSITION_MIN_CHAR
    ) {
      throw new PositionCollisionError(
        "POSITION_COLLISION_RESOLVING",
      );
    }

    return midpoint(
      POSITION_MIN_CHAR,
      next,
    );
  }

  /**
   * Insert at bottom
   */
  if (prev && !next) {
    const allMax =
      [...prev].every(
        (char) =>
          char ===
          POSITION_MAX_CHAR,
      );

    if (allMax) {
      return (
        prev +
        POSITION_DEFAULT_MID_CHAR
      );
    }

    return midpoint(
      prev,
      POSITION_MAX_CHAR,
    );
  }

  /**
   * Insert between
   */
  return midpoint(
    prev!,
    next!,
  );
}