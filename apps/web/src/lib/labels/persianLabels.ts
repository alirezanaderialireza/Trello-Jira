// apps/web/src/lib/labels/persianLabels.ts
//
// Boundary-safe copy of @repo/domain/labels → COLOR_TOKEN_LABELS_FA.
//
// The features-layer linter forbids runtime imports from @repo/domain
// (only `import type { ... }` is allowed — see architecture.md "type-
// only carveout"). The 12-token Persian-name dictionary is a runtime
// value, so we copy it here. Keep this file in lock-step with
// `packages/domain/src/labels/types.ts`:
//   • COLOR_TOKENS — the canonical ordering (RTL grid renders this
//     left→right which the user perceives as right→left thanks to
//     CSS `direction: rtl`; D10 keeps the array order intact).
//   • COLOR_TOKEN_LABELS_FA — Persian display names for the picker
//     tooltips, swatch aria-labels, and badge accessible names (D13).
//
// Sync rule: if either constant changes in @repo/domain, update this
// file in the same PR. The labels-conventions steering doc lists this
// as a "Don't" — never let the two drift.

import type { ColorToken } from "@repo/domain";

/**
 * Canonical ordering of the 12 colour tokens. The CHECK constraint on
 * `labels.color_token` (migration 0007) enforces this same set on the
 * server. Adding a token here also requires:
 *   1. Update COLOR_TOKENS in `packages/domain/src/labels/types.ts`.
 *   2. Update the Drizzle `check()` in `packages/db/src/schema/labels.ts`.
 *   3. Add a new migration to extend the SQL CHECK constraint.
 *   4. Add the new token to TOKEN_COLOR_MAP in this folder.
 */
export const COLOR_TOKENS = [
  "red.500",
  "orange.500",
  "yellow.500",
  "green.500",
  "teal.500",
  "blue.500",
  "indigo.500",
  "purple.500",
  "pink.500",
  "gray.500",
  "brown.500",
  "black",
] as const satisfies readonly ColorToken[];

/**
 * Persian display names for each colour token. Sourced into:
 *   • LabelBadge — `aria-label="<color>: <name>"` (D13)
 *   • CreateLabelForm swatch grid — `aria-label` per swatch
 *   • LabelPicker — tooltip on hover
 */
export const COLOR_TOKEN_LABELS_FA: Record<ColorToken, string> = {
  "red.500":    "قرمز",
  "orange.500": "نارنجی",
  "yellow.500": "زرد",
  "green.500":  "سبز",
  "teal.500":   "فیروزه‌ای",
  "blue.500":   "آبی",
  "indigo.500": "نیلی",
  "purple.500": "بنفش",
  "pink.500":   "صورتی",
  "gray.500":   "خاکستری",
  "brown.500":  "قهوه‌ای",
  "black":      "سیاه",
};

/**
 * Type guard for arbitrary strings coming off the wire (e.g. a label
 * row whose colour_token DB column drifts past the CHECK constraint
 * during a future migration). Lets the badge fall back to a neutral
 * style instead of crashing the React tree.
 */
export function isKnownColorToken(token: string): token is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(token);
}
