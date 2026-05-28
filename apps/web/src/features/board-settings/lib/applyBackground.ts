// apps/web/src/features/board-settings/lib/applyBackground.ts
//
// Token → CSS resolver for board backgrounds.
//
// `renderBackgroundCss(data)` accepts the persisted JSONB shape
// (BackgroundData | null | unknown) and returns a CSS value safe to
// drop into `style.background` or a CSS variable.
//
// Defensive parsing:
//   The DB column is `jsonb` with only a "must be a JSON object"
//   CHECK constraint — there's no Zod schema enforced server-side.
//   Boards persisted before F5b might have arbitrary shapes (legacy
//   { hexColor: "..." }, raw CSS strings, etc.). We narrow the input
//   in two steps:
//     1. Type-guard the shape at runtime.
//     2. Look up the id in the matching preset table.
//   Anything that fails either step falls back to DEFAULT_BACKGROUND_CSS
//   so the board never renders blank.
//
// Why a CSS string (not a CSSStyleDeclaration partial):
//   The drawer's live-preview path (D3 + the user's refinement —
//   write to `document.body.style.setProperty('--board-bg', css)`)
//   needs a single string value. Returning a structured object would
//   force every consumer to know whether to read `.background` or
//   `.backgroundImage` for gradients vs. solids.

import {
  COLOR_PRESETS,
  GRADIENT_PRESETS,
  DEFAULT_BACKGROUND_CSS,
  type BackgroundData,
  type BackgroundType,
} from "./backgroundPresets";

// Re-export the default so consumers can pull every background-
// related symbol from this single resolver module without having
// to know whether a constant is co-located with the palette
// (backgroundPresets) or with the resolver (applyBackground).
// `renderBackgroundCss` already returns this value internally for
// unknown / null shapes; consumers seeding the var() fallback on
// the canvas (e.g. board page.tsx) need the same constant.
export { DEFAULT_BACKGROUND_CSS } from "./backgroundPresets";

/**
 * Convert persisted background data into a CSS background value.
 *
 * @param data Token-based shape `{ type, id }`, or any unknown JSONB
 *             value (legacy / corrupted rows). `null` and unknown
 *             shapes both fall back to the default.
 */
export function renderBackgroundCss(data: unknown): string {
  if (!isBackgroundData(data)) {
    return DEFAULT_BACKGROUND_CSS;
  }

  if (data.type === "color") {
    const preset = COLOR_PRESETS.find((p) => p.id === data.id);
    return preset?.hsl ?? DEFAULT_BACKGROUND_CSS;
  }

  if (data.type === "gradient") {
    const preset = GRADIENT_PRESETS.find((p) => p.id === data.id);
    return preset?.gradientCss ?? DEFAULT_BACKGROUND_CSS;
  }

  return DEFAULT_BACKGROUND_CSS;
}

/**
 * Narrow an unknown JSONB value to BackgroundData. Used by both the
 * resolver above and the BackgroundTab when reading the persisted
 * value to highlight the active swatch.
 */
export function isBackgroundData(data: unknown): data is BackgroundData {
  if (data === null || data === undefined) return false;
  if (typeof data !== "object") return false;
  const obj = data as { type?: unknown; id?: unknown };
  if (obj.type !== "color" && obj.type !== "gradient") return false;
  if (typeof obj.id !== "string" || obj.id.length === 0) return false;
  return true;
}

/**
 * CSS variable name read by the board canvas. Set on `document.body`
 * by the BoardBackgroundController on first paint and rewritten
 * by the BackgroundTab on hover-preview. The board canvas reads it
 * via `style={{ background: "var(--board-bg, ...)" }}` with a
 * fallback to the default so server-side render is correct.
 */
export const BOARD_BG_CSS_VAR = "--board-bg";

/**
 * Helper for the BackgroundTab's hover handlers. Constructs the CSS
 * value for an arbitrary `(type, id)` pair without going through the
 * full BackgroundData round-trip.
 */
export function previewCssFor(type: BackgroundType, id: string): string {
  return renderBackgroundCss({ type, id });
}
