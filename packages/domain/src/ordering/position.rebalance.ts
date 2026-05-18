// packages/domain/src/ordering/position.rebalance.ts

import type { Position } from "./position";

import {
  POSITION_ALPHABET,
  POSITION_BASE,
  POSITION_MAX_LENGTH,
} from "./position.constants";

import {
  InvalidPositionTopologyError,
} from "./position.errors";

import { validatePosition } from "./position.validators";

/**
 * Detects ordering density explosion
 */
export function shouldRebalancePosition(
  position: Position,
): boolean {
  validatePosition(position);

  return (
    position.length >=
    POSITION_MAX_LENGTH * 0.75
  );
}

/**
 * Generates balanced deterministic positions
 *
 * Used for:
 * - chain rebalance
 * - density recovery
 * - topology normalization
 */
export function generateBalancedPositions(
  count: number,
): Position[] {
  if (
    !Number.isSafeInteger(count) ||
    count < 0
  ) {
    throw new InvalidPositionTopologyError(
      "Invalid rebalance count",
    );
  }

  if (count === 0) {
    return [];
  }

  const step = Math.floor(
    POSITION_BASE / (count + 1),
  );

  if (step <= 0) {
    throw new InvalidPositionTopologyError(
      "Insufficient rebalance space",
    );
  }

  return Array.from(
    { length: count },
    (_, index) =>
      POSITION_ALPHABET[
        Math.min(
          (index + 1) * step,
          POSITION_BASE - 1,
        )
      ] as Position,
  );
}