// apps/web/src/lib/background/index.ts
//
// Shared background utilities (lib/ = shared territory).
//
// `renderBackgroundCss` and `isBackgroundData` live here so that
// features/board components (CardItem, CardCover) can import them
// without triggering the boundaries linter's cross-feature ban
// (features/board → features/board-settings is FORBIDDEN).
//
// The palette definitions (COLOR_PRESETS, GRADIENT_PRESETS) are also
// re-exported from features/board-settings/lib/backgroundPresets so
// board-settings components can continue using that path, while
// board components use this shared path.
//
// Implementation is self-contained — no imports from features/*.

export type BackgroundType = "color" | "gradient";

export interface BackgroundData {
  type: BackgroundType;
  id:   string;
}

export interface ColorPreset {
  id:   string;
  name: string;
  hsl:  string;
}

export interface GradientPreset {
  id:          string;
  name:        string;
  gradientCss: string;
}

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { id: "blue",      name: "آبی",        hsl: "hsl(213, 90%, 55%)" },
  { id: "indigo",    name: "نیلی",       hsl: "hsl(245, 70%, 55%)" },
  { id: "purple",    name: "بنفش",       hsl: "hsl(270, 65%, 55%)" },
  { id: "pink",      name: "صورتی",      hsl: "hsl(330, 75%, 60%)" },
  { id: "red",       name: "قرمز",       hsl: "hsl(0, 80%, 55%)"   },
  { id: "orange",    name: "نارنجی",     hsl: "hsl(20, 90%, 55%)"  },
  { id: "yellow",    name: "زرد",        hsl: "hsl(45, 95%, 55%)"  },
  { id: "green",     name: "سبز",        hsl: "hsl(142, 70%, 45%)" },
  { id: "teal",      name: "فیروزه‌ای",   hsl: "hsl(180, 65%, 45%)" },
  { id: "forest",    name: "جنگلی",      hsl: "hsl(150, 50%, 30%)" },
  { id: "gray",      name: "خاکستری",    hsl: "hsl(220, 15%, 45%)" },
  { id: "charcoal",  name: "زغالی",      hsl: "hsl(220, 15%, 25%)" },
] as const;

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  { id: "sunset",      name: "غروب",   gradientCss: "linear-gradient(135deg, hsl(20, 90%, 55%) 0%, hsl(330, 75%, 60%) 100%)" },
  { id: "ocean",       name: "اقیانوس", gradientCss: "linear-gradient(135deg, hsl(213, 90%, 55%) 0%, hsl(180, 65%, 45%) 100%)" },
  { id: "forest-grad", name: "جنگل",   gradientCss: "linear-gradient(135deg, hsl(142, 70%, 45%) 0%, hsl(150, 50%, 30%) 100%)" },
  { id: "aurora",      name: "شفق",    gradientCss: "linear-gradient(135deg, hsl(270, 65%, 55%) 0%, hsl(213, 90%, 55%) 100%)" },
  { id: "fire",        name: "آتشین",   gradientCss: "linear-gradient(135deg, hsl(0, 80%, 55%) 0%, hsl(45, 95%, 55%) 100%)" },
  { id: "pastel",      name: "پاستل",   gradientCss: "linear-gradient(135deg, hsl(213, 70%, 75%) 0%, hsl(330, 70%, 80%) 100%)" },
  { id: "night",       name: "شب",     gradientCss: "linear-gradient(135deg, hsl(220, 30%, 20%) 0%, hsl(270, 40%, 30%) 100%)" },
  { id: "spring",      name: "بهار",    gradientCss: "linear-gradient(135deg, hsl(142, 65%, 70%) 0%, hsl(45, 90%, 75%) 100%)" },
] as const;

export const DEFAULT_BACKGROUND_CSS = "hsl(213, 90%, 55%)";
export const DEFAULT_BACKGROUND_DATA: BackgroundData = { type: "color", id: "blue" };

/**
 * Type guard: narrows unknown JSONB to BackgroundData.
 * Used before calling renderBackgroundCss.
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
 * Convert a BackgroundData token into a CSS background value.
 * Falls back to DEFAULT_BACKGROUND_CSS for null / invalid shapes.
 */
export function renderBackgroundCss(data: unknown): string {
  if (!isBackgroundData(data)) return DEFAULT_BACKGROUND_CSS;

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
