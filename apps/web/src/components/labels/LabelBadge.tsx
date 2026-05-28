// apps/web/src/components/labels/LabelBadge.tsx
//
// Pure presentational badge for a single label. Three size variants:
//
//   bar — Trello-style coloured bar (no text). Used by CardItem to
//         render the top-3 labels compactly without overwhelming the
//         card preview (D11 hybrid). Still carries an aria-label so
//         screen readers announce the label name.
//   sm  — small pill with text. Used in dense surfaces like the
//         picker checkbox list and CardItem hover-expanded view.
//   md  — full pill with text. Default — used by the card-detail
//         section, the manager rows, and any other "primary" surface.
//
// No hooks, no state, no event handlers — Server-Component-friendly.
// Consumers wrap a button or interactive element around the badge if
// they need a click target.

import type { ColorToken } from "@repo/domain";

import { getTokenStyle } from "@/lib/labels/tokenColorMap";

export type LabelBadgeSize = "bar" | "sm" | "md";

interface Props {
  name: string;
  /**
   * Plain string off the wire (LabelDto.colorToken). `getTokenStyle`
   * handles unknown tokens with a neutral grey fallback so a future
   * palette extension on the server doesn't break old client builds.
   */
  colorToken: string;
  size?: LabelBadgeSize;
  /** Optional extra classes applied to the outer element. */
  className?: string;
  /** Optional title attribute — defaults to the aria-label text. */
  title?: string;
}

export function LabelBadge({
  name,
  colorToken,
  size = "md",
  className = "",
  title,
}: Props) {
  const style = getTokenStyle(colorToken);

  // D13: aria-label = "<colour Persian name>: <label name>".
  // The colour name is the SR-only redundancy that lets a non-sighted
  // user disambiguate "Bug" labels by colour the same way a sighted
  // user does.
  const accessibleName = `${style.persianName}: ${name}`;

  const inlineColors = {
    backgroundColor: style.bg,
    color:           style.text,
  } as const;

  if (size === "bar") {
    // Trello-style coloured stripe. Width matches CardItem's gap, so
    // 3-up rendering fits comfortably under a single-line card title.
    // The visible text is hidden but kept in the DOM for SR users.
    return (
      <span
        role="img"
        aria-label={accessibleName}
        title={title ?? accessibleName}
        dir="auto"
        style={inlineColors}
        className={`inline-block h-2 w-10 rounded-full ${className}`}
      >
        <span className="sr-only">{name}</span>
      </span>
    );
  }

  // Pill — sm / md differ only in padding + font size.
  const sizeClasses =
    size === "sm"
      ? "px-2 py-0.5 text-xs"
      : "px-3 py-1 text-sm";

  return (
    <span
      role="img"
      aria-label={accessibleName}
      title={title ?? accessibleName}
      dir="auto"
      style={inlineColors}
      className={`inline-flex items-center rounded-full font-medium leading-tight ${sizeClasses} ${className}`}
    >
      <span className="truncate max-w-[12rem]">{name}</span>
    </span>
  );
}
