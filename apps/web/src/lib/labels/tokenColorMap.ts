// apps/web/src/lib/labels/tokenColorMap.ts
//
// Single source of truth for how a `ColorToken` renders in the UI.
//
// The map produces three derivatives per token:
//   • bg          — the hex background colour (mirrors Tailwind's 500
//                   stop, with `brown.500 → amber-800` and `black →
//                   slate-800` because Tailwind has no brown stop and
//                   `bg-black` clashes with the slate-900 sidebar).
//   • text        — the readable foreground colour token. Picked once
//                   per palette entry against the WCAG AA contrast
//                   threshold; see TOKEN_TEXT_DECISION inline. (D20)
//   • persianName — re-exported from persianLabels.ts so consumers can
//                   read both visual and accessibility data from a
//                   single record.
//
// Why hex (not Tailwind class names): the picker, badge, and live-
// preview paths apply the colour via inline `style={{ backgroundColor }}`
// or a CSS variable. Tailwind would require `safelist` entries plus
// JIT-style class concatenation, both of which read worse than the
// 12-row table here.

import type { ColorToken } from "@repo/domain";

import { COLOR_TOKEN_LABELS_FA, COLOR_TOKENS } from "./persianLabels";

export interface TokenStyle {
  /** Hex background; safe for `style={{ backgroundColor }}` and CSS variables. */
  readonly bg:          string;
  /** Foreground hex matching the readable Tailwind text-* token from D20. */
  readonly text:        string;
  /** Persian display name (mirrors COLOR_TOKEN_LABELS_FA[token]). */
  readonly persianName: string;
}

/**
 * Foreground decision. Yellow (`#EAB308`) is the only stop bright
 * enough to fail WCAG AA against white text — it gets `slate-900`.
 * Every other 500-stop is dark enough for white. `brown.500 →
 * amber-800` and `black → slate-800` are both deep enough for white.
 *
 * If you change a `bg` value, re-check this contrast decision against
 * https://webaim.org/resources/contrastchecker/ before flipping the
 * `text` field. The `darkText` helper below is a convenience for
 * yellow-style swaps in future palette additions.
 */
const SLATE_900 = "#0F172A";
const WHITE     = "#FFFFFF";

/** Tokens whose hex needs dark text to meet WCAG AA against white. */
const NEEDS_DARK_TEXT: ReadonlySet<ColorToken> = new Set([
  "yellow.500",
]);

const TOKEN_BG: Record<ColorToken, string> = {
  "red.500":    "#EF4444", // tailwind red-500
  "orange.500": "#F97316", // tailwind orange-500
  "yellow.500": "#EAB308", // tailwind yellow-500
  "green.500":  "#22C55E", // tailwind green-500
  "teal.500":   "#14B8A6", // tailwind teal-500
  "blue.500":   "#3B82F6", // tailwind blue-500
  "indigo.500": "#6366F1", // tailwind indigo-500
  "purple.500": "#A855F7", // tailwind purple-500
  "pink.500":   "#EC4899", // tailwind pink-500
  "gray.500":   "#6B7280", // tailwind gray-500
  // Tailwind has no brown stop; amber-800 reads as a warm brown.
  "brown.500":  "#92400E",
  // bg-black is too cold against the slate-900 board chrome; slate-800
  // gives a softer "near-black" that doesn't visually merge with the
  // dark canvas.
  "black":      "#1F2937",
};

/** Frozen lookup keyed by ColorToken. Consumers should never mutate. */
export const TOKEN_COLOR_MAP: Readonly<Record<ColorToken, TokenStyle>> =
  Object.freeze(
    Object.fromEntries(
      COLOR_TOKENS.map((token) => [
        token,
        Object.freeze({
          bg:          TOKEN_BG[token],
          text:        NEEDS_DARK_TEXT.has(token) ? SLATE_900 : WHITE,
          persianName: COLOR_TOKEN_LABELS_FA[token],
        } satisfies TokenStyle),
      ]),
    ) as Record<ColorToken, TokenStyle>,
  );

/**
 * Defensive lookup for arbitrary strings (e.g. a `label.colorToken`
 * value coming straight off the wire). Returns a neutral grey style
 * for unknown tokens so the badge never crashes the tree.
 */
const FALLBACK_STYLE: TokenStyle = Object.freeze({
  bg:          "#94A3B8", // slate-400
  text:        WHITE,
  persianName: "—",
});

export function getTokenStyle(token: string): TokenStyle {
  if (token in TOKEN_COLOR_MAP) {
    return TOKEN_COLOR_MAP[token as ColorToken];
  }
  return FALLBACK_STYLE;
}
