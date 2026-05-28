// apps/web/src/features/board-settings/lib/backgroundPresets.ts
//
// Curated palette for the board background picker (F5b).
//
// Why a token-based shape (D2 — agreed with the user):
//   • The persisted shape is { type, id } — a tiny JSON object that
//     survives palette evolution. If we later swap the exact HSL of
//     "آبی" the existing boards keep working because they reference
//     `id: "blue"`, not the literal HSL.
//   • The resolver `renderBackgroundCss` (see ./applyBackground.ts)
//     is the single place that turns a token into a CSS value.
//
// Two sets:
//   • COLOR_PRESETS    — 12 solid colors (HSL palette tuned to read
//                         well in dark and light board content).
//   • GRADIENT_PRESETS — 8 linear gradients at 135° using the same
//                         palette so chips inside the board (lists,
//                         cards) stay legible.
//
// All names are Persian. The id is ASCII so it round-trips through
// JSONB / URL params / logs without encoding surprises.

export type BackgroundType = "color" | "gradient";

export interface BackgroundData {
  type: BackgroundType;
  id: string;
}

export interface ColorPreset {
  id: string;
  /** Persian display name. */
  name: string;
  /** CSS color value (HSL syntax). */
  hsl: string;
}

export interface GradientPreset {
  id: string;
  /** Persian display name. */
  name: string;
  /** CSS background-image value (linear-gradient). */
  gradientCss: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { id: "blue",      name: "آبی",         hsl: "hsl(213, 90%, 55%)" },
  { id: "indigo",    name: "نیلی",        hsl: "hsl(245, 70%, 55%)" },
  { id: "purple",    name: "بنفش",        hsl: "hsl(270, 65%, 55%)" },
  { id: "pink",      name: "صورتی",       hsl: "hsl(330, 75%, 60%)" },
  { id: "red",       name: "قرمز",        hsl: "hsl(0, 80%, 55%)"   },
  { id: "orange",    name: "نارنجی",      hsl: "hsl(20, 90%, 55%)"  },
  { id: "yellow",    name: "زرد",         hsl: "hsl(45, 95%, 55%)"  },
  { id: "green",     name: "سبز",         hsl: "hsl(142, 70%, 45%)" },
  { id: "teal",      name: "فیروزه‌ای",    hsl: "hsl(180, 65%, 45%)" },
  { id: "forest",    name: "جنگلی",       hsl: "hsl(150, 50%, 30%)" },
  { id: "gray",      name: "خاکستری",     hsl: "hsl(220, 15%, 45%)" },
  { id: "charcoal",  name: "زغالی",       hsl: "hsl(220, 15%, 25%)" },
] as const;

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  {
    id: "sunset",
    name: "غروب",
    gradientCss: "linear-gradient(135deg, hsl(20, 90%, 55%) 0%, hsl(330, 75%, 60%) 100%)",
  },
  {
    id: "ocean",
    name: "اقیانوس",
    gradientCss: "linear-gradient(135deg, hsl(213, 90%, 55%) 0%, hsl(180, 65%, 45%) 100%)",
  },
  {
    id: "forest-grad",
    name: "جنگل",
    gradientCss: "linear-gradient(135deg, hsl(142, 70%, 45%) 0%, hsl(150, 50%, 30%) 100%)",
  },
  {
    id: "aurora",
    name: "شفق",
    gradientCss: "linear-gradient(135deg, hsl(270, 65%, 55%) 0%, hsl(213, 90%, 55%) 100%)",
  },
  {
    id: "fire",
    name: "آتشین",
    gradientCss: "linear-gradient(135deg, hsl(0, 80%, 55%) 0%, hsl(45, 95%, 55%) 100%)",
  },
  {
    id: "pastel",
    name: "پاستل",
    gradientCss: "linear-gradient(135deg, hsl(213, 70%, 75%) 0%, hsl(330, 70%, 80%) 100%)",
  },
  {
    id: "night",
    name: "شب",
    gradientCss: "linear-gradient(135deg, hsl(220, 30%, 20%) 0%, hsl(270, 40%, 30%) 100%)",
  },
  {
    id: "spring",
    name: "بهار",
    gradientCss: "linear-gradient(135deg, hsl(142, 65%, 70%) 0%, hsl(45, 90%, 75%) 100%)",
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Default fallback (used when backgroundData is null / unknown / malformed)
// ─────────────────────────────────────────────────────────────────────────────
//
// Matches the legacy hardcoded `bg-blue-600` on the board page header so
// boards created before F5b keep their visual identity until an admin
// picks a new one.

export const DEFAULT_BACKGROUND_CSS = "hsl(213, 90%, 55%)";
export const DEFAULT_BACKGROUND_DATA: BackgroundData = {
  type: "color",
  id: "blue",
};
