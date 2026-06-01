// apps/web/src/lib/checklists/persianNumerals.ts
//
// Tiny helper for "Persian numerals" formatting. The `Intl.NumberFormat`
// `fa-IR` locale ALREADY converts digits, but it also adds locale-
// specific group separators that we don't always want (e.g. for
// "3/5" we want "۳/۵", not "۳/۵" with a thousands separator on
// either side).
//
// This wrapper keeps the API explicit and avoids re-creating the
// formatter on every render.

const formatter = new Intl.NumberFormat("fa-IR", {
  // Don't add the Arabic-Persian thousands separator for small numbers
  // (we use this for "3/5"-style ratios, not money).
  useGrouping: false,
  maximumFractionDigits: 0,
});

/**
 * Format a non-negative integer in Persian numerals.
 *
 * @example
 *   toPersianNumber(0)   // "۰"
 *   toPersianNumber(15)  // "۱۵"
 *   toPersianNumber(100) // "۱۰۰"
 */
export function toPersianNumber(n: number): string {
  return formatter.format(n);
}
