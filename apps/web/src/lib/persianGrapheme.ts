// apps/web/src/lib/persianGrapheme.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Persian-aware grapheme utilities.
//
// Avatar fallbacks across the shell (TopNav profile dropdown, sidebar
// member chips, comment author bubbles) need to extract a single
// "first character" from a display name. The naive `name[0]` works for
// ASCII, but for Persian text it produces wrong results because:
//
//   • A Persian letter sequence like "علی" — `"علی"[0]` returns "ع",
//     which IS correct here, but...
//   • Some letters combine with ZWNJ (zero-width non-joiner U+200C) or
//     diacritics (تشدید, کسره, …) — `"\u062A\u0651"[0]` returns just
//     the base letter without its combining mark, which renders as
//     a half-character.
//   • Code-point indexing (`name.codePointAt(0)`) handles surrogate
//     pairs but not multi-codepoint graphemes.
//
// `Intl.Segmenter('fa', { granularity: 'grapheme' })` returns proper
// grapheme clusters, which is the user-perceived "single character"
// definition. This is the correct API for avatar initials.
//
// We export TWO helpers:
//   • `getFirstGrapheme(name)` — the first grapheme cluster, or "?"
//     if the input is empty / cannot be segmented.
//   • `getInitials(name, count)` — the first `count` graphemes
//     (default 1). Useful when a designer wants two-letter initials
//     ("ا.ر" for "علیرضا رضایی"); Phase 1.1 uses count=1 only.
//
// Browser support note: Intl.Segmenter is supported in Chrome 87+,
// Safari 14.1+, Firefox 125+. The Next.js polyfill matrix covers our
// target audience. `Intl.Segmenter` may be undefined in unit-test
// environments running on older Node — we guard with a `typeof`
// check and fall back to code-point indexing.
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK = "?";

/**
 * Returns the first grapheme cluster of `name`, or "?" if the input
 * cannot be segmented (empty string, null, undefined, segmenter-less
 * runtime).
 */
export function getFirstGrapheme(name: string | null | undefined): string {
  if (!name) return FALLBACK;

  // Trim leading whitespace so " علی" → "ع" not " ".
  const trimmed = name.trim();
  if (trimmed.length === 0) return FALLBACK;

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("fa", { granularity: "grapheme" });
    const iterator = segmenter.segment(trimmed)[Symbol.iterator]();
    const first = iterator.next();
    if (!first.done && first.value && typeof first.value.segment === "string") {
      return first.value.segment;
    }
  }

  // Fallback: Array.from handles surrogate pairs but not combining
  // marks. Acceptable degradation for the < 1% of agents without
  // Intl.Segmenter — they still see the right base letter, just
  // potentially missing a diacritic.
  const arr = Array.from(trimmed);
  return arr.length > 0 ? (arr[0] ?? FALLBACK) : FALLBACK;
}

/**
 * Returns the first `count` grapheme clusters joined into a string.
 * Default count is 1, matching the avatar initial use case in F4.
 */
export function getInitials(
  name: string | null | undefined,
  count = 1,
): string {
  if (!name) return FALLBACK;
  const trimmed = name.trim();
  if (trimmed.length === 0) return FALLBACK;
  if (count < 1) return "";

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("fa", { granularity: "grapheme" });
    const out: string[] = [];
    for (const seg of segmenter.segment(trimmed)) {
      // Skip whitespace graphemes — "علی رضا" with count=2 should
      // produce "اع" not "ا " (space + first of "رضا"). Iterating
      // until we have `count` non-whitespace graphemes mirrors the
      // intuitive UI behaviour.
      if (seg.segment.trim().length === 0) continue;
      out.push(seg.segment);
      if (out.length >= count) break;
    }
    return out.length > 0 ? out.join("") : FALLBACK;
  }

  // Fallback path
  const arr = Array.from(trimmed).filter((c) => c.trim().length > 0);
  return arr.slice(0, count).join("") || FALLBACK;
}
