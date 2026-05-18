// packages/domain/src/ordering/position.validators.ts

import {
  POSITION_CHAR_TO_INDEX,
  POSITION_MAX_LENGTH,
} from "./position.constants";

import { InvalidPositionError } from "./position.errors";

import type { Position } from "./position";

export function isValidPosition(
  value: unknown,
): value is Position {
  if (typeof value !== "string") {
    return false;
  }

  if (value.length === 0) {
    return false;
  }

  if (
    value.length >
    POSITION_MAX_LENGTH
  ) {
    return false;
  }

  for (const char of value) {
    if (
      POSITION_CHAR_TO_INDEX[char] ===
      undefined
    ) {
      return false;
    }
  }

  return true;
}

export function validatePosition(
  value: unknown,
): asserts value is Position {
  if (!isValidPosition(value)) {
    throw new InvalidPositionError();
  }
}