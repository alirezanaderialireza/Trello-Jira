// packages/domain/src/ordering/position.constants.ts

export const POSITION_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const POSITION_BASE =
  POSITION_ALPHABET.length;

export const POSITION_MIN_CHAR =
  POSITION_ALPHABET[0];

export const POSITION_MAX_CHAR =
  POSITION_ALPHABET[
    POSITION_BASE - 1
  ];

export const POSITION_DEFAULT_MID_CHAR =
  POSITION_ALPHABET[
    Math.floor(POSITION_BASE / 2)
  ];

export const POSITION_MAX_LENGTH = 64;

export const POSITION_MAX_MIDPOINT_DEPTH = 32;

export const POSITION_CHAR_TO_INDEX: Record<
  string,
  number
> = Object.create(null);

for (
  let index = 0;
  index < POSITION_ALPHABET.length;
  index++
) {
  POSITION_CHAR_TO_INDEX[
    POSITION_ALPHABET[index]
  ] = index;
}